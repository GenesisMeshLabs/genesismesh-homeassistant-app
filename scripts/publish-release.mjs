import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const { IMAGE: image, VERSION: version, GITHUB_SHA: revision, GITHUB_REPOSITORY: repository } = process.env;
assert.match(version, /^\d+\.\d+\.\d+-dev\.\d+$/); assert.match(revision, /^[a-f0-9]{40}$/);
const ref = `${image}:${version}`;
const raw = tag => JSON.parse(run('docker', ['buildx', 'imagetools', 'inspect', tag, '--raw']));
const digest = tag => {
  const match = run('docker', ['buildx', 'imagetools', 'inspect', tag]).match(/^Digest:\s+(sha256:[a-f0-9]{64})/m);
  assert.ok(match, 'Registry did not return an image digest'); return match[1];
};
const architectures = ['amd64', 'arm64'];
const staged = architectures.map(arch => ({ arch, ref: `${ref}-${arch}`, digest: digest(`${ref}-${arch}`) }));
let existing;
try { existing = raw(ref); } catch {}
if (!existing) run('docker', ['buildx', 'imagetools', 'create', '-t', ref, ...staged.map(s => s.ref)]);
const index = raw(ref);
for (const stage of staged) assert.ok(index.manifests?.some(m => m.digest === stage.digest && m.platform.os === 'linux' && m.platform.architecture === stage.arch), 'Existing release index differs; refusing to overwrite it');
assert.equal(index.manifests.length, 2);
// A logged-in pull is insufficient: HA users must be able to pull anonymously.
const path = image.replace(/^ghcr.io\//, '');
const auth = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${path}:pull`);
assert.ok(auth.ok, 'Public package visibility is required before advertising a version');
const { token } = await auth.json(); assert.equal(typeof token, 'string');
const publicManifest = await fetch(`https://ghcr.io/v2/${path}/manifests/${version}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' },
});
assert.equal(publicManifest.status, 200, 'Anonymous pull failed; install metadata was not changed');
assert.equal(publicManifest.headers.get('docker-content-digest'), digest(ref));
const config = JSON.parse(readFileSync('genesismesh/config.json'));
// Do not advertise an older tested source over a newer main. A newer run will publish it.
const main = JSON.parse(run('gh', ['api', `repos/${repository}/git/ref/heads/main`])).object.sha;
if (main !== revision) {
  if (config.version === version) { console.log('This version is already advertised.'); process.exit(0); }
  throw new Error('Main advanced after verification. Leaving its metadata intact; the newer run will publish.');
}
const temporary = mkdtempSync(join(tmpdir(), 'mesh-release-'));
const notes = `Experimental Home Assistant app ${version}\n\nSource: ${revision}\nImage: ${ref}\nDigest: ${digest(ref)}\n\nNative amd64 and arm64 container gates, real Genesis Mesh authority integration, unit and browser journeys passed. Supervisor/Core proxy and device behavior in container smoke are simulated. HA OS installation and physical-device acceptance remain unverified.\n\nInstall repository: https://github.com/${repository}\n\nOnline local custody: backups include authority keys. No offline mode, recovery, universal interception or physical outcome claims.\n`;
writeFileSync(join(temporary, 'notes.md'), notes);
try { run('gh', ['release', 'view', `v${version}`, '--repo', repository]); }
catch { run('gh', ['release', 'create', `v${version}`, '--repo', repository, '--target', revision, '--prerelease', '--title', `Genesis Mesh HA ${version}`, '--notes-file', join(temporary, 'notes.md')]); }
config.version = version;
writeFileSync('genesismesh/config.json', JSON.stringify(config, null, 2) + '\n');
writeFileSync('repository.json', JSON.stringify({ name: 'Genesis Mesh Home Assistant Apps', url: `https://github.com/${repository}`, maintainer: 'GenesisMeshLabs' }, null, 2) + '\n');
const changelog = readFileSync('genesismesh/CHANGELOG.md', 'utf8');
if (!changelog.includes(`## ${version}\n`)) writeFileSync('genesismesh/CHANGELOG.md', changelog.replace('# Changelog\n', `# Changelog\n\n## ${version}\n\n- Verified preview image from ${revision.slice(0, 7)}. See the GitHub prerelease for checks and limitations.\n`));
run('git', ['config', 'user.name', 'github-actions[bot]']);
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
run('git', ['add', 'genesismesh/config.json', 'genesismesh/CHANGELOG.md', 'repository.json']);
run('git', ['commit', '-m', `release: publish Home Assistant ${version} [skip ci]`]);
run('git', ['push', 'origin', 'HEAD:main']);
console.log(`Published ${ref}; Home Assistant metadata now advertises only verified public images.`);
