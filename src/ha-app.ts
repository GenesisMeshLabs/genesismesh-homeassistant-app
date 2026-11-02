import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startLocalAuthority } from './local-authority.js';
import { ManagedHome } from './managed-home.js';
import { HomeAssistant } from './home-assistant.js';
import { SupervisorRoles } from './ha-identity.js';
import { createIngress } from './ingress.js';
import { createServer } from './server.js';

try {
  const token = process.env['SUPERVISOR_TOKEN'];
  if (!token) throw new Error('Supervisor profile requires its injected credential.');
  const directory = resolve(process.env['GM_APP_DATA_DIR'] ?? '/data/runtime');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const local = await startLocalAuthority(directory, process.env['GM_AUTHORITY_PYTHON'] ?? '/opt/authority/bin/python');
  const home = new ManagedHome(directory, local, new HomeAssistant('http://supervisor/core/api', token, fetch, 'supervisor'));
  await home.initialize();
  const ui = createIngress(home, new SupervisorRoles(token), resolve('web-dist'), local.isAlive);
  const service = createServer(() => home.serviceRuntime()?.config, { execute: (principal, intent) => home.actParticipant(principal.id, intent) }, home.journal, 'supervisor');
  await ui.listen({ host: '0.0.0.0', port: 8099 });
  await service.listen({ host: '0.0.0.0', port: 8098 });
  const timer = setInterval(() => { void home.flush().catch(() => undefined); }, 15000); timer.unref();
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true; clearInterval(timer);
    await Promise.all([ui.close(), service.close()]); await home.close(); await local.close();
  };
  process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
  process.stdout.write('Genesis Mesh Home Assistant preview ready. Open Web UI in Home Assistant.\n');
} catch {
  process.stderr.write('The app could not start safely. Existing home state was preserved; inspect the private app log and restart.\n');
  process.exit(1);
}
