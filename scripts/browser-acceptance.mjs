import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Start an isolated home automatically; no URL supplied by CI/user can point
// this acceptance runner at their real Home Assistant installation.
const child = spawn(process.execPath, ['scripts/browser-lab.mjs'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let output = '';
child.stderr.on('data', () => { /* fixture details stay private; failures report their gate */ });
let finished = false;
const exited = once(child, 'exit').then(() => { finished = true; });
try {
  const url = await new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error('Disposable browser home did not become ready')), 60000);
    child.on('error', () => { clearTimeout(timer); no(new Error('Disposable browser home did not start')); });
    child.once('exit', () => { clearTimeout(timer); no(new Error('Disposable browser home exited before acceptance')); });
    child.stdout.on('data', data => {
      output = (output + String(data)).slice(-4096);
      const match = output.match(/Disposable browser lab ready: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); ok(match[1]); }
    });
  });
  const test = spawn(process.execPath, ['scripts/test-browser-live.mjs'], { env: { ...process.env, GM_BROWSER_LAB_URL: String(url) }, stdio: 'inherit', windowsHide: true });
  const [code] = await once(test, 'exit');
  if (code !== 0) throw new Error('Real-backend browser acceptance failed');
} finally {
  if (!finished) child.stdin.write('stop\n');
  const timeout = setTimeout(() => { if (!finished) child.kill(); }, 15000); timeout.unref();
  await exited; clearTimeout(timeout);
}
