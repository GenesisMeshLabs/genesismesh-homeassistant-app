// Full UI acceptance against the disposable browser lab: real Fastify, managed
// home and released Genesis Mesh authority. Only HA identity/physical devices
// are simulated by the lab. This script refuses a non-loopback/non-lab target.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { capabilities } from '../dist/src/device-actions.js';

const target = new URL(process.env.GM_BROWSER_LAB_URL ?? 'http://invalid.invalid');
assert.ok(target.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(target.hostname) && !target.username && !target.password && !target.search && !target.hash && target.pathname === '/', 'GM_BROWSER_LAB_URL must name the disposable loopback lab root');
const base = target.origin;
mkdirSync('temp', { recursive: true });
const browser = await chromium.launch({ ...(process.env.GM_BROWSER_CHANNEL ? { channel: process.env.GM_BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'chrome' } : {}), headless: true });
const evidence = { profile: 'real-backend-browser-lab', physicalDevices: false, checks: [], screenshots: [], capabilities: [], operationCases: [] };
const check = name => { evidence.checks.push(name); console.log(`PASS: ${name}`); };
const commandCount = async context => {
  const response = await context.request.get(`${base}/fixture/status`);
  assert.equal(response.status(), 200, 'Disposable fixture identity endpoint missing');
  const value = await response.json();
  assert.ok(Number.isSafeInteger(value.simulatedCommands) && value.simulatedCommands >= 0, 'Target is not the disposable simulated-device lab');
  assert.equal(value.profile, 'real-app-real-NA-simulated-Supervisor-and-HA');
  return value.simulatedCommands;
};
const profile = (page, name) => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
const snapshot = async (page, name) => {
  assert.equal(await page.getByRole('heading', { name: 'Access created', exact: true }).count(), 0, 'Clear any shown client credential before screenshots');
  const path = `temp/po-live-${name}.png`; await page.screenshot({ path, fullPage: true }); evidence.screenshots.push(path);
};
async function open(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(10000); const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await commandCount(context); await page.goto(base);
  return { context, page, errors };
}
async function clientResources(context, credential) {
  const response = await context.request.get(`${base}/client/v1/resources`, { headers: { Authorization: `Bearer ${credential}` } });
  assert.equal(response.status(), 200); return response.json();
}
async function clientAction(context, credential, resourceId, capability, parameters) {
  return context.request.post(`${base}/client/v1/actions`, { headers: { Authorization: `Bearer ${credential}` },
    data: { requestId: randomUUID(), resourceId, capability, parameters, expiresAt: new Date(Date.now() + 60000).toISOString() } });
}
async function saveCredential(page) {
  await page.getByRole('heading', { name: 'Access created', exact: true }).waitFor();
  const section = page.locator('section.notice.success').filter({ has: page.getByRole('heading', { name: 'Access created', exact: true }) });
  const credential = (await section.locator('code').first().innerText()).trim();
  assert.ok(/^[a-zA-Z0-9_-]{40,100}$/.test(credential), 'Expected a private lab-issued credential');
  await page.getByRole('button', { name: 'I have saved it', exact: true }).click();
  return credential;
}
async function everyFiniteOperation(context, page, initialCount) {
  const catalogResponse = await context.request.get(`${base}/api/catalog`); assert.equal(catalogResponse.status(), 200);
  const { resources } = await catalogResponse.json();
  const covered = new Set(); let count = initialCount;
  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  const values = { temperatureC: 21, brightnessPct: 25, volumePct: 35, percentage: 50, positionPct: 50, humidityPct: 50, value: 7 };
  for (const resource of resources.filter(item => item.operations.length)) {
    await page.getByLabel('Find a device or entity', { exact: true }).fill(resource.name);
    const card = profile(page, resource.name);
    await card.getByRole('heading', { name: resource.name, exact: true }).waitFor();
    const requestDetails = card.locator('details').first();
    if (!await requestDetails.getAttribute('open')) await card.getByText(/^Try a request as /).click();
    for (const operation of resource.operations) {
      const section = card.locator('section.operation').filter({ has: page.getByRole('heading', { name: operation.label, exact: true }) });
      await section.getByRole('heading', { name: operation.label, exact: true }).waitFor();
      const variants = operation.parameters[0]?.type === 'select' ? operation.parameters[0].options : [undefined];
      for (const variant of variants) {
        console.log(`Browser case: ${resource.kind} ${operation.capability}${variant === undefined ? '' : ` (${variant})`}`);
        const parameters = {};
        for (const parameter of operation.parameters) {
          if (parameter.type === 'select') { parameters[parameter.name] = variant; await section.getByLabel(parameter.label, { exact: true }).selectOption(variant); }
          else {
            parameters[parameter.name] = values[parameter.name] ?? Math.max(parameter.minimum ?? 0, Math.min(parameter.maximum ?? 100, 20));
            await section.getByLabel(parameter.label, { exact: true }).fill(String(parameters[parameter.name]));
          }
        }
        const invalid = await section.locator('input:invalid, select:invalid').evaluateAll(elements => elements.map(element => ({ name: element.name, value: element.value, min: element.min, max: element.max, step: element.step, message: element.validationMessage })));
        assert.deepEqual(invalid, [], `Native form validation refused the intentional value for ${operation.capability}`);
        const [response] = await Promise.all([
          page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/actions' && reply.request().method() === 'POST'),
          section.getByRole('button', { name: operation.capability === 'ha.entity.read' ? 'Observe current state' : `Request ${operation.label.toLocaleLowerCase()}`, exact: true }).click(),
        ]);
        const result = await response.json();
        if (response.status() !== 200) console.error('Finite fixture refusal:', JSON.stringify({ capability: operation.capability, code: result.error?.code, reason: result.reason, commandState: result.commandState, evidenceState: result.evidenceState, policyFailures: result.policyFailures }));
        assert.equal(response.status(), 200, `Finite browser operation failed: ${operation.capability}`);
        assert.equal(result.commandState, operation.capability === 'ha.entity.read' ? 'observed' : 'accepted', `Unexpected outcome: ${operation.capability}`);
        assert.equal(result.evidenceState, 'acknowledged', `Signed record missing: ${operation.capability}`);
        assert.ok(result.decisionId && result.evidenceId, `Authority proof missing: ${operation.capability}`);
        if (operation.capability !== 'ha.entity.read') count++;
        assert.equal(await commandCount(context), count, `Unexpected simulated dispatch count: ${operation.capability}`);
        evidence.operationCases.push({ capability: operation.capability, kind: resource.kind, parameters, state: result.commandState });
        covered.add(operation.capability);
        await page.getByRole('button', { name: 'Dismiss result', exact: true }).click();
      }
    }
  }
  assert.deepEqual([...covered].sort(), [...capabilities].sort(), 'Browser fixture must exercise every shipped finite capability');
  evidence.capabilities = [...covered].sort();
  check(`All ${covered.size} shipped capabilities and ${evidence.operationCases.length} resource/option cases passed through actual browser forms and real authority decisions`);
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  return count;
}
try {
  const { context, page, errors } = await open(1280);
  let count = await commandCount(context);
  await page.getByRole('heading', { name: 'Your whole home, in view.' }).waitFor();
  assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0);
  assert.equal(await page.getByRole('checkbox', { name: 'Share Lab person', exact: true }).isDisabled(), true);
  await snapshot(page, 'setup-desktop');
  await page.getByRole('button', { name: 'Select matching shareable items', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Share Lab person', exact: true }).isChecked(), false);
  await page.getByRole('button', { name: 'Save sharing selection', exact: true }).click();
  await page.getByRole('heading', { name: 'Who may do what?', exact: true }).waitFor();
  assert.equal(await commandCount(context), count); check('Real managed setup creates rules without device commands');
  count = await everyFiniteOperation(context, page, count);
  await page.getByLabel('Give it a familiar name').fill('PO observer');
  await page.getByLabel('Who or what is it?').selectOption('machine');
  await page.getByRole('checkbox', { name: 'Allow Lab plug', exact: true }).check();
  await page.getByRole('button', { name: 'Read-only observer', exact: true }).click();
  await page.getByRole('button', { name: 'Create limited access', exact: true }).click();
  const observerCredential = await saveCredential(page);
  await profile(page, 'PO observer').getByText('Not connected yet.', { exact: false }).waitFor();
  const observerResources = await clientResources(context, observerCredential);
  const plug = observerResources.resources.find(resource => resource.name === 'Lab plug'); assert.ok(plug);
  const read = await clientAction(context, observerCredential, plug.id, 'ha.entity.read', {}); assert.equal(read.status(), 200);
  const observation = await read.json(); assert.equal(observation.commandState, 'observed'); assert.equal(observation.evidenceState, 'acknowledged');
  assert.ok(observation.decisionId && observation.evidenceId && observation.observation);
  assert.equal((await clientAction(context, observerCredential, plug.id, 'ha.switch.set', { state: 'on' })).status(), 403);
  assert.equal(await commandCount(context), count); check('Real read-only client receives signed observation and cannot switch its selected plug');
  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh devices', exact: true }).click();
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  await profile(page, 'PO observer').getByText(/^Last authenticated request /).waitFor(); check('Authenticated first contact updates visible client usage');
  await page.getByLabel('Give it a familiar name').fill('PO media helper');
  await page.getByLabel('Who or what is it?').selectOption('agent');
  await page.getByRole('checkbox', { name: 'Allow Lab speaker', exact: true }).check();
  await page.getByRole('button', { name: 'Media helper', exact: true }).click();
  assert.equal(await page.getByLabel('Maximum volume %', { exact: true }).inputValue(), '40');
  await page.getByRole('button', { name: 'Create limited access', exact: true }).click();
  const mediaCredential = await saveCredential(page);
  await profile(page, 'PO media helper').getByText('Maximum volume: 40%', { exact: true }).waitFor();
  const mediaResources = await clientResources(context, mediaCredential);
  const speaker = mediaResources.resources.find(resource => resource.name === 'Lab speaker'); assert.ok(speaker);
  const denied = await clientAction(context, mediaCredential, speaker.id, 'ha.media.volume', { volumePct: 41 }); assert.equal(denied.status(), 403);
  const denial = await denied.json(); assert.equal(denial.commandState, 'denied'); assert.ok(denial.decisionId); assert.ok(denial.policyFailures.some(gate => /volume/i.test(gate)));
  assert.equal(await commandCount(context), count); check('40% profile ceiling produces a real authority denial for41% without dispatch');
  const allowed = await clientAction(context, mediaCredential, speaker.id, 'ha.media.volume', { volumePct: 35 }); assert.equal(allowed.status(), 200);
  assert.equal((await allowed.json()).evidenceState, 'acknowledged'); count++; assert.equal(await commandCount(context), count);
  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh devices', exact: true }).click();
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  await snapshot(page, 'access-desktop');
  await profile(page, 'PO media helper').getByRole('button', { name: 'Edit access', exact: true }).click();
  await page.getByLabel('Maximum volume %', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Save access changes', exact: true }).click();
  await profile(page, 'PO media helper').getByText('Maximum volume: 80%', { exact: true }).waitFor();
  const relaxed = await clientAction(context, mediaCredential, speaker.id, 'ha.media.volume', { volumePct: 60 }); assert.equal(relaxed.status(), 200);
  count++; assert.equal(await commandCount(context), count); check('Explicit UI edit to80% reissues exact access and preserves the existing client credential');
  await profile(page, 'PO media helper').getByRole('button', { name: 'End access', exact: true }).click();
  await profile(page, 'PO media helper').getByText('agent · Access revoked', { exact: false }).waitFor();
  assert.equal((await clientAction(context, mediaCredential, speaker.id, 'ha.media.volume', { volumePct: 30 })).status(), 401);
  assert.equal(await commandCount(context), count); check('UI revocation stops the real client and sends no further device command');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('heading', { name: 'Requests with a record.', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Set media volume · Volume %: 60', exact: true }).waitFor();
  await page.getByText('The authority refused this request under a volume limit.', { exact: false }).waitFor();
  await snapshot(page, 'activity-desktop');
  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  await page.getByLabel('Find a device or entity', { exact: true }).fill('heating');
  const heating = profile(page, 'Living-room heating'); await heating.getByText(/^Try a request as /).click();
  const temperature = heating.getByLabel('Temperature °C', { exact: true });
  assert.equal(await temperature.inputValue(), ''); assert.equal(await temperature.getAttribute('min'), '19'); assert.equal(await temperature.getAttribute('max'), '23');
  await heating.getByRole('button', { name: 'Request set heating or cooling temperature', exact: true }).click();
  assert.equal(await commandCount(context), count); check('Actual backend metadata yields intentional blank controls and configured heating bounds');
  await page.getByLabel('Find a device or entity', { exact: true }).fill(''); await snapshot(page, 'devices-desktop');
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await snapshot(page, 'home-desktop');
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false); await context.close();
  const phone = await open(390);
  await phone.page.getByRole('heading', { name: 'Make your home useful, with limits you own.', exact: true }).waitFor();
  for (const destination of ['Home', 'Devices', 'Access', 'Activity']) {
    await phone.page.getByRole('button', { name: destination, exact: true }).click();
    assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await snapshot(phone.page, `${destination.toLowerCase()}-phone`);
  }
  await phone.page.getByRole('button', { name: 'Devices', exact: true }).click();
  await phone.page.getByLabel('Find a device or entity', { exact: true }).fill('temperature');
  const sensor = profile(phone.page, 'Lab temperature'); await sensor.getByText(/^Try a request as /).click();
  await sensor.getByRole('button', { name: 'Observe current state', exact: true }).click();
  await phone.page.getByText('State observed. No device command was sent.', { exact: true }).waitFor();
  assert.equal(await commandCount(phone.context), count); assert.deepEqual(phone.errors, []); check('Phone main screens and real signed native-user observation work without physical commands');
  await phone.context.close();
  writeFileSync('temp/po-browser-live-evidence.json', JSON.stringify(evidence, null, 2));
  console.log('Real-backend browser acceptance passed. HA identity and device responses are simulated; no household hardware was used.');
} finally { await browser.close(); }
