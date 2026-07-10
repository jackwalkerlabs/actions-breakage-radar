import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('web app exposes the scanner, evidence promise, and privacy disclosure', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Will your GitHub Actions break/);
  assert.match(html, /id="repo-form"/);
  assert.match(html, /Every finding links to source evidence/);
  assert.match(html, /public repositories only/i);
  assert.match(html, /type="module"/);
});
