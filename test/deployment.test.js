import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

test('production build contains only the two required public assets', async () => {
  await execFileAsync(process.execPath, ['scripts/build.mjs'], { cwd: new URL('..', import.meta.url) });
  const files = (await readdir(new URL('../dist', import.meta.url))).sort();
  assert.deepEqual(files, ['index.html', 'scanner.js']);
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /Will your GitHub Actions break/);
});

test('Netlify publishes the clean dist directory with security headers', async () => {
  const config = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(config, /publish\s*=\s*"dist"/);
  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /Referrer-Policy/);
  assert.equal(pkg.scripts.build, 'node scripts/build.mjs');
});
