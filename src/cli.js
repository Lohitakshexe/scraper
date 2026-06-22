#!/usr/bin/env node

const { program } = require('commander');
const { crawl } = require('./crawler');
const chalk = require('chalk');

program
  .name('ui-scraper')
  .description('A CLI to scrape website UI and visual elements for LLM ingestion')
  .version('1.0.0');

program
  .argument('<url>', 'The starting URL to scrape')
  .option('-d, --max-depth <number>', 'Maximum crawling depth', '0')
  .option('-p, --max-pages <number>', 'Maximum number of pages to scrape', '1')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--video', 'Record a video of the page loading')
  .option('--frames <number>', 'Number of animation frames to capture (max 15)')
  .option('--no-motion', 'Skip capturing any motion or animation data')
  .option('--css-animations', 'Extract CSS transition and animation properties (default)', true)
  .action(async (url, options) => {
    console.log(chalk.blue(`Starting UI Scraper for ${url}...`));
    
    // Resolve motion option
    let motionType = 'css'; // default
    if (options.noMotion) {
      motionType = 'none';
    } else if (options.frames) {
      motionType = 'frames';
    } else if (options.video) {
      motionType = 'video';
    } else if (options.cssAnimations === false && !options.video && !options.noMotion && !options.frames) {
       motionType = 'none';
    }

    let framesCount = 0;
    if (motionType === 'frames') {
      framesCount = parseInt(options.frames, 10);
      if (isNaN(framesCount) || framesCount <= 0) framesCount = 5;
      if (framesCount > 15) framesCount = 15; // Max limit
    }

    const config = {
      startUrl: url,
      maxDepth: parseInt(options.maxDepth, 10),
      maxPages: parseInt(options.maxPages, 10),
      outputDir: options.output,
      motionType: motionType,
      framesCount: framesCount
    };

    console.log(chalk.gray(`Config: ${JSON.stringify(config, null, 2)}`));

    try {
      await crawl(config);
      console.log(chalk.green('Scraping completed successfully!'));
    } catch (err) {
      console.error(chalk.red('Error during scraping:'), err);
      process.exit(1);
    }
  });

program.parse();
