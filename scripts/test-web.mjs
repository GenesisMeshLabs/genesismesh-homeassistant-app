import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

mkdirSync('temp', { recursive: true });
const base = '/api/hassio_ingress/test/';
const resources = [{ id: 'r-' + 'a'.repeat(24), name: 'Living-room heating', kind: 'climate' }, { id: 'r-' + 'b'.repeat(24), name: 'Desk lamp', kind: 'light' }];
let state;
const reset = () => { state = { ready: false, needsRecovery: false, minimum: 19, maximum: 23, resources: [], members: [], activity: [], custody: 'Local test fixture. Not physical acceptance.' }; };
reset();
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!path.startsWith(base)) { res.writeHead(404).end(); return; }
  const relative = path.slice(base.length);
  if (relative.startsWith('api/')) {
    res.setHeader('Content-Type', 'application/json');
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    if (req.method === 'POST') assert.equal(req.headers['x-gm-csrf'], 'mock-session-only');
    let value = state;
    if (relative === 'api/session') value = { name: 'Home owner', csrf: 'mock-session-only' };
    if (relative === 'api/catalog') value = { resources };
    if (relative === 'api/setup') { state.ready = true; state.resources = resources.filter(r => input.resources.includes(r.id)); state.members = [{ id: 'person-owner', name: 'Home owner', kind: 'person', resources: input.resources, enabled: true, expiresAt: new Date(Date.now() + 86400000).toISOString(), nativeUser: true }]; }
    if (relative === 'api/access') { state.members.push({ id: 'machine-test', name: input.name, kind: input.kind, resources: input.resources, enabled: true, expiresAt: new Date(Date.now() + 3600000).toISOString(), nativeUser: false }); value = { credential: 'mock-scoped-service-credential-shown-once' }; }
    if (relative === 'api/revoke') state.members.find(m => m.id === input.id).enabled = false;
    if (relative === 'api/actions') { value = { id: 'operation-test', requestId: input.requestId, subjectId: 'person-owner', resourceId: input.resourceId, commandState: 'accepted', evidenceState: 'acknowledged', reason: 'ha_accepted_unconfirmed', createdAt: new Date().toISOString(), policyFailures: [] }; state.activity.unshift(value); }
    res.end(JSON.stringify(value)); return;
  }
  const file = relative || 'index.html';
  if (!/^(index\.html|logo\.svg|assets\/[a-zA-Z0-9_.-]+)$/.test(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
  res.end(readFileSync(join(resolve('web-dist'), file)));
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ ...(process.env.GM_BROWSER_CHANNEL ? { channel: process.env.GM_BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'chrome' } : {}), headless: true });
try {
  for (const width of [1280, 390]) {
    reset();
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(5000); const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}${base}`);
    try { await page.getByRole('heading', { name: 'Your home. Your limits.' }).waitFor({timeout:5000}); } catch (error) { console.error(errors, await page.locator('genesis-home').evaluate(el => ({html:el.shadowRoot?.innerHTML, own:Object.keys(el)}))); throw error; }
    await page.locator('input[type=checkbox]').nth(0).check(); await page.locator('input[type=checkbox]').nth(1).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByRole('heading', { name: 'Who may do what?' }).waitFor();
    await page.getByLabel('Give it a familiar name').fill('Greenhouse controller');
    await page.getByLabel('Who or what is it?').selectOption('machine');
    await page.locator('input[name=resources]').first().check();
    await page.getByRole('button', { name: 'Create limited access' }).click();
    await page.getByRole('heading', { name: 'Access created' }).waitFor();
    await page.getByRole('button', { name: 'I have saved it' }).click();
    assert.equal(await page.getByText('mock-scoped-service-credential-shown-once').count(), 0);
    await page.getByRole('button', { name: 'End access', exact: true }).click();
    await page.getByText('machine · Access ended', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByText('Try a request as Home owner').click();
    await page.getByRole('button', { name: 'Turn on', exact: true }).click();
    await page.getByText('Home Assistant accepted the command. Physical result is unconfirmed.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await page.getByRole('heading', { name: 'Requests with a record.' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `temp/ha-app-${width}.png`, fullPage: true });
    await context.close();
    process.stdout.write(`Mocked browser journey passed at ${width}px, including ingress-prefix asset/API paths.\n`);
  }
} finally { await browser.close(); await new Promise(ok => server.close(ok)); }


