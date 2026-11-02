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
  constructor() {
    this.server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== `Bearer ${this.token}`) { res.writeHead(401).end('{}'); return; }
      if (req.method === 'GET' && req.url === '/api/config') {
        res.end(JSON.stringify({ unit_system: { temperature: this.unit } })); return;
      }
      if (req.method === 'GET' && req.url === '/api/states') {
        res.end(JSON.stringify([
          { entity_id: 'climate.living_room', state: 'heat', attributes: { friendly_name: 'Living-room heating', min_temp: 7, max_temp: 35 } },
          { entity_id: 'light.desk', state: 'off', attributes: { friendly_name: 'Desk lamp' } },
        ])); return;
      }
      const entity = req.url?.match(/^\/api\/states\/(climate\.living_room|light\.desk)$/)?.[1];
      if (req.method === 'GET' && entity) {
        res.end(JSON.stringify({ entity_id: entity, state: this.unavailable ? 'unavailable' : entity.startsWith('light') ? 'on' : 'heat',
          attributes: { min_temp: 7, max_temp: 35 } })); return;
      }
      if (req.method === 'POST' && /^\/api\/services\/(climate\/set_temperature|light\/turn_(on|off))$/.test(req.url ?? '')) {
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
