const puppeteer = require('puppeteer');
const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

program
  .requiredOption('-u, --url <url>', 'Starting URL to scrape')
  .option('-o, --output <dir>', 'Output directory', 'output')
  .option('--scrollsite', 'Enable smooth scrolling capture')
  .option('--no-motion', 'Freeze all animations and take a single capture instantly')
  .option('--max-pages <number>', 'Maximum number of pages to scrape', (v) => parseInt(v, 10), 1)
  .option('--max-depth <number>', 'Maximum link depth to crawl', (v) => parseInt(v, 10), 1)
  .parse(process.argv);

const options = program.opts();

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fastScrollToBottom(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0); // snap back to top
          resolve();
        }
      }, 100);
    });
  });
}

async function smoothScroll(page, durationMs) {
  await page.evaluate(async (duration) => {
    await new Promise((resolve) => {
      const scrollHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      const maxScroll = scrollHeight - viewportHeight;
      if (maxScroll <= 0) return resolve();

      const startTime = Date.now();
      
      const scrollStep = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        window.scrollTo(0, maxScroll * progress);
        
        if (progress < 1) {
          requestAnimationFrame(scrollStep);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(scrollStep);
    });
  }, durationMs);
}

async function captureChunkedScreenshot(page, outputDir, framePrefix) {
  const { width, height } = await page.evaluate(() => {
    return {
      width: document.documentElement.clientWidth,
      height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
    };
  });

  const MAX_HEIGHT_PER_CHUNK = 4000;
  const numChunks = Math.min(Math.ceil(height / MAX_HEIGHT_PER_CHUNK), 4);
  const chunkHeight = Math.floor(height / numChunks);

  for (let i = 0; i < numChunks; i++) {
    const yOffset = i * chunkHeight;
    const clipHeight = (i === numChunks - 1) ? height - yOffset : chunkHeight;
    
    await page.screenshot({
      path: path.join(outputDir, `${framePrefix}_part${i + 1}.png`),
      clip: {
        x: 0,
        y: yOffset,
        width: width,
        height: clipHeight
      }
    });
  }
}

async function extractInternalLinks(page, baseUrl) {
  const baseOrigin = new URL(baseUrl).origin;
  return await page.evaluate((origin) => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links
      .map(a => a.href)
      .filter(href => href.startsWith(origin) && !href.includes('#')) // Same domain, no anchor jumps
      .map(href => {
         // remove trailing slashes for uniqueness
         return href.endsWith('/') ? href.slice(0, -1) : href;
      });
  }, baseOrigin);
}

async function run() {
  let outputBase = path.resolve(options.output);
  let rootOutputDir = outputBase;
  let counter = 1;
  while (fs.existsSync(rootOutputDir)) {
    rootOutputDir = `${outputBase}(${counter})`;
    counter++;
  }
  fs.mkdirSync(rootOutputDir, { recursive: true });

  console.log(`Launching browser...`);
  const browser = await puppeteer.launch({ 
    headless: "new",
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const visited = new Set();
  const queue = [{ url: options.url, depth: 1 }];
  let pagesScraped = 0;
  
  const startOrigin = new URL(options.url).origin;

  while (queue.length > 0 && pagesScraped < options.maxPages) {
    const current = queue.shift();
    const cleanUrl = current.url.endsWith('/') ? current.url.slice(0, -1) : current.url;

    if (visited.has(cleanUrl)) continue;
    visited.add(cleanUrl);

    pagesScraped++;
    const pageOutputDir = path.join(rootOutputDir, `page_${pagesScraped}`);
    fs.mkdirSync(pageOutputDir, { recursive: true });

    console.log(`\n[${pagesScraped}/${options.maxPages}] Scraping ${current.url} (Depth: ${current.depth})`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
      await page.goto(current.url, { waitUntil: 'networkidle0', timeout: 60000 });

      if (options.motion === false) {
        console.log(`Injecting freeze-motion CSS...`);
        await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
        
        console.log(`Fast scrolling to trigger lazy loads...`);
        await fastScrollToBottom(page);
        
        await delay(500); // Give JS time to react
        try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }); } catch(e) {}
        
        console.log(`Capturing single static chunked frame...`);
        await captureChunkedScreenshot(page, pageOutputDir, `frame_1`);
      } 
      else if (options.scrollsite) {
        console.log(`Starting smooth scroll capture over 10 seconds...`);
        const scrollPromise = smoothScroll(page, 10000);
        for (let i = 1; i <= 5; i++) {
          console.log(`Capturing frame ${i}/5...`);
          await page.screenshot({ path: path.join(pageOutputDir, `frame_${i}.png`) });
          if (i < 5) await delay(2000);
        }
        await scrollPromise;
      } 
      else {
        console.log(`Fast scrolling to trigger lazy loads...`);
        await fastScrollToBottom(page);
        await delay(1000);
        try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }); } catch(e) {}

        console.log(`Starting full-page chunked captures (5 frames over 10s)...`);
        for (let i = 1; i <= 5; i++) {
          console.log(`Capturing full-page frame ${i}/5...`);
          await captureChunkedScreenshot(page, pageOutputDir, `frame_${i}`);
          if (i < 5) await delay(2000);
        }
      }

      console.log(`Extracting DOM...`);
      const domData = await page.evaluate((currentUrl) => {
        function extractNode(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            return { type: 'text', content: node.textContent.trim() };
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return null;
          
          const styles = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          
          return {
            tagName: node.tagName.toLowerCase(),
            className: node.className,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            styles: {
              display: styles.display,
              position: styles.position,
              backgroundColor: styles.backgroundColor,
              color: styles.color,
              width: styles.width,
              height: styles.height,
              margin: styles.margin,
              padding: styles.padding,
              backgroundImage: styles.backgroundImage
            },
            children: Array.from(node.childNodes).map(extractNode).filter(n => n && (n.type !== 'text' || n.content !== ''))
          };
        }
        return {
          url: currentUrl,
          layoutTree: extractNode(document.body)
        };
      }, current.url);

      fs.writeFileSync(path.join(pageOutputDir, 'data.json'), JSON.stringify(domData, null, 2));

      // Extract links and queue them if we are within max-depth
      if (current.depth < options.maxDepth) {
        const links = await extractInternalLinks(page, startOrigin);
        let queuedCount = 0;
        for (const link of links) {
          const cLink = link.endsWith('/') ? link.slice(0, -1) : link;
          if (!visited.has(cLink) && !queue.find(q => q.url === link || q.url === link.slice(0, -1))) {
            queue.push({ url: link, depth: current.depth + 1 });
            queuedCount++;
          }
        }
        console.log(`Found and queued ${queuedCount} new internal links.`);
      }

    } catch (e) {
      console.error(`Failed to scrape ${current.url}:`, e);
    } finally {
      await page.close();
    }
  }

  console.log(`\nFinished crawling. Scraped ${pagesScraped} pages. Data saved to ${rootOutputDir}`);
  await browser.close();
}

run().catch(console.error);
