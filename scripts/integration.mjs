import { spawn } from 'node:child_process';
import { startAuthorityLab } from './lab.mjs';

const lab = await startAuthorityLab();
try {
  const child = spawn(process.execPath, ['--test', 'dist/tests/authority.integration.js'], {
    env: { ...process.env, GM_HA_TEST_FIXTURE: lab.manifestFile }, stdio: 'inherit', windowsHide: true,
  });
  const result = await new Promise((ok, no) => { child.on('error', no); child.on('exit', code => ok(code ?? 1)); });
  process.exitCode = result;
} finally {
  await lab.close();
  process.stdout.write('Disposable authority stopped. Private fixture artifacts remain in the gitignored temp directory.\n');
}
