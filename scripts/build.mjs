import { copyFile, mkdir, rm } from 'node:fs/promises';

const source = new URL('../', import.meta.url);
const output = new URL('../dist/', import.meta.url);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(
  ['index.html', 'scanner.js'].map((file) =>
    copyFile(new URL(file, source), new URL(file, output)),
  ),
);

console.log('Built dist/: index.html, scanner.js');
