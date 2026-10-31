#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'dist');
const dataFiles = ['tw-eshop.json', 'price-history.json', 'igdb-ratings.json'];
async function fingerprints() {
  return Promise.all(dataFiles.map(async name => createHash('sha256').update(await readFile(join(root, 'data', name))).digest('hex')));
}
const before = await fingerprints();
const result = spawnSync(process.execPath, ['scripts/build-static.mjs'], { cwd: root, stdio: 'inherit' });
assert.deepEqual(await fingerprints(), before, 'Build changed source JSON data');
assert.equal(result.status, 0, 'Build failed');
async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? htmlFiles(join(directory, entry.name)) : entry.name.endsWith('.html') ? [join(directory, entry.name)] : []))).flat();
}
const pages = await htmlFiles(output);
const documents = new Map(await Promise.all(pages.map(async path => [path, await readFile(path, 'utf8')])));
const reachable = new Set();
const queue = [join(output, 'index.html')];
let checked = 0;
while (queue.length) {
  const page = queue.shift();
  if (reachable.has(page)) continue;
  reachable.add(page);
  const document = documents.get(page);
  assert.ok(document, `Missing page ${page}`);
  assert.match(document, /<title>[^<]+<\/title>/);
  assert.match(document, /rel="canonical"/);
  for (const match of document.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = match[1];
    if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) continue;
    let target = resolve(dirname(page), decodeURIComponent(href.split(/[?#]/)[0]));
    assert.ok(target === output || target.startsWith(output + '/'), `Link escapes site: ${href}`);
    if ((await stat(target)).isDirectory()) target = join(target, 'index.html');
    assert.ok(documents.has(target), `Broken link from ${page}: ${href}`);
    checked++;
    if (!reachable.has(target)) queue.push(target);
  }
}
const catalog = JSON.parse(await readFile(join(output, 'api/games.json'), 'utf8'));
const sitemap = await readFile(join(output, 'sitemap.xml'), 'utf8');
for (const game of catalog.games) {
  const path = join(output, 'games', String(game.nsuid), 'index.html');
  assert.ok(reachable.has(path), `Game not reachable: ${game.nsuid}`);
  assert.ok(sitemap.includes(`/games/${game.nsuid}/</loc>`), `Game missing from sitemap: ${game.nsuid}`);
}
const generatedPages = [...documents.keys()].filter(path => path === join(output, 'index.html') || /\/(games|browse|deals)\//.test(path.slice(output.length)));
for (const path of generatedPages) assert.ok(reachable.has(path), `Generated page cannot be reached: ${path}`);
console.log(`Verified ${reachable.size} reachable pages, ${checked} internal links and ${catalog.games.length} games. All three source JSON files are byte-for-byte unchanged.`);
