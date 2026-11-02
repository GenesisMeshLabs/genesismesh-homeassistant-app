import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

/** A finite HA REST simulator; this is not a real HA installation or physical acceptance. */
export class HaSimulator {
  readonly server: Server;
  readonly calls: { path: string; data: Record<string, unknown> }[] = [];
  token = 'test-home-assistant-credential';
  unavailable = false;
  loseReply = false;
  unit = '°C';
  extraEntities: { entity_id: string; state: string; attributes: Record<string, unknown> }[] = [];
  constructor() {
    this.server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== `Bearer ${this.token}`) { res.writeHead(401).end('{}'); return; }
      if (req.method === 'GET' && req.url === '/api/config') {
        res.end(JSON.stringify({ unit_system: { temperature: this.unit } })); return;
      }
      if (req.method === 'GET' && req.url === '/api/services') {
        res.end(JSON.stringify([
          { domain: 'climate', services: { set_temperature: {}, set_hvac_mode: {} } },
          { domain: 'light', services: { turn_on: {}, turn_off: {} } },
          { domain: 'switch', services: { turn_on: {}, turn_off: {} } },
          { domain: 'media_player', services: { volume_set: {}, media_pause: {}, media_play: {}, volume_mute: {} } },
        ])); return;
      }
      if (req.method === 'GET' && req.url === '/api/states') {
        res.end(JSON.stringify([
          { entity_id: 'climate.living_room', state: 'heat', attributes: { friendly_name: 'Living-room heating', min_temp: 7, max_temp: 35 } },
          { entity_id: 'light.desk', state: 'off', attributes: { friendly_name: 'Desk lamp', supported_color_modes: ['brightness'] } },
          ...this.extraEntities,
        ])); return;
      }
      const entity = req.url?.match(/^\/api\/states\/(climate\.living_room|light\.desk)$/)?.[1];
      const extra = this.extraEntities.find(e => req.url === `/api/states/${e.entity_id}`);
      if (req.method === 'GET' && extra) { res.end(JSON.stringify(extra)); return; }
      if (req.method === 'GET' && entity) {
        res.end(JSON.stringify({ entity_id: entity, state: this.unavailable ? 'unavailable' : entity.startsWith('light') ? 'on' : 'heat',
          attributes: { min_temp: 7, max_temp: 35 } })); return;
      }
      if (req.method === 'POST' && /^\/api\/services\/(climate\/(set_temperature|set_hvac_mode)|light\/turn_(on|off)|switch\/turn_(on|off)|media_player\/(volume_set|media_play|media_pause|volume_mute))$/.test(req.url ?? '')) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        this.calls.push({ path: req.url!, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
        if (this.loseReply) { req.socket.destroy(); return; }
        res.end('[]'); return;
      }
      res.writeHead(404).end('{}');
    });
  }
  async start(): Promise<string> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Simulator did not obtain a port.');
    return `http://127.0.0.1:${address.port}/api`;
  }
  async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((ok, no) => this.server.close(error => error ? no(error) : ok()));
  }
}
