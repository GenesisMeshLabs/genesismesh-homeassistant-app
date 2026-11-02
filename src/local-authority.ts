import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, openSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseJson } from 'genesis-mesh-sdk';

export interface LocalAuthorityInfo {
  directory: string; url: string; publicKey: string; sovereignId: string;
  adminKeyId: string; adminKeyFile: string; evaluatorKeyId: string; evaluatorKeyFile: string;
}

/** Persistent local-custody profile. Existing keys are never force-initialized. */
export async function startLocalAuthority(directory: string, python: string, port = 9443): Promise<LocalAuthorityInfo & { close(): Promise<void>; isAlive(): boolean }> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  for (const key of Object.keys(env)) {
    if (/^(SUPERVISOR_TOKEN$|NA_|OPERATOR_|EVIDENCE_|BOUNDARY_|DATABASE_URL$|DB_PATH$|GENESIS_FILE$|RATE_LIMIT_STORE$|PYTHONPATH$)/.test(key)) delete env[key];
  }
  const cli = async (args: string[]) => promisify(execFile)(python, ['-m', 'genesis_mesh.cli', ...args], {
    cwd: directory, env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
  });
  const file = join(directory, 'authority.env');
  if (!existsSync(file)) {
    await cli(['init', '--home', 'authority', '--config', 'authority/config.toml', '--env-file', 'authority.env',
      '--network-name', 'GenesisMesh-Home', '--na-host', '127.0.0.1', '--na-port', String(port)]);
  }
  const evaluator = join(directory, 'evaluator.key');
  if (!existsSync(evaluator)) {
    await cli(['keygen', 'operator', '--output', 'evaluator', '--key-id', 'ha-evaluator', '--tier', 'standard', '--env-file', 'authority.env']);
  }
  const expected = parseJson(readFileSync(join(directory, 'authority/genesis.signed.json'), 'utf8')) as { network_authority: { public_key: string } };
  const log = openSync(join(directory, 'authority.log'), 'a', 0o600);
  const processChild = spawn(python, ['-m', 'genesis_mesh.cli', 'na', 'start', '--env-file', 'authority.env',
    '--host', '127.0.0.1', '--port', String(port)], { cwd: directory, env, windowsHide: true, stdio: ['ignore', log, log] });
  let failed = false;
  processChild.on('error', () => { failed = true; });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (processChild.exitCode === null) {
      const stopped = new Promise<void>(ok => processChild.once('exit', () => ok()));
      processChild.kill();
      await Promise.race([stopped, delay(3000)]);
      if (processChild.exitCode === null) { processChild.kill('SIGKILL'); await stopped; }
    }
    closeSync(log);
  };
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (failed || processChild.exitCode !== null) throw new Error('Local authority exited before readiness.');
      try {
        const response = await fetch(`${url}/genesis`, { signal: AbortSignal.timeout(500) });
        if (response.ok) {
          const genesis = parseJson(await response.text()) as { network_name: string; network_authority: { public_key: string } };
          if (genesis.network_authority.public_key !== expected.network_authority.public_key) throw new Error('Local authority identity mismatch.');
          return { directory, url, publicKey: genesis.network_authority.public_key, sovereignId: genesis.network_name,
            adminKeyId: 'operator-local', adminKeyFile: join(directory, 'authority/keys/operator.key'),
            evaluatorKeyId: 'ha-evaluator', evaluatorKeyFile: evaluator, close, isAlive: () => !failed && processChild.exitCode === null };
        }
      } catch { /* only the fixed local authority address */ }
      await delay(200);
    }
    throw new Error('Local authority did not become ready.');
  } catch {
    await close();
    throw new Error('Local authority could not start. Existing state was preserved.');
  }
}
