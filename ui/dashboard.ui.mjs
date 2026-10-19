// Browser tests for the site and dashboard, against the demo server. Run with: npm run test:ui
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const PORT = 5600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${PORT}`;
let server, browser;

test.before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: '', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', DEMO: 'on', AUTH: 'off', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { server.stdout.on('data', d => { if (String(d).includes('ready')) resolve(); }); setTimeout(() => reject(new Error('server did not start')), 8000); });
  browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); server?.kill(); if (server) await once(server, 'exit'); });

async function open(path, { width = 1440, height = 900, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  return { page, errors, close: () => ctx.close() };
}
const rows = page => page.locator('#rows tr');

test('inbox opens with the greeting, the money panel and the open cases', async () => {
  const { page, errors, close } = await open('/app.html');
  await page.waitForSelector('#rows tr');
  assert.match(await page.textContent('#casesTitle'), /^Good (morning|afternoon|evening)\.$/);
  assert.match(await page.textContent('#casesSub'), /can still pay you/);
  assert.match(await page.textContent('#mBack'), /^₹[\d,]+$/);
  assert.equal(await page.locator('#spark .c').count(), 14);
  assert.equal(await rows(page).count(), 4);
  assert.equal(await page.textContent('[data-count="open"]'), '4');
  assert.deepEqual(errors, []);
  await close();
});

test('approving a case sends one link, then the simulated payment stamps it recovered', async () => {
  const { page, errors, close } = await open('/app.html');
  await page.waitForSelector('#rows tr');
  const name = (await page.locator('#rows tr .cust-t b').first().textContent()).trim();
  await rows(page).first().click();
  await page.click('[data-act="confirm"]');
  assert.match(await page.textContent('.confirm'), /Razorpay will send one link/);
  await page.click('[data-act="approve"]');
  await page.waitForSelector('#toast:not([hidden])');
  assert.match(await page.textContent('#toast'), /Payment link sent/);
  await page.waitForSelector('[data-act="demo-pay"]');
  await page.click('[data-act="demo-pay"]');
  await page.waitForSelector('#dBody .stamp.is-back');
  assert.match(await page.textContent('#dSub'), /^Recovered\./);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#drawer').isHidden(), true);
  assert.ok(!(await page.textContent('#rows')).includes(name), 'the case left the inbox');
  assert.deepEqual(errors, []);
  await close();
});

test('keyboard selection drives the bulk bar, and bulk send asks before sending', async () => {
  const { page, errors, close } = await open('/app.html');
  await page.waitForSelector('#rows tr');
  const before = await rows(page).count();
  await page.keyboard.press('j'); await page.keyboard.press('x');
  await page.keyboard.press('j'); await page.keyboard.press('x');
  assert.match(await page.textContent('#bulkText'), /^2 selected/);
  await page.click('#bulkSend');
  assert.match(await page.textContent('#bulkText'), /^Send 2 payment links/);
  await page.click('#bulkSend');
  await page.waitForSelector('#bulk', { state: 'hidden' });
  assert.match(await page.textContent('#toast'), /2 payment links sent/);
  assert.equal(await rows(page).count(), before - 2);
  assert.deepEqual(errors, []);
  await close();
});

test('the command palette finds a customer and opens the case', async () => {
  const { page, errors, close } = await open('/app.html#all');
  await page.waitForSelector('#rows tr');
  await page.keyboard.press('Control+k');
  await page.fill('#pInput', 'nila');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#drawer:not([hidden])');
  assert.equal(await page.textContent('#dTitle'), 'Nila Textiles');
  assert.deepEqual(errors, []);
  await close();
});

test('report, audit and connect pages render real data', async () => {
  const { page, errors, close } = await open('/app.html#report');
  await page.waitForSelector('.report-big');
  assert.match(await page.textContent('.report-big'), /^₹[\d,]+$/);
  await page.goto(base + '/app.html#audit'); await page.waitForSelector('#chain:not(:empty)');
  assert.match(await page.textContent('#chain'), /^Chain intact/);
  await page.goto(base + '/app.html#connect'); await page.waitForSelector('#steps li');
  assert.equal(await page.locator('#steps > li').count(), 3);
  assert.deepEqual(errors, []);
  await close();
});

test('the soundbox recovers a payment when pressed, and the story steps follow the scroll', async () => {
  const { page, errors, close } = await open('/');
  await page.waitForFunction(() => document.getElementById('lcd').textContent === '1 FAILED');
  assert.equal(await page.textContent('#tally'), '₹0');
  await page.evaluate(() => { localStorage.setItem('rf-sound', 'off'); });
  await page.click('#soundBtn'); // visitor turns sound off; the box still works silently
  await page.click('#press');
  await page.waitForFunction(() => /RCVD$/.test(document.getElementById('lcd').textContent), null, { timeout: 5000 });
  assert.equal(await page.textContent('#tally'), '₹2,499');
  assert.match(await page.textContent('#slipStamp'), /^Recovered/);
  await page.waitForFunction(() => document.getElementById('slipAmt').textContent === '₹4,899', null, { timeout: 8000 });
  assert.equal(await page.getAttribute('#stage', 'data-step'), '0', 'the story starts at step one once scripts run');
  await page.evaluate(() => { const s = document.querySelector('.story'); window.scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * 0.9); });
  await page.waitForFunction(() => document.getElementById('stage').dataset.step === '3');
  assert.deepEqual(errors, []);
  await close();
});

test('landing calculator responds and the pilot form validates before sending', async () => {
  const { page, errors, close } = await open('/');
  const before = await page.textContent('#outBack');
  await page.locator('#cRec').fill('40');
  await page.locator('#cRec').dispatchEvent('input');
  assert.notEqual(await page.textContent('#outBack'), before);
  assert.equal(await page.textContent('#oRec'), '40%');
  await page.click('#pGo');
  assert.match(await page.textContent('#pErr'), /^Add your name/);
  await page.fill('#pName', 'Asha'); await page.fill('#pContact', 'asha@shop.in'); await page.fill('#pStore', 'ashacrafts.in');
  await page.click('#pGo');
  await page.waitForSelector('#pilotDone:not([hidden])');
  assert.deepEqual(errors, []);
  await close();
});

test('nothing scrolls sideways on a phone, in light or dark', async () => {
  for (const path of ['/', '/app.html', '/app.html#report', '/app.html#connect']) {
    for (const theme of ['light', 'dark']) {
      const { page, errors, close } = await open(path, { width: 390, height: 844, theme });
      await page.waitForLoadState('networkidle');
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(wide <= 390, `${path} (${theme}) is ${wide}px wide`);
      assert.deepEqual(errors, [], `${path} (${theme})`);
      await close();
    }
  }
});
