import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'tests', 'scripts'];
const files = [];
for (const root of roots) {
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.mjs')) files.push(path);
    }
  };
  walk(root);
}

for (const file of files.sort()) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log(`Syntax checked ${files.length} module(s).`);

