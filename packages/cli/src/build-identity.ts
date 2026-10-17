import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Startup byte inventory, not a version string or a hash of the working tree. */
export function buildIdentity(roots: Record<string, string>) {
  const files: { path: string; sha256: string }[] = [];
  for (const [label, root] of Object.entries(roots).sort()) {
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'ui' && entry.name !== 'node_modules') visit(file);
        else if (entry.isFile() && /\.(?:[cm]?js|ts|json)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          files.push({ path: `${label}/${path.relative(root, file).replaceAll('\\', '/')}`, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
        }
      }
    };
    visit(root);
  }
  if (!files.length) throw new Error('No server build bytes found');
  return { method: 'startup-module-byte-inventory-v1', sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}
