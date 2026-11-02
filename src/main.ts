import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { Journal } from './journal.js';
import { Authority } from './authority.js';
import { HomeAssistant } from './home-assistant.js';
import { Executor } from './executor.js';
import { createServer } from './server.js';
import { readSigningSeed } from './secrets.js';

const file = process.argv[2];
if (!file || process.argv.length !== 3) {
  process.stderr.write('Usage: npm start -- /absolute/path/to/config.json\n');
  process.exitCode = 1;
} else {
  try {
    const config = loadConfig(file);
    const journal = new Journal(config.dataDir);
    const secret = (path: string) => readFileSync(path, 'utf8').trim();
    const authority = new Authority(config, journal, readSigningSeed(config.authority.operatorKeyFile), readSigningSeed(config.authority.executorKeyFile));
    const executor = new Executor(config, journal, authority, new HomeAssistant(config.homeAssistant.url, secret(config.homeAssistant.tokenFile)));
    const app = createServer(config, executor, journal);
    // Initial profile is deliberately loopback-only, not an ingress or public authentication implementation.
    const port = Number(process.env['GM_HA_PORT'] ?? 8099);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port.');
    await app.listen({ host: '127.0.0.1', port });
    await executor.flush().catch(() => undefined);
    const timer = setInterval(() => { void executor.flush().catch(() => undefined); }, 15000);
    timer.unref();
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      await app.close();
      await executor.idle();
      journal.close();
    };
    process.on('SIGINT', () => { void close(); });
    process.on('SIGTERM', () => { void close(); });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Local listener did not obtain a port.');
    process.stdout.write(`Genesis Mesh HA executor preview listening on http://127.0.0.1:${address.port} (service clients only).\n`);
  } catch {
    // Credentials, paths, upstream responses and raw SDK errors must not enter logs.
    process.stderr.write('Startup failed. Check the private configuration, credentials and data-directory ownership.\n');
    process.exitCode = 1;
  }
}
