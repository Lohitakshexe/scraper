const { chromium } = require('playwright');
const fs = require('fs/promises');
const path = require('path');

async function extractPageData(page, url, outputDir, config) {
  const { motionType, framesCount } = config;
  await fs.mkdir(outputDir, { recursive: true });

  // Determine animation duration if using frames
  let animationDurationMs = 2000; // Default 2s
  if (motionType === 'frames') {
    animationDurationMs = await page.evaluate(() => {
      let maxDuration = 0;
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        // Helper to parse "0.5s" or "500ms"
        const parseTime = (timeStr) => {
          if (!timeStr || timeStr === '0s') return 0;
          let time = parseFloat(timeStr) * (timeStr.endsWith('ms') ? 1 : 1000);
          return isNaN(time) ? 0 : time;
        };
        
        // Parse transition duration
        const transTimes = style.transitionDuration.split(',').map(parseTime);
        const transDelays = style.transitionDelay.split(',').map(parseTime);
        const maxTrans = Math.max(...transTimes.map((t, i) => t + (transDelays[i] || 0)));
        
        // Parse animation duration
        const animTimes = style.animationDuration.split(',').map(parseTime);
        const animDelays = style.animationDelay.split(',').map(parseTime);
        const maxAnim = Math.max(...animTimes.map((t, i) => t + (animDelays[i] || 0)));
        
        maxDuration = Math.max(maxDuration, maxTrans, maxAnim);
      }
      return maxDuration > 0 ? Math.min(maxDuration, 5000) : 2000; // Cap at 5s, default 2s
    });
  }

  // 1. Take screenshots & Scroll
  if (motionType === 'frames' && framesCount > 1) {
    const interval = animationDurationMs / framesCount;
    // Calculate scroll step to trigger scroll-bound animations
    const scrollHeight = await page.evaluate(() => Math.max(0, document.body.scrollHeight - window.innerHeight));
    const scrollStep = scrollHeight > 0 ? scrollHeight / (framesCount - 1) : 0;

    for (let i = 0; i < framesCount; i++) {
      await page.screenshot({ path: path.join(outputDir, `frame_${i + 1}.png`), fullPage: true });
      if (i < framesCount - 1) {
        if (scrollStep > 0) {
          // Scroll down to trigger any IntersectionObservers or scroll libraries (like GSAP)
          await page.evaluate((step) => window.scrollBy(0, step), scrollStep);
        }
        await page.waitForTimeout(interval);
      }
    }
    // Scroll back to top just in case
    await page.evaluate(() => window.scrollTo(0, 0));
  } else {
    await page.screenshot({ path: path.join(outputDir, 'screenshot.png'), fullPage: true });
  }

  // 2. Extract Data
  const visualData = await page.evaluate((motion) => {
    const extractElementData = (el) => {
      const styles = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      
      let data = {
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: el.className || undefined,
        rect: {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height
        },
        styles: {
          // Visual styles
          backgroundColor: styles.backgroundColor,
          backgroundImage: styles.backgroundImage !== 'none' ? styles.backgroundImage : undefined,
          color: styles.color,
          fontFamily: styles.fontFamily,
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          lineHeight: styles.lineHeight,
          border: styles.border !== '0px none rgb(0, 0, 0)' ? styles.border : undefined,
          
          // Structural & Layout styles
          display: styles.display,
          position: styles.position !== 'static' ? styles.position : undefined,
          margin: styles.margin !== '0px' ? styles.margin : undefined,
          padding: styles.padding !== '0px' ? styles.padding : undefined,
          width: styles.width !== 'auto' ? styles.width : undefined,
          height: styles.height !== 'auto' ? styles.height : undefined,
          
          // Flexbox
          ...(styles.display.includes('flex') && {
            flexDirection: styles.flexDirection,
            justifyContent: styles.justifyContent,
            alignItems: styles.alignItems,
            flexWrap: styles.flexWrap,
            gap: styles.gap !== 'normal' ? styles.gap : undefined
          }),
          flex: styles.flex !== '0 1 auto' ? styles.flex : undefined,

          // Grid
          ...(styles.display.includes('grid') && {
            gridTemplateColumns: styles.gridTemplateColumns,
            gridTemplateRows: styles.gridTemplateRows,
            gap: styles.gap !== 'normal' ? styles.gap : undefined
          }),
          gridColumn: styles.gridColumn !== 'auto' ? styles.gridColumn : undefined,
          gridRow: styles.gridRow !== 'auto' ? styles.gridRow : undefined
        }
      };

      if (motion === 'css') {
        data.motion = {
          transition: styles.transition,
          animation: styles.animation
        };
      }
      return data;
    };

    // simplified layout extraction
    const walkDOM = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      // Skip hidden or invisible elements to reduce noise
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      // Skip scripts, styles, etc. (No longer skipping SVG!)
      if (['script', 'style', 'noscript', 'meta', 'link'].includes(node.tagName.toLowerCase())) return null;

      const data = extractElementData(node);
      
      // Specifically for SVGs, let's grab the raw outerHTML so the LLM has the exact shape data
      if (node.tagName.toLowerCase() === 'svg') {
        data.svgContent = node.outerHTML;
        // We don't need to recursively walk inside the SVG if we have the outerHTML
        return data;
      // Grab canvas snapshots for WebGL / particle systems
      if (node.tagName.toLowerCase() === 'canvas') {
        try {
          // Attempt to get base64 image of the current canvas state
          data.canvasSnapshot = node.toDataURL('image/png');
        } catch (e) {
          // Ignore tainted canvas errors
          data.canvasSnapshot = "error_extracting_canvas_data";
        }
      }
      
      const children = [];
      for (let child of node.childNodes) {
        const childData = walkDOM(child);
        if (childData) children.push(childData);
      }
      if (children.length > 0) {
        data.children = children;
      }
      
      // Try to capture text content for leaf nodes or mostly text nodes
      if (children.length === 0 && node.textContent.trim()) {
        data.text = node.textContent.trim().substring(0, 100); // truncate long text
      }
      
      return data;
    };

    // Extract external scripts to identify animation libraries (GSAP, ThreeJS, etc.)
    const scripts = Array.from(document.querySelectorAll('script[src]'))
      .map(s => s.getAttribute('src'))
      .filter(src => src);

    return {
      url: window.location.href,
      title: document.title,
      detectedLibraries: scripts,
      layoutTree: walkDOM(document.body)
    };
  }, motionType);

  await fs.writeFile(path.join(outputDir, 'data.json'), JSON.stringify(visualData, null, 2));
}

module.exports = {
  extractPageData
};
