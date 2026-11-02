import { spawn } from 'node:child_process';
import { startAuthorityLab } from './lab.mjs';

for (const file of ['authority.integration.js', 'managed.integration.js', 'native-jobs.integration.js']) {
 const lab = await startAuthorityLab();
 try {
  const child = spawn(process.execPath, ['--test', `dist/tests/${file}`], {
    env: { ...process.env, GM_HA_TEST_FIXTURE: lab.manifestFile }, stdio: 'inherit', windowsHide: true,
  });
  const result = await new Promise((ok, no) => { child.on('error', no); child.on('exit', code => ok(code ?? 1)); });
  process.exitCode = result;
  if (result !== 0) break;
 } finally {
  await lab.close();
  process.stdout.write('Disposable authority stopped. Private fixture artifacts remain in the gitignored temp directory.\n');
}
}
