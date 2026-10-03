import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const VIEWS = ['front', 'side', 'top', 'iso'];

export async function capturePreview(bundle, options = {}) {
  const directory = path.dirname(bundle.htmlFile);
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const target = path.resolve(directory, pathname.replace(/^\//, ''));
      const relative = path.relative(directory, target);
      const outsideDirectory = relative.startsWith('..') || path.isAbsolute(relative);
      if (outsideDirectory || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        response.writeHead(404); response.end('not found'); return;
      }
      const type = target.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      fs.createReadStream(target).pipe(response);
    } catch (error) { response.writeHead(500); response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: findBrowser(options.browserPath),
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const screenshots = [];
  try {
    for (const view of VIEWS) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.setViewport({ width: options.width ?? 960, height: options.height ?? 640, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${server.address().port}/preview.html?view=${view}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForFunction('window.__previewStats?.ready === true', { timeout: 60_000 });
      const stats = await page.evaluate(() => window.__previewStats);
      if (errors.length) throw new Error(`Preview ${view} errors: ${errors.join('; ')}`);
      const file = path.join(directory, `${view}.png`);
      await page.screenshot({ path: file });
      const bytes = (await fs.promises.stat(file)).size;
      if (bytes < 1000) throw new Error(`Preview screenshot is unexpectedly small: ${file} (${bytes} bytes)`);
      screenshots.push({ view, file, bytes, stats });
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  return screenshots;
}

function findBrowser(override) {
  const candidates = [
    override,
    process.env.CHROME_PATH,
    process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : null,
    process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : null,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
    process.platform === 'linux' ? '/usr/bin/chromium' : null,
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('No Chrome/Edge executable found. Set CHROME_PATH or pass --browser-path.');
  return found;
}
