// Renders every PNG icon from ../favicon.svg in headless Chromium.
//
//   cd test && node render-icons.js
//
// - favicon.png, icon-192/512.png: the SVG as drawn (rounded tile,
//   transparent corners)
// - apple-touch-icon.png: full-bleed and opaque. iOS rounds the corners
//   itself and paints transparent pixels black.
// - icon-maskable-512.png: full-bleed, with the #art group shrunk into
//   Android's circular safe zone
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

// Same browser lookup as smoke.js
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root)
      .filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
      .sort((a, b) => Number(b.match(/\d+$/)[0]) - Number(a.match(/\d+$/)[0]));
    for (const dir of dirs) {
      const candidates = [
        path.join(root, dir, 'chrome-mac', 'headless_shell'),
        path.join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(root, dir, 'chrome-linux', 'headless_shell'),
        path.join(root, dir, 'chrome-linux', 'chrome'),
        path.join(root, dir, 'chrome-win', 'headless_shell.exe'),
        path.join(root, dir, 'chrome-win', 'chrome.exe'),
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

const svg = fs.readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8');
const fullBleed = svg.replace(/rx="14"/g, 'rx="0"');
const maskable = fullBleed.replace('<g id="art">', '<g id="art" transform="translate(32 32) scale(0.8) translate(-32 -32)">');
if (maskable === fullBleed) throw new Error('favicon.svg needs a <g id="art"> group for the maskable icon');

const ICONS = [
  { file: 'favicon.png', size: 64, svg, transparent: true },
  { file: 'icon-192.png', size: 192, svg, transparent: true },
  { file: 'icon-512.png', size: 512, svg, transparent: true },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed, transparent: false },
  { file: 'icon-maskable-512.png', size: 512, svg: maskable, transparent: false },
];

(async () => {
  const exe = findChromium();
  const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'chrome' });
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    const src = 'data:image/svg+xml;base64,' + Buffer.from(icon.svg).toString('base64');
    await page.setContent(`<body style="margin:0;background:${icon.transparent ? 'transparent' : '#0B0D1A'}">` +
      `<img src="${src}" width="${icon.size}" height="${icon.size}" style="display:block"></body>`);
    await page.waitForFunction(() => document.querySelector('img').complete);
    await page.screenshot({ path: path.join(ROOT, icon.file), omitBackground: icon.transparent });
    await page.close();
    console.log('rendered ' + icon.file + ' (' + icon.size + 'px)');
  }
  await browser.close();
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
