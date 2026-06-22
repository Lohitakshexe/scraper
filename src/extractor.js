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

  // 1. Take screenshots
  if (motionType === 'frames' && framesCount > 1) {
    const interval = animationDurationMs / framesCount;
    for (let i = 0; i < framesCount; i++) {
      await page.screenshot({ path: path.join(outputDir, `frame_${i + 1}.png`), fullPage: true });
      if (i < framesCount - 1) {
        await page.waitForTimeout(interval);
      }
    }
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
          backgroundColor: styles.backgroundColor,
          color: styles.color,
          fontFamily: styles.fontFamily,
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          lineHeight: styles.lineHeight,
          border: styles.border,
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
      // Skip scripts, styles, etc.
      if (['script', 'style', 'noscript', 'meta', 'link', 'svg'].includes(node.tagName.toLowerCase())) return null;

      const data = extractElementData(node);
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

    return {
      url: window.location.href,
      title: document.title,
      layoutTree: walkDOM(document.body)
    };
  }, motionType);

  await fs.writeFile(path.join(outputDir, 'data.json'), JSON.stringify(visualData, null, 2));
}

module.exports = {
  extractPageData
};
