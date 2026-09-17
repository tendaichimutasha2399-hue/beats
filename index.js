import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(root, 'src', 'server.js');

if (!fs.existsSync(entry)) {
  console.error(
    [
      '',
      '  Cannot start: src/server.js is missing.',
      '',
      `  Looked for:  ${entry}`,
      `  Found here:  ${fs.readdirSync(root).join(', ') || '(nothing)'}`,
      '',
      '  Two usual causes:',
      '   1. The files were downloaded one by one and lost their folders.',
      '      The src/ folder, with src/routes/ and src/views/ inside it, has to exist.',
      '   2. The whole project sits inside a subfolder in your repo.',
      '      Set that subfolder as the Root Directory in your host settings.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

await import(pathToFileURL(entry).href);
