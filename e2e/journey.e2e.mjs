// Browser journey against the real server (memory store). Run with: npm run test:e2e
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let server, browser;

test.before(async () => {
  server = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', AUTH: 'on', SETUP_TOKEN: 'e2e-setup', RAZORPAY_WEBHOOK_SECRET: 'e2e-secret' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); server?.kill(); });

test('set up an admin, run a sweep, approve one action, and the approval is in the audit chain after a reload', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE}/app.html`);
  await page.waitForURL(/login\.html/);
  await page.getByRole('button', { name: /create administrator/i }).click();
  assert.match(await page.locator('#err').innerText(), /Enter your name/);

  await page.getByLabel(/your name/i).fill('Ada');
  await page.getByLabel(/^email/i).fill('ada@example.com');
  await page.getByLabel(/password/i).fill('a-long-password');
  await page.getByLabel(/setup token/i).fill('e2e-setup');
  await page.getByRole('button', { name: /create administrator/i }).click();
  await page.waitForURL(/app\.html/);

  await page.getByRole('button', { name: /run recovery sweep/i }).click();
  await page.getByText(/Sweep complete/).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^review$/i }).first().click();
  await page.getByRole('button', { name: /approve action/i }).click();
  await page.getByText(/marked recovered \(simulated\)/).waitFor();

  await page.reload();
  await page.locator('#auditLog').getByText(/Human approved pay_/).waitFor({ timeout: 5000 });
  assert.match(await page.locator('#auditLog').innerText(), /ada@example\.com approved/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the landing page and dashboard fit a phone screen', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE);
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await page.close();
});
