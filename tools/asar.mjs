#!/usr/bin/env node
// Minimal asar reader: list / cat / grep inside an .asar archive.
import fs from 'node:fs';

const archive = process.argv[2];
const cmd = process.argv[3] || 'list';
const arg = process.argv[4] || '';
if (!archive) {
  console.error('usage: node asar.mjs <archive.asar> <list|cat|grep> [pattern|path]');
  process.exit(2);
}
const fd = fs.openSync(archive, 'r');
const stat = fs.fstatSync(fd);
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
// asar: uint32 pickle size @0 (=4), uint32 header pickle size @4, then header pickle whose payload starts with uint32 json length
const headerSize = head.readUInt32LE(4);
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, 8);
const jsonLen = headerBuf.readUInt32LE(4);
const header = JSON.parse(headerBuf.subarray(8, 8 + jsonLen).toString('utf8'));
const dataStart = 8 + headerSize;

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (entry.files) walk(entry, p, out);
    else out.push({ path: p, size: entry.size || 0, offset: Number(entry.offset || 0) });
  }
}
const files = [];
walk(header, '', files);

function readEntry(f) {
  const buf = Buffer.alloc(f.size);
  fs.readSync(fd, buf, 0, f.size, dataStart + f.offset);
  return buf;
}

if (cmd === 'list') {
  const re = arg ? new RegExp(arg, 'i') : null;
  for (const f of files) if (!re || re.test(f.path)) console.log(f.size.toString().padStart(10), f.path);
  console.error(`# ${files.length} files total`);
} else if (cmd === 'cat') {
  const hits = files.filter(f => f.path === arg || f.path.endsWith('/' + arg));
  if (!hits.length) { console.error('not found: ' + arg); process.exit(1); }
  process.stdout.write(readEntry(hits[0]));
} else if (cmd === 'grep') {
  const re = new RegExp(arg, 'i');
  let total = 0;
  for (const f of files) {
    if (f.size > 40 * 1024 * 1024) continue;
    let buf;
    try { buf = readEntry(f); } catch { continue; }
    const text = buf.toString('utf8');
    if (!re.test(text)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        console.log(`${f.path}:${i + 1}:${String(lines[i]).slice(0, 400)}`);
        if (++total > 500) { console.error('# truncated at 500 matches'); process.exit(0); }
      }
    }
  }
  console.error(`# ${total} matches`);
}
fs.closeSync(fd);
