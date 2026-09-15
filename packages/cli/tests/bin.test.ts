import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
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

  it('executes full end-to-end workflow: init, check, and build in isolated workspace', async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-e2e-smoke-'));

    try {
      // 1. init <tmp> --block-push
      const initResult = await execFileAsync(process.execPath, [
        binPath,
        'init',
        tmpWorkspace,
        '--block-push',
      ]);
      expect(initResult.stdout).toContain('Workspace initialized successfully');

      // Assert required files exist
      const configPath = path.join(tmpWorkspace, '.featherduster', 'config.yaml');
      const evidencePath = path.join(
        tmpWorkspace,
        'evidence',
        'sample-company',
        'ev-001-starter.md'
      );
      const rubricPath = path.join(tmpWorkspace, 'rubrics', 'engineering-ic.yaml');
      const agentMdPath = path.join(tmpWorkspace, 'AGENT.md');
      const prePushPath = path.join(tmpWorkspace, '.githooks', 'pre-push');

      expect(fs.existsSync(configPath)).toBe(true);
      expect(fs.existsSync(evidencePath)).toBe(true);
      expect(fs.existsSync(rubricPath)).toBe(true);
      expect(fs.existsSync(agentMdPath)).toBe(true);
      expect(fs.existsSync(prePushPath)).toBe(true);

      // Verify config contains block_push: true
      const configText = fs.readFileSync(configPath, 'utf-8');
      expect(configText).toContain('block_push: true');

      // 2. check <tmp> -> returns exit code 0
      const checkResult = await execFileAsync(process.execPath, [
        binPath,
        'check',
        tmpWorkspace,
      ]);
      expect(checkResult.stdout).toContain('[PASS] Integrity check passed');

      // 3. build <tmp> --format markdown --output <tmp>/resume.md -> compiles successfully
      const outputResumePath = path.join(tmpWorkspace, 'resume.md');
      const buildResult = await execFileAsync(process.execPath, [
        binPath,
        'build',
        tmpWorkspace,
        '--format',
        'markdown',
        '--output',
        outputResumePath,
      ]);
      expect(buildResult.stdout).toContain('Successfully compiled markdown document');
      expect(fs.existsSync(outputResumePath)).toBe(true);

      const resumeContent = fs.readFileSync(outputResumePath, 'utf-8');
      expect(resumeContent).toContain('Morgan Blake');
      expect(resumeContent).toContain('Staff Software Engineer');
      // Redaction applies: internal citation tags stripped
      expect(resumeContent).not.toContain('ev-001');
    } finally {
      try {
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  });
});
