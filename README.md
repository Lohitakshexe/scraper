# UI Scraper for LLMs

A powerful command-line tool built with [Playwright](https://playwright.dev/) to scrape website user interfaces, visual elements, and animations. This tool generates structured data (`data.json`) and frame-by-frame screenshots optimized for feeding into vision-enabled Large Language Models (like Claude 3.5 Sonnet or Gemini 1.5 Pro) as reference material for rebuilding or modifying design systems.

## 📦 Prerequisites & Dependencies

Before you begin, ensure you have the following installed on your system:
1. **[Node.js](https://nodejs.org/)** (v16.0.0 or higher)
2. **npm** (comes bundled with Node.js)

The core dependencies used in this project are:
* `playwright`: For headless browser automation and taking high-fidelity screenshots.
* `commander`: For parsing CLI arguments.
* `chalk` (v4): For styling terminal output.

## 🚀 Installation

### 1. Clone the Repository
Clone this repository to your local machine:
```bash
git clone https://github.com/YOUR_USERNAME/ui-scraper.git
cd ui-scraper
```

### 2. Install NPM Dependencies
Install the required packages from `package.json`:
```bash
npm install
```

### 3. Install Playwright Browsers (CRITICAL)
Because this tool relies on Playwright to take accurate screenshots of fully-rendered pages, it needs its own headless browser engine. You **must** run the following command to download the standalone Chromium browser that Playwright uses. 

*(Note: This does not affect your personal Google Chrome installation; it installs an isolated version in your `~/.cache` directory).*

```bash
npx playwright install chromium
```

### 4. Link the CLI globally (Optional but recommended)
To use the `ui-scraper` command from anywhere in your terminal:
```bash
npm link
```

## 🛠️ Usage

```bash
ui-scraper <url> [options]
```

### Options

**Crawling & Depth**
*   `-d, --max-depth <number>`: Maximum crawling depth from the start URL. For example, `1` will crawl the home page and all pages directly linked from the home page. (Default: 0 - only scrapes the start URL).
*   `-p, --max-pages <number>`: Maximum number of pages to scrape overall to prevent endless crawling. (Default: 1).
*   `-o, --output <dir>`: Output directory for the scraped data. If the specified directory already exists, the scraper will automatically append a number to avoid overriding existing data (e.g., `./output(1)`). (Default: `./output`).

**Motion & Animation Options (Choose one)**
*   `--css-animations`: *(Default)* Extracts CSS `transition` and `animation` properties into the structured `data.json`.
*   `--frames <number>`: Captures a sequence of screenshots (up to 15) evenly spaced across the duration of the page's longest animation. **Highly recommended for vision-based LLMs like Claude.**
*   `--video`: Records a short `.webm` video of the page loading and rendering.
*   `--no-motion`: Skips capturing any motion or animation data to save processing time.

### Examples

**1. Scrape a single page capturing 10 frames of animations:**
```bash
ui-scraper https://example.com --frames 10
```

**2. Crawl a site up to 2 links deep, max 5 pages:**
```bash
ui-scraper https://example.com -d 2 -p 5
```

## 📂 Output Structure

The tool will create a folder for each scraped page in your output directory (e.g., `output/page_1`, `output/page_2`).

If you used the `--frames` option, each folder will look like this:
*   `frame_1.png`, `frame_2.png`, ... `frame_10.png`: High-resolution, full-page screenshots showing the progression of the UI over time.
*   `data.json`: A structured JSON file containing:
    *   `url` & `title`
    *   `layoutTree`: A simplified DOM structure of visual elements (excluding invisible elements and scripts).
    *   Colors, Typography, Layout (`rect`) for each element.

## 🤖 How to use with LLMs (Claude, Gemini, etc.)

1. Run the scraper on a target website using the `--frames 10` option.
2. Open your preferred LLM (e.g., Claude 3.5 Sonnet).
3. Upload the generated `.png` frames and paste the contents of `data.json` into the chat.
4. Prompt the LLM: 
> *"Use the attached screenshots as a visual reference for how the UI looks and animates over time. Use the `data.json` to extract exact colors, typography, and structural hierarchies. Generate the HTML, CSS, and JS to recreate this design system."*

---

# 🚀 V2 Scraper (Puppeteer Version)

We have built a brand-new V2 scraper script inside `src/scraper_v2.js`. This version addresses major issues with capturing complex motion and scroll animations by switching to a **Puppeteer-based time-lapse chunking** architecture. 

It is provided as a standalone script so it **does not break or overwrite** the original Playwright version.

## Key Improvements in V2:
- **Full-Page Chunking:** Automatically stitches together massive vertically scrolling pages into easily readable chunks.
- **Scroll Tracking:** Solves the problem of scroll-triggered animations by smoothly scrolling the page over a 10-second sequence.
- **Lazy Load Trigger:** Forces invisible scrolling to trigger React/Vue lazy-loaded elements before taking snapshots.

## Usage for V2:
```bash
node src/scraper_v2.js -u "https://yourwebsite.com" [options]
```

### V2 Options:
- `--scrollsite`: Smoothly scrolls down the page over 10 seconds, capturing a frame every 2 seconds. Perfect for scroll-based animations!
- `--max-pages <number>`: Crawl multiple pages (uses a Breadth-First Queue).
- `--max-depth <number>`: Limits how deep the crawler follows links.
- `--no-motion`: Freezes all CSS animations instantly and captures a single frame (super fast).
- `-o, --output <dir>`: Sets output directory. Now strictly prevents overriding by using `output(1)`, `output(2)`, etc.

### Example:
```bash
# Smooth scroll and capture animations, up to 3 pages
node src/scraper_v2.js -u "https://example.com" --scrollsite --max-pages 3
```
