// UI contract fixture. Actual authority/HA behavior is covered by separate suites.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

mkdirSync('temp', { recursive: true });
const base = '/api/hassio_ingress/test/';
const read = { capability: 'ha.entity.read', label: 'Read current status', parameters: [] };
const light = { capability: 'ha.light.set', label: 'Turn light on or off', parameters: [{ name: 'state', label: 'State', type: 'select', options: ['on', 'off'] }] };
const media = { capability: 'ha.media.volume', label: 'Set media volume', parameters: [{ name: 'volumePct', label: 'Volume %', type: 'number', minimum: 0, maximum: 100, step: 1 }] };
const resource = (char, kind, name, operations, extra = {}) => ({ id: 'r-' + char.repeat(24), entityId: `${kind}.fixture_${char}`, kind, name, state: 'off', available: true, readable: true, operations, ...extra });
const resources = [
  resource('a', 'climate', 'Living-room heating', [read, { capability: 'ha.climate.set_temperature', label: 'Set temperature', parameters: [{ name: 'temperatureC', label: 'Setpoint °C', type: 'number', minimum: 19, maximum: 23, step: .5 }] }]),
  resource('b', 'light', 'Desk lamp', [read, light]),
  resource('c', 'sensor', 'Garden temperature', [read], { state: '21.5', area: 'Garden' }),
  resource('d', 'media_player', 'Living-room speaker', [read, media]),
  resource('e', 'switch', 'Office plug', [read, { capability: 'ha.switch.set', label: 'Switch on or off', parameters: light.parameters }]),
  resource('f', 'camera', 'Entry camera', [], { readable: false, reason: 'Private camera streams are not delegated by this adapter.' }),
  resource('1', 'scene', 'Evening scene', [], { state: 'unknown', readable: false, reason: 'Scene activation may affect several devices; no delegated adapter yet.' }),
];
const summary = { total: resources.length, returned: resources.length, truncated: false, controllable: resources.filter(r => r.operations.some(op => op.capability !== read.capability)).length,
  readable: resources.filter(r => r.readable).length, domains: Object.fromEntries(resources.map(r => [r.kind, 1])) };
let state, created, updated, dispatched;
const reset = () => { state = { ready: false, needsRecovery: false, minimum: 19, maximum: 23, resources: [], members: [], activity: [], custody: 'Local test fixture. Not physical acceptance.' }; created = []; updated = []; dispatched = []; };
reset();
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!path.startsWith(base)) { res.writeHead(404).end(); return; }
  const relative = path.slice(base.length);
  if (relative.startsWith('api/')) {
    res.setHeader('Content-Type', 'application/json');
    let body = ''; for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    if (req.method === 'POST') assert.equal(req.headers['x-gm-csrf'], 'mock-session-only');
    let value = state;
    if (relative === 'api/session') value = { name: 'Home owner', csrf: 'mock-session-only' };
    if (relative === 'api/catalog') value = { resources, summary };
    if (relative === 'api/setup') {
      assert.equal(input.minimum, 19); assert.equal(input.maximum, 23);
      state.ready = true; state.resources = resources.filter(r => input.resources.includes(r.id));
      state.members = [
        { id: 'person-owner', name: 'Home owner', kind: 'person', resources: input.resources, capabilities: [...new Set(state.resources.flatMap(r => r.operations).map(op => op.capability))], enabled: true, expiresAt: new Date(Date.now() + 86400000).toISOString(), nativeUser: true, legacyLimited: false },
        { id: 'machine-existing', name: 'Existing controller', kind: 'machine', resources: [resources[1].id], capabilities: ['ha.light.set'], enabled: true, expiresAt: new Date(Date.now() + 86400000).toISOString(), nativeUser: false, legacyLimited: true },
      ];
    }
    if (relative === 'api/access') {
      created.push(input); state.members.push({ id: 'machine-test', name: input.name, kind: input.kind, resources: input.resources, capabilities: input.capabilities, enabled: true, expiresAt: new Date(Date.now() + 3600000).toISOString(), nativeUser: false, legacyLimited: false });
      value = { credential: 'mock-scoped-service-credential-shown-once' };
    }
    if (relative === 'api/access/update') { updated.push(input); Object.assign(state.members.find(m => m.id === input.id), { resources: input.resources, capabilities: input.capabilities, legacyLimited: false }); }
    if (relative === 'api/revoke') state.members.find(m => m.id === input.id).enabled = false;
    if (relative === 'api/actions') {
      dispatched.push(input);
      value = { id: `operation-${dispatched.length}`, requestId: input.requestId, subjectId: 'person-owner', resourceId: input.resourceId, capability: input.capability, commandState: input.capability === read.capability ? 'observed' : 'accepted', evidenceState: 'acknowledged', reason: input.capability === read.capability ? 'observed' : 'ha_accepted_unconfirmed', createdAt: new Date().toISOString(), policyFailures: [],
        ...(input.capability === read.capability ? { observation: { state: '21.5', attributes: { unit_of_measurement: '°C' }, observedAt: new Date().toISOString() } } : {}) };
      state.activity.unshift(value);
    }
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
    reset(); const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(5000); const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}${base}`);
    await page.getByRole('heading', { name: 'Your whole home, in view.' }).waitFor();
    assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0);
    assert.equal(await page.getByRole('checkbox', { name: 'Share Entry camera', exact: true }).isDisabled(), true);
    await page.getByRole('checkbox', { name: 'Share Living-room heating', exact: true }).check();
    await page.getByRole('heading', { name: 'Heating limits' }).waitFor();
    await page.getByRole('checkbox', { name: 'Share Living-room heating', exact: true }).uncheck();
    assert.equal(await page.getByRole('heading', { name: 'Heating limits' }).count(), 0);
    for (const name of ['Desk lamp', 'Garden temperature', 'Living-room speaker']) await page.getByRole('checkbox', { name: `Share ${name}`, exact: true }).check();
    await page.getByRole('button', { name: 'Save sharing selection' }).click();
    await page.getByRole('heading', { name: 'Who may do what?' }).waitFor();
    assert.equal(state.resources.length, 3); assert.equal(state.resources.some(r => r.kind === 'camera'), false);
    await page.getByText('Original access scope preserved.', { exact: false }).waitFor();
    await page.getByLabel('Give it a familiar name').fill('Household observer');
    await page.getByLabel('Who or what is it?').selectOption('machine');
    await page.getByRole('checkbox', { name: 'Allow Garden temperature', exact: true }).check();
    assert.equal(await page.getByRole('button', { name: 'Create limited access' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Read-only observer', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Permit Read current status', exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Create limited access' }).click();
    await page.getByRole('heading', { name: 'Access created' }).waitFor();
    assert.deepEqual(created[0].capabilities, ['ha.entity.read']); assert.deepEqual(created[0].resources, [resources[2].id]);
    await page.getByRole('button', { name: 'I have saved it' }).click();
    assert.equal(await page.getByText('mock-scoped-service-credential-shown-once').count(), 0);
    const observer = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Household observer', exact: true }) });
    await observer.getByRole('button', { name: 'Edit access', exact: true }).click();
    await page.getByRole('heading', { name: 'Update access for Household observer' }).waitFor();
    await page.getByRole('checkbox', { name: 'Allow Desk lamp', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Permit Turn light on or off', exact: true }).check();
    await page.getByRole('button', { name: 'Save access changes', exact: true }).click();
    await page.getByText('Access updated. Its existing client credential still works with the new scope.', { exact: true }).waitFor();
    assert.deepEqual(updated[0].capabilities.sort(), ['ha.entity.read', 'ha.light.set']);
    assert.equal(updated[0].id, 'machine-test');
    await observer.getByRole('button', { name: 'End access', exact: true }).click();
    await observer.getByText('machine · Access ended', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Devices', exact: true }).click();
    await page.getByRole('heading', { name: 'See where everything fits.' }).waitFor();
    await page.getByLabel('Device type', { exact: true }).selectOption('camera');
    await page.getByRole('heading', { name: 'Entry camera', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Desk lamp', exact: true }).count(), 0);
    await page.getByLabel('Device type', { exact: true }).selectOption('');
    await page.getByLabel('Find a device or entity', { exact: true }).fill('Garden');
    const sensor = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Garden temperature', exact: true }) });
    await sensor.getByText('Try a request as Home owner').click();
    await sensor.getByRole('button', { name: 'Observe current state', exact: true }).click();
    await page.getByText('State observed. No device command was sent.', { exact: true }).waitFor();
    await page.getByText('Observed state: 21.5', { exact: true }).waitFor();
    assert.deepEqual(dispatched[0].parameters, {}); assert.equal(dispatched[0].capability, 'ha.entity.read');
    await page.getByRole('button', { name: 'Dismiss result' }).click();
    await page.getByLabel('Find a device or entity', { exact: true }).fill('speaker');
    const speaker = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Living-room speaker', exact: true }) });
    await speaker.getByText('Try a request as Home owner').click();
    await speaker.getByLabel('Volume %').fill('35');
    await speaker.getByRole('button', { name: 'Request set media volume', exact: true }).click();
    await page.getByText('Home Assistant accepted the command. Physical result is unconfirmed.', { exact: true }).waitFor();
    assert.deepEqual(dispatched[1].parameters, { volumePct: 35 }); assert.equal(dispatched[1].capability, 'ha.media.volume');
    await page.getByRole('button', { name: 'Dismiss result' }).click();
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await page.getByRole('heading', { name: 'Requests with a record.' }).waitFor();
    await page.getByText('State observed. No device command was sent.', { exact: true }).waitFor();
    await page.getByText('Home Assistant accepted the command. Physical result is unconfirmed.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `temp/ha-app-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Devices', exact: true }).click();
    await page.getByLabel('Find a device or entity', { exact: true }).fill('');
    await page.screenshot({ path: `temp/ha-devices-${width}.png`, fullPage: true });
    await context.close();
    console.log(`Mocked whole-home browser journey passed at ${width}px: inventory, no auto-sharing, read-only template, explicit edit/revoke, observation and finite media controls.`);
  }
  state.needsRecovery = true;
  const migration = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await migration.newPage(); page.setDefaultTimeout(5000);
  const before = created.length;
  await page.goto(`http://127.0.0.1:${server.address().port}${base}`);
  await page.getByRole('heading', { name: 'Your whole home, in view.' }).waitFor();
  await page.getByText('Review sharing to finish this update.', { exact: false }).waitFor();
  assert.equal(await page.locator('input[type=checkbox]:checked').count(), state.resources.length);
  assert.equal(created.length, before);
  await migration.close();
  console.log('Existing-home UI migration requires an explicit sharing review and preserves the selected set without issuing access.');
} finally { await browser.close(); await new Promise(ok => server.close(ok)); }

