import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Test-only disposable authority, using the installed release's public CLI. */
export async function startAuthorityLab() {
  const root = resolve('temp');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'authority-lab-'));
  const python = process.env.GM_TEST_PYTHON || resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (!existsSync(python)) throw new Error('Install tests/authority-requirements.txt into .venv first.');
  const required = readFileSync('tests/authority-requirements.txt', 'utf8').trim().split('==')[1];
  const installed = execFileSync(python, ['-c', 'import importlib.metadata; print(importlib.metadata.version("genesis-mesh"))'], { encoding: 'utf8', windowsHide: true }).trim();
  if (installed !== required) throw new Error('The installed authority does not match the pinned test release.');
  const port = await new Promise((ok, no) => {
    const socket = createServer(); socket.on('error', no); socket.listen(0, '127.0.0.1', () => {
      const address = socket.address(); socket.close(() => ok(address.port));
    });
  });
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  // Do not inherit a real deployment profile into the disposable authority.
  for (const key of Object.keys(env)) if (/^(NA_|OPERATOR_|EVIDENCE_|BOUNDARY_|DATABASE_URL$|DB_PATH$|GENESIS_FILE$|RATE_LIMIT_STORE$|PYTHONPATH$)/.test(key)) delete env[key];
  const cli = args => execFileSync(python, ['-m', 'genesis_mesh.cli', ...args], {
    cwd: dir, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  });
  let child, log;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (child && child.exitCode === null) {
      const stopped = new Promise(ok => child.once('exit', ok));
      child.kill();
      await Promise.race([stopped, delay(5000)]);
      if (child.exitCode === null) { child.kill('SIGKILL'); await stopped; }
    }
    if (log !== undefined) closeSync(log);
    // Retain the isolated fixture for inspection. Recursive cleanup was blocked
    // on the development host; do not bypass that policy through another shell.
    // These are generated lab keys, never credentials for an existing home.
  };
  try {
    cli(['init', '--home', 'authority', '--config', 'authority/config.toml', '--env-file', 'authority.env',
      '--network-name', 'HA-P0-LAB', '--na-host', '127.0.0.1', '--na-port', String(port)]);
    cli(['keygen', 'operator', '--output', 'evaluator', '--key-id', 'ha-evaluator', '--tier', 'standard', '--env-file', 'authority.env']);
    // Higher counters affect only this isolated test's repeated negative cases.
    writeFileSync(join(dir, 'authority.env'), readFileSync(join(dir, 'authority.env'), 'utf8') +
      '\nNA_RATE_LIMIT_ADMIN_PER_MINUTE=2000\nNA_RATE_LIMIT_READ_PER_MINUTE=2000\n');
    log = openSync(join(dir, 'authority.log'), 'w', 0o600);
    child = spawn(python, ['-m', 'genesis_mesh.cli', 'na', 'start', '--env-file', 'authority.env', '--host', '127.0.0.1'], {
      cwd: dir, env, windowsHide: true, stdio: ['ignore', log, log],
    });
    let spawnError;
    child.on('error', error => { spawnError = error; });
    const url = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError || child.exitCode !== null) throw new Error('Disposable authority did not start.');
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { healthy = true; break; }
      } catch { /* wait for this new process only */ }
      await delay(100);
    }
    if (!healthy) throw new Error('Disposable authority did not become healthy.');
    const config = JSON.parse(execFileSync(python, ['-c',
      'import json,sys,tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], "rb"))["operator"]))',
      join(dir, 'authority/config.toml')], { encoding: 'utf8', windowsHide: true }));
    const genesis = await (await fetch(`${url}/genesis`)).json();
    const manifest = {
      directory: dir, url, publicKey: genesis.network_authority.public_key,
      sovereignId: genesis.network_name,
      adminKeyId: config.key_id,
      adminKeyFile: join(dir, 'authority/keys/operator.key'),
      evaluatorKeyId: 'ha-evaluator', evaluatorKeyFile: join(dir, 'evaluator.key'),
    };
    const manifestFile = join(dir, 'fixture.json');
    writeFileSync(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
    return { ...manifest, manifestFile, close };
  } catch (error) {
    await close();
    // Avoid printing child env/config or credentials through generic exception inspection.
    throw new Error(`Disposable authority setup failed (${error instanceof Error ? error.name : 'error'}). Check the test prerequisites.`);
  }
}
