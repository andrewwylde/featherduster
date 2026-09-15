import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('CLI bin executable end-to-end', () => {
  const binPath = path.resolve(__dirname, '../dist/bin.js');

  it('prints help message with usage and commands', async () => {
    const { stdout } = await execFileAsync(process.execPath, [binPath, '--help']);
    expect(stdout).toContain('featherduster');
    expect(stdout).toContain('check');
    expect(stdout).toContain('build');
    expect(stdout).toContain('init');
  });

  it('prints version number with -v', async () => {
    const { stdout } = await execFileAsync(process.execPath, [binPath, '-v']);
    expect(stdout).toContain('0.1.0');
  });
});
