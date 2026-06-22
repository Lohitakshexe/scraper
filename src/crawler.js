const { chromium } = require('playwright');
const { extractPageData } = require('./extractor');
const path = require('path');
const chalk = require('chalk');

async function crawl(config) {
  const { startUrl, maxDepth, maxPages, outputDir, motionType } = config;
  
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    console.error(chalk.red("Failed to launch Playwright browser. You may need to run 'npx playwright install chromium'"));
    throw e;
  }

  const startParsed = new URL(startUrl);
  const baseHostname = startParsed.hostname;

  const queue = [{ url: startUrl, depth: 0 }];
  const visited = new Set();
  let pagesScraped = 0;

  while (queue.length > 0 && pagesScraped < maxPages) {
    const { url, depth } = queue.shift();

    // Remove hash for visiting, but keep it if needed later
    const urlWithoutHash = url.split('#')[0];

    if (visited.has(urlWithoutHash)) continue;
    visited.add(urlWithoutHash);

    console.log(chalk.yellow(`[Depth ${depth}] Scraping: ${urlWithoutHash}`));

    // Create a new context for each page to cleanly isolate data and potentially record video
    const contextOptions = {};
    const pageOutputDir = path.join(outputDir, `page_${pagesScraped + 1}`);

    if (motionType === 'video') {
      contextOptions.recordVideo = {
        dir: pageOutputDir,
        size: { width: 1280, height: 720 }
      };
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
      await page.goto(urlWithoutHash, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Extract data
      await extractPageData(page, urlWithoutHash, pageOutputDir, config);
      
      console.log(chalk.green(`  -> Saved data to ${pageOutputDir}`));
      pagesScraped++;

      // Find links if we haven't reached max depth
      if (depth < maxDepth) {
        const hrefs = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));
        });

        for (const href of hrefs) {
          try {
            const parsedHref = new URL(href);
            // Only crawl same domain
            if (parsedHref.hostname === baseHostname) {
              const cleanHref = parsedHref.origin + parsedHref.pathname;
              if (!visited.has(cleanHref)) {
                queue.push({ url: cleanHref, depth: depth + 1 });
              }
            }
          } catch (e) {
            // Invalid URL, ignore
          }
        }
      }
    } catch (err) {
      console.error(chalk.red(`  -> Failed to scrape ${urlWithoutHash}: ${err.message}`));
    } finally {
      await context.close();
      
      // If video was recorded, Playwright saves it with a random name. Let's rename it to video.webm
      if (motionType === 'video') {
        const fs = require('fs/promises');
        try {
          const files = await fs.readdir(pageOutputDir);
          const videoFile = files.find(f => f.endsWith('.webm'));
          if (videoFile && videoFile !== 'video.webm') {
            await fs.rename(path.join(pageOutputDir, videoFile), path.join(pageOutputDir, 'video.webm'));
          }
        } catch (e) {
            // Ignore rename errors
        }
      }
    }
  }

  await browser.close();
}

module.exports = {
  crawl
};
