// Mocked browser/API journey. Metadata, compilation and operation summaries use
// shipped backend builders; authority/physical behavior is tested separately.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { inventory, inventorySummary, observeState } from '../dist/src/inventory.js';
import { compileAction } from '../dist/src/requests.js';
import { Journal } from '../dist/src/journal.js';

mkdirSync('temp', { recursive: true });
const base = '/api/hassio_ingress/test/';
const readCapability = 'ha.entity.read';
const rawStates = [
  { entity_id: 'climate.fixture_a', state: 'heat', attributes: { friendly_name: 'Living-room heating', min_temp: 7, max_temp: 35, hvac_modes: ['off', 'heat'], supported_features: 1 } },
  { entity_id: 'light.fixture_b', state: 'on', attributes: { friendly_name: 'Desk lamp', supported_color_modes: ['brightness'], brightness: 120 } },
  { entity_id: 'sensor.fixture_c', state: '21.5', attributes: { friendly_name: 'Garden temperature', unit_of_measurement: '°C' } },
  { entity_id: 'media_player.fixture_d', state: 'playing', attributes: { friendly_name: 'Living-room speaker', supported_features: 5, volume_level: .3 } },
  { entity_id: 'switch.fixture_e', state: 'off', attributes: { friendly_name: 'Office plug' } },
  { entity_id: 'camera.fixture_f', state: 'idle', attributes: { friendly_name: 'Entry camera', entity_picture: '/private-camera-url' } },
  { entity_id: 'scene.fixture_1', state: 'unknown', attributes: { friendly_name: 'Evening scene' } },
  { entity_id: 'person.fixture_2', state: 'Private location', attributes: { friendly_name: 'Household member', latitude: 1.23 } },
];
const services = new Set(['climate.set_temperature', 'climate.set_hvac_mode', 'light.turn_on', 'light.turn_off', 'switch.turn_on', 'switch.turn_off', 'media_player.volume_set', 'media_player.media_pause']);
const standardResources = inventory(rawStates, services);
const named = name => standardResources.find(resource => resource.name === name);
let resources = standardResources;
let state, created, updated, dispatched, journal;
const reset = (customResources = standardResources) => {
  journal?.close(); journal = new Journal(mkdtempSync(join(resolve('temp'), 'web-contract-')));
  resources = customResources;
  state = { ready: false, needsRecovery: false, minimum: 19, maximum: 23, resources: [], members: [], activity: [], custody: 'Local UI contract fixture. Not physical acceptance.',
    connectionGuide: { kind: 'service-client', baseUrl: 'http://fixture-genesismesh:8098', network: 'Home Assistant private app network', directPhoneJoin: false } };
  created = []; updated = []; dispatched = [];
};
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
    if (relative === 'api/catalog') value = { resources, summary: inventorySummary(resources) };
    if (relative === 'api/setup') {
      assert.equal(input.minimum, 19); assert.equal(input.maximum, 23);
      state.ready = true; state.needsRecovery = false; state.resources = resources.filter(resource => input.resources.includes(resource.id));
      state.members = [
        { id: 'person-owner', name: 'Home owner', kind: 'person', resources: input.resources, capabilities: [...new Set(state.resources.flatMap(resource => resource.operations).map(op => op.capability))], enabled: true, expiresAt: new Date(Date.now() + 86400000).toISOString(), nativeUser: true, legacyLimited: false, limits: {}, connection: { state: 'not_connected' } },
        { id: 'machine-existing', name: 'Existing controller', kind: 'machine', resources: [named('Desk lamp').id], capabilities: ['ha.light.set'], enabled: true, expiresAt: new Date(Date.now() + 86400000).toISOString(), nativeUser: false, legacyLimited: true, limits: {}, connection: { state: 'not_connected' } },
        { id: 'machine-expired', name: 'Expired helper', kind: 'machine', resources: [named('Desk lamp').id], capabilities: ['ha.light.set'], enabled: true, expiresAt: new Date(Date.now() - 60000).toISOString(), nativeUser: false, legacyLimited: false, limits: {}, connection: { state: 'expired' } },
      ];
    }
    if (relative === 'api/access') {
      created.push(input); state.members.push({ id: `client-${created.length}`, name: input.name, kind: input.kind, resources: input.resources, capabilities: input.capabilities, limits: input.limits ?? {}, enabled: true, expiresAt: new Date(Date.now() + input.hours * 3600000).toISOString(), nativeUser: false, legacyLimited: false, connection: { state: 'not_connected' } });
      value = { credential: 'mock-scoped-service-credential-shown-once' };
    }
    if (relative === 'api/access/update') {
      updated.push(input); Object.assign(state.members.find(member => member.id === input.id), { resources: input.resources, capabilities: input.capabilities, limits: input.limits ?? {}, legacyLimited: false, expiresAt: new Date(Date.now() + input.hours * 3600000).toISOString(), connection: { state: 'not_connected' } });
    }
    if (relative === 'api/revoke') Object.assign(state.members.find(member => member.id === input.id), { enabled: false, connection: { state: 'revoked' } });
    if (relative === 'api/actions') {
      dispatched.push(input); const owner = state.members.find(member => member.nativeUser);
      const compiled = compileAction({ homeId: 'web-fixture', resources: state.resources }, owner, input);
      const reserved = journal.reserve(compiled);
      value = journal.patch(reserved.id, { commandState: input.capability === readCapability ? 'observed' : 'accepted', evidenceState: 'acknowledged', reason: input.capability === readCapability ? 'status_observed' : 'ha_accepted_unconfirmed',
        ...(input.capability === readCapability ? { observation: observeState(compiled.resource, rawStates.find(raw => raw.entity_id === compiled.resource.entityId)) } : {}) });
      state.activity.unshift(value); owner.connection = { state: 'active', lastRequestAt: new Date().toISOString() };
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
const open = async width => {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  // Exercise the app's copy behavior without altering the user's system clipboard.
  await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__fixtureCopied = value; } } }));
  const page = await context.newPage(); page.setDefaultTimeout(5000); const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}${base}`);
  return { context, page, errors };
};
const profile = (page, name) => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
try {
  for (const width of [1280, 390]) {
    reset(); const { context, page, errors } = await open(width);
    await page.getByRole('heading', { name: 'Your whole home, in view.' }).waitFor();
    assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0);
    assert.equal(await page.getByRole('checkbox', { name: 'Share Household member', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Share Entry camera', exact: true }).isDisabled(), false);
    assert.equal(await page.getByRole('checkbox', { name: 'Share Evening scene', exact: true }).isDisabled(), false);
    await page.getByLabel('Find a device or entity', { exact: true }).fill('Office');
    await page.getByRole('button', { name: 'Select matching shareable items', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Share Office plug', exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Clear matching selection', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Share Office plug', exact: true }).isChecked(), false);
    await page.getByLabel('Find a device or entity', { exact: true }).fill('');
    await page.getByRole('checkbox', { name: 'Share Living-room heating', exact: true }).check();
    await page.getByRole('heading', { name: 'Heating limits' }).waitFor();
    await page.getByRole('checkbox', { name: 'Share Living-room heating', exact: true }).uncheck();
    assert.equal(await page.getByRole('heading', { name: 'Heating limits' }).count(), 0);
    for (const name of ['Desk lamp', 'Garden temperature', 'Living-room speaker', 'Living-room heating']) await page.getByRole('checkbox', { name: `Share ${name}`, exact: true }).check();
    await page.getByRole('button', { name: 'Save sharing selection' }).click();
    await page.getByRole('heading', { name: 'Who may do what?' }).waitFor();
    assert.equal(state.resources.length, 4); assert.equal(state.resources.some(resource => resource.kind === 'camera'), false);
    await page.getByText('Original access scope preserved.', { exact: false }).waitFor();
    await page.getByLabel('Give it a familiar name').fill('Household observer');
    await page.getByLabel('Who or what is it?').selectOption('machine');
    await page.getByRole('checkbox', { name: 'Allow Garden temperature', exact: true }).check();
    assert.equal(await page.getByRole('button', { name: 'Create limited access' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Read-only observer', exact: true }).click();
    await page.getByRole('button', { name: 'Create limited access' }).click();
    await page.getByRole('heading', { name: 'Access created' }).waitFor();
    assert.deepEqual(created[0].capabilities, ['ha.entity.read']); assert.deepEqual(created[0].resources, [named('Garden temperature').id]);
    await profile(page, 'Household observer').getByText('Not connected yet.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Copy credential', exact: true }).click();
    await page.getByText('Credential copied.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.__fixtureCopied), 'mock-scoped-service-credential-shown-once');
    await page.getByRole('button', { name: 'I have saved it' }).click();
    assert.equal(await page.getByText('mock-scoped-service-credential-shown-once').count(), 0);
    const observer = profile(page, 'Household observer');
    await observer.getByRole('button', { name: 'Edit access', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Allow Desk lamp', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Permit Turn light on or off', exact: true }).check();
    await page.getByRole('button', { name: 'Save access changes', exact: true }).click();
    assert.deepEqual(updated[0].capabilities.sort(), ['ha.entity.read', 'ha.light.set']); assert.equal(updated[0].id, 'client-1');
    await observer.getByRole('button', { name: 'End access', exact: true }).click();
    await observer.getByText('machine · Access revoked', { exact: false }).waitFor();
    assert.equal(await observer.getByRole('button', { name: 'Edit access', exact: true }).isDisabled(), true);
    const expired = profile(page, 'Expired helper');
    await expired.getByRole('button', { name: 'Renew access', exact: true }).click();
    await page.getByRole('button', { name: 'Save access changes', exact: true }).click();
    await expired.getByText('machine · Access valid', { exact: false }).waitFor();
    assert.equal(updated[1].id, 'machine-expired');
    await page.getByLabel('Give it a familiar name').fill('Media helper');
    await page.getByRole('checkbox', { name: 'Allow Living-room speaker', exact: true }).check();
    await page.getByRole('button', { name: 'Media helper', exact: true }).click();
    assert.equal(await page.getByLabel('Maximum volume %', { exact: true }).inputValue(), '40');
    await page.getByRole('button', { name: 'Create limited access' }).click();
    await page.getByRole('heading', { name: 'Access created' }).waitFor();
    assert.equal(created[1].limits.maxVolumePct, 40);
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await profile(page, 'Media helper').getByText('Maximum volume: 40%', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Devices', exact: true }).click();
    await page.getByLabel('Device type', { exact: true }).selectOption('camera');
    await page.getByRole('heading', { name: 'Entry camera', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Desk lamp', exact: true }).count(), 0);
    await page.getByLabel('Device type', { exact: true }).selectOption('');
    await page.getByLabel('Find a device or entity', { exact: true }).fill('Garden');
    const sensor = profile(page, 'Garden temperature');
    await sensor.getByText('Try a request as Home owner').click();
    await sensor.getByRole('button', { name: 'Observe current state', exact: true }).click();
    await page.getByText('Observed state: 21.5', { exact: true }).waitFor();
    assert.deepEqual(dispatched[0].parameters, {}); assert.equal(dispatched[0].capability, readCapability);
    await page.getByRole('button', { name: 'Dismiss result' }).click();
    await page.getByLabel('Find a device or entity', { exact: true }).fill('heating');
    const heating = profile(page, 'Living-room heating');
    await heating.getByText('Try a request as Home owner').click();
    const temperature = heating.getByLabel('Temperature °C', { exact: true });
    assert.equal(await temperature.inputValue(), ''); assert.equal(await temperature.getAttribute('min'), '19'); assert.equal(await temperature.getAttribute('max'), '23');
    await heating.getByRole('button', { name: 'Request set heating or cooling temperature', exact: true }).click();
    assert.equal(dispatched.length, 1, 'Blank numeric field must not become zero or an extreme request');
    await page.getByLabel('Find a device or entity', { exact: true }).fill('speaker');
    const speaker = profile(page, 'Living-room speaker');
    await speaker.getByText('Try a request as Home owner').click();
    assert.equal(await speaker.getByLabel('Volume %', { exact: true }).inputValue(), '');
    await speaker.getByLabel('Volume %', { exact: true }).fill('35');
    await speaker.getByRole('button', { name: 'Request set media volume', exact: true }).click();
    await page.getByText('Home Assistant accepted the command. Physical result is unconfirmed.', { exact: true }).waitFor();
    assert.deepEqual(dispatched[1].parameters, { volumePct: 35 });
    await page.getByRole('button', { name: 'Dismiss result' }).click();
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await page.getByRole('heading', { name: 'Requests with a record.' }).waitFor();
    await page.getByRole('heading', { name: 'Set media volume · Volume %: 35', exact: true }).waitFor();
    await page.getByText('State observed. No device command was sent.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Signed record received', { exact: true }).count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false); assert.deepEqual(errors, []);
    await page.screenshot({ path: `temp/ha-app-${width}.png`, fullPage: true });
    // Simulate a separately authenticated client visit; real callback behavior has integration coverage.
    state.members.find(member => member.name === 'Media helper').connection = { state: 'active', lastRequestAt: new Date().toISOString() };
    await page.getByRole('button', { name: 'Devices', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh devices', exact: true }).click();
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    await profile(page, 'Media helper').getByText(/^Last authenticated request /).waitFor();
    await page.getByRole('button', { name: 'Devices', exact: true }).click();
    await page.getByLabel('Find a device or entity', { exact: true }).fill('');
    await page.screenshot({ path: `temp/ha-devices-${width}.png`, fullPage: true });
    await context.close();
    console.log(`Mocked product-owner browser journey passed at ${width}px: real backend metadata, explicit sharing, client lifecycle/copy, renewal, volume cap, intentional numeric controls and meaningful activity.`);
  }
  state.needsRecovery = true;
  const migration = await open(1280);
  await migration.page.getByRole('heading', { name: 'Your whole home, in view.' }).waitFor();
  assert.equal(await migration.page.locator('input[type=checkbox]:checked').count(), state.resources.length);
  assert.equal(created.length, 2); await migration.context.close();
  console.log('Existing-home migration preserves selections and does not issue new access.');
  reset(inventory(Array.from({ length: 300 }, (_, index) => ({ entity_id: `sensor.bulk_${index}`, state: '21', attributes: { friendly_name: `Bulk sensor ${index}` } })), new Set()));
  const bulk = await open(390);
  await bulk.page.getByRole('heading', { name: 'Your whole home, in view.' }).waitFor();
  assert.equal(await bulk.page.locator('input[type=checkbox]:checked').count(), 0);
  await bulk.page.getByRole('button', { name: 'Select matching shareable items', exact: true }).click();
  await bulk.page.getByText('256 selected', { exact: true }).waitFor();
  assert.equal(created.length, 0);
  await bulk.page.getByRole('button', { name: 'Clear matching selection', exact: true }).click();
  await bulk.page.getByText('0 selected', { exact: true }).waitFor();
  await bulk.context.close();
  console.log('Large-home explicit selection is capped at256 with no automatic sharing or access creation.');
} finally { journal?.close(); await browser.close(); await new Promise(ok => server.close(ok)); }
