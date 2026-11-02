// Disposable full application lab: real app APIs + released authority, simulated
// Supervisor identity/peer and HA devices. Never connects to an existing home.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startAuthorityLab } from './lab.mjs';
import { HaSimulator } from '../dist/tests/ha-simulator.js';
import { ManagedHome } from '../dist/src/managed-home.js';
import { HomeAssistant } from '../dist/src/home-assistant.js';
import { createIngress } from '../dist/src/ingress.js';
import { createServer as createClientApi } from '../dist/src/server.js';
import { NativeJobs } from '../dist/src/native-jobs.js';

const lab = await startAuthorityLab();
const simulator = new HaSimulator();
simulator.extraEntities.push(
  { entity_id: 'switch.lab_plug', state: 'off', attributes: { friendly_name: 'Lab plug' } },
  { entity_id: 'media_player.lab_speaker', state: 'playing', attributes: { friendly_name: 'Lab speaker', supported_features: 20925, volume_level: 0.3 } },
  { entity_id: 'sensor.lab_temperature', state: '21', attributes: { friendly_name: 'Lab temperature', unit_of_measurement: '°C' } },
  { entity_id: 'scene.lab_evening', state: 'unknown', attributes: { friendly_name: 'Lab evening scene' } },
  { entity_id: 'camera.lab_camera', state: 'idle', attributes: { friendly_name: 'Lab camera', access_token: 'private-fixture-only', entity_picture: '/api/secret-camera' } },
  { entity_id: 'person.lab_person', state: 'private-location-fixture', attributes: { friendly_name: 'Lab person', latitude: 12.3 } },
  { entity_id: 'fan.lab_fan', state: 'off', attributes: { friendly_name: 'Lab fan', supported_features: 49, percentage_step: 25 } },
  { entity_id: 'cover.lab_blind', state: 'closed', attributes: { friendly_name: 'Lab blind', device_class: 'blind', supported_features: 15 } },
  { entity_id: 'humidifier.lab_humidifier', state: 'off', attributes: { friendly_name: 'Lab humidifier', min_humidity: 30, max_humidity: 70 } },
  { entity_id: 'vacuum.lab_vacuum', state: 'docked', attributes: { friendly_name: 'Lab vacuum', supported_features: 8220 } },
  { entity_id: 'input_boolean.lab_helper', state: 'off', attributes: { friendly_name: 'Lab boolean helper' } },
  { entity_id: 'input_number.lab_helper', state: '5', attributes: { friendly_name: 'Lab number helper', min: 0, max: 20, step: 1 } },
  { entity_id: 'input_select.lab_helper', state: 'Quiet', attributes: { friendly_name: 'Lab select helper', options: ['Quiet', 'Normal'] } },
);
const directory = join(lab.directory, 'browser-app'); mkdirSync(directory);
const home = new ManagedHome(directory, lab, new HomeAssistant(await simulator.start(), simulator.token), 'browser-fixture');
await home.initialize();
const native = new NativeJobs(directory, home);
const ui = createIngress(home, { requireAdministrator: async id => {
  if (id !== 'browser-owner') throw new Error('Fixture identity refused');
  return { id, name: 'Lab owner' };
} }, resolve('web-dist'), () => true, native);
const clients = createClientApi(() => home.serviceRuntime()?.config, { execute: (principal, body) => home.actParticipant(principal.id, body) }, home.journal,
  'supervisor', id => home.noteClientVisit(id), native);
// Explicit disposable CI profile only. Real HA Core's isolated test process
// reaches this numeric-loopback listener through Docker's host network.
if (process.env.GM_NATIVE_FIXTURE === '1') await clients.listen({ host: '127.0.0.1', port: 8098 });
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/fixture/status') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ profile: 'real-app-real-NA-simulated-Supervisor-and-HA', simulatedCommands: simulator.calls.length })); return; }
    const body = [];
    for await (const part of req) body.push(part);
    const client = req.url?.startsWith('/client/');
    const headers = { ...req.headers }; delete headers['host']; delete headers['connection'];
    if (!client) headers['x-remote-user-id'] = 'browser-owner';
    const response = await (client ? clients : ui).inject({ method: req.method, url: client ? req.url.slice('/client'.length) : req.url,
      remoteAddress: client ? '127.0.0.1' : '172.30.32.2', headers, ...(body.length ? { payload: Buffer.concat(body) } : {}) });
    res.writeHead(response.statusCode, response.headers).end(response.rawPayload);
  } catch { res.writeHead(503).end('Disposable lab unavailable'); }
});
let closing = false;
const close = async () => {
  if (closing) return; closing = true;
  await new Promise(ok => server.close(ok));
  await Promise.all([ui.close(), clients.close()]); await home.close(); await simulator.close(); await lab.close(); process.stdin.pause();
};
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
process.stdin.on('data', data => { if (String(data).trim() === 'stop') void close(); });
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}`;
writeFileSync('temp/browser-lab.json', JSON.stringify({ url, pid: process.pid, profile: 'real-app-real-NA-simulated-Supervisor-and-HA' }));
console.log(`Disposable browser lab ready: ${url}`);
console.log('Real application/authority. Supervisor identity and HA devices are simulated. Type stop to close.');
