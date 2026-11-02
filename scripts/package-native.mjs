// Deterministic stored ZIP: Node standard library only; no external packaging tool.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = resolve('custom_components/genesismesh');
const version = process.env.VERSION || JSON.parse(readFileSync('genesismesh/config.json')).version;
if (!/^\d+\.\d+\.\d+-dev\.\d+$/.test(version)) throw new Error('Invalid integration version.');
const files = [];
function walk(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === '__pycache__') continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) walk(join(dir, entry.name), name + '/');
    else if (entry.isFile() && /\.(py|json|yaml|md)$/.test(name)) files.push({ name, bytes: readFileSync(join(dir, entry.name)) });
  }
}
walk(root);
if (!files.some(f => f.name === '__init__.py') || !files.some(f => f.name === 'manifest.json')) throw new Error('Native integration is incomplete.');
function buildZip(prefix) {
const local = [], central = []; let offset = 0;
for (const file of files) {
  const name = Buffer.from(prefix + file.name);
  let bytes = file.bytes;
  if (file.name === 'manifest.json') bytes = Buffer.from(JSON.stringify({ ...JSON.parse(bytes), version }, null, 2) + '\n');
  const crc = crc32(bytes), header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x21, 14);
  directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
  local.push(header, name, bytes); central.push(directory, name); offset += header.length + name.length + bytes.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
return Buffer.concat([...local, directory, end]);
}
const zip = buildZip('custom_components/genesismesh/');
mkdirSync('web-dist', { recursive: true });
writeFileSync('web-dist/genesismesh-integration.zip', zip);
writeFileSync('web-dist/genesismesh-integration.zip.sha256', createHash('sha256').update(zip).digest('hex') + '  genesismesh-integration.zip\n');
writeFileSync('web-dist/genesismesh.zip', buildZip(''));
console.log(`Packaged native HA integration ${version}: ${files.length} source files, protocol 1.`);
