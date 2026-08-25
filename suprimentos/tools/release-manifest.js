#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
const files = walk(path.join(root, 'suprimentos')).filter((file) => !/release-manifest\.json$/.test(file)).sort();
const entries = files.map((file) => { const content = fs.readFileSync(file); return { path: path.relative(root, file).replace(/\\/g, '/'), bytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') }; });
const aggregate = crypto.createHash('sha256').update(entries.map((item) => item.path + ':' + item.sha256).join('\n')).digest('hex');
console.log(JSON.stringify({ release: 'suprimentos-rc1', contractVersion: '1.0.0', files: entries.length, aggregateSha256: aggregate, entries }, null, 2));
