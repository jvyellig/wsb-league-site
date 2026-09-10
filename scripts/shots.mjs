import { chromium } from 'playwright';
const out = process.argv[2] || 'shots';
const base = process.argv[3] || 'http://localhost:4321';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
for (const [name, path, width] of [['home', '/', 1280], ['home-mobile', '/', 400], ['standings', '/standings', 1280], ['power', '/power-rankings', 1280], ['team', '/teams/4', 1280], ['matchups', '/matchups', 1280], ['playoffs', '/playoffs', 1280], ['draft', '/draft', 1280], ['trade', '/trade-block', 1280], ['admin', '/admin', 1280], ['method', '/methodology', 1280]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errors.push(e.message));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, timeout: 20000 }).catch((e) => errors.push('shot: ' + e.message));
  console.log(name, errors.length ? errors : 'ok');
  await page.close();
}
await browser.close();
