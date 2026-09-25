import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isConsolidatedLedgerFile, toWorkspaceRelative, isInsideWorkspace } from '../src/evidence-files.js';

describe('evidence-files', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isConsolidatedLedgerFile', () => {
    it('returns true when filename starts with evidence-ledger (case-insensitive)', () => {
      const file = path.join(tmpDir, 'evidence-ledger.md');
      fs.writeFileSync(file, '# Test');
      expect(isConsolidatedLedgerFile(file)).toBe(true);
    });

    it('returns true for Evidence-Ledger (uppercase)', () => {
      const file = path.join(tmpDir, 'Evidence-Ledger.md');
      fs.writeFileSync(file, '# Test');
      expect(isConsolidatedLedgerFile(file)).toBe(true);
    });

    it('returns true for EVIDENCE-LEDGER (all caps)', () => {
      const file = path.join(tmpDir, 'EVIDENCE-LEDGER.md');
      fs.writeFileSync(file, '# Test');
      expect(isConsolidatedLedgerFile(file)).toBe(true);
    });

    it('returns true when file contains valid entries YAML', () => {
      const file = path.join(tmpDir, 'evidence.md');
      const content = `# Evidence

\`\`\`yaml
entries:
  - id: ev-100
    date: '2026-01-01'
    company: acme
    title: Example
    summary: A summary
    impact: An impact
    themes: []
    confidence: verified
    in_flight: false
    metrics: []
    internal_references: []
\`\`\``;
      fs.writeFileSync(file, content);
      expect(isConsolidatedLedgerFile(file)).toBe(true);
    });

    it('returns false when file does not contain entries: pattern', () => {
      const file = path.join(tmpDir, 'evidence.md');
      fs.writeFileSync(file, '# Evidence\n\nNo entries here');
      expect(isConsolidatedLedgerFile(file)).toBe(false);
    });

    it('returns false when file does not exist', () => {
      const file = path.join(tmpDir, 'nonexistent.md');
      expect(isConsolidatedLedgerFile(file)).toBe(false);
    });

    it('returns false when file contains entries: but parseEvidenceLedger returns empty', () => {
      const file = path.join(tmpDir, 'bad-entries.md');
      fs.writeFileSync(file, 'entries: []\n# Not valid YAML');
      expect(isConsolidatedLedgerFile(file)).toBe(false);
    });

    it('returns false on parse error', () => {
      const file = path.join(tmpDir, 'corrupt.md');
      fs.writeFileSync(file, 'entries:\n  - invalid yaml content [[[');
      expect(isConsolidatedLedgerFile(file)).toBe(false);
    });
  });

  describe('toWorkspaceRelative', () => {
    it('converts absolute path to workspace-relative path', () => {
      const workspace = tmpDir;
      const file = path.join(workspace, 'docs', 'evidence.md');
      const result = toWorkspaceRelative(workspace, file);
      expect(result).toBe('docs/evidence.md');
    });

    it('uses forward slashes in output', () => {
      const workspace = tmpDir;
      const file = path.join(workspace, 'nested', 'deep', 'file.md');
      const result = toWorkspaceRelative(workspace, file);
      expect(result).toBe('nested/deep/file.md');
    });

    it('handles file at workspace root', () => {
      const workspace = tmpDir;
      const file = path.join(workspace, 'README.md');
      const result = toWorkspaceRelative(workspace, file);
      expect(result).toBe('README.md');
    });

    it('handles relative paths in input', () => {
      const workspace = path.resolve(tmpDir, 'workspace');
      const file = path.join(workspace, 'subdir', 'file.md');
      const result = toWorkspaceRelative(workspace, file);
      expect(result).toBe('subdir/file.md');
    });
  });

  describe('isInsideWorkspace', () => {
    it('returns true when file is inside workspace', () => {
      const workspace = tmpDir;
      const file = path.join(workspace, 'docs', 'evidence.md');
      expect(isInsideWorkspace(workspace, file)).toBe(true);
    });

    it('returns true when file is at workspace root', () => {
      const workspace = tmpDir;
      const file = path.join(workspace, 'README.md');
      expect(isInsideWorkspace(workspace, file)).toBe(true);
    });

    it('returns false when file is outside workspace', () => {
      const workspace = tmpDir;
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
      const file = path.join(outsideDir, 'file.md');
      try {
        expect(isInsideWorkspace(workspace, file)).toBe(false);
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('returns false for parent directory paths', () => {
      const workspace = path.join(tmpDir, 'subdir');
      const file = tmpDir;
      expect(isInsideWorkspace(workspace, file)).toBe(false);
    });

    it('returns false when file uses ..[/\\] to escape workspace', () => {
      const workspace = path.join(tmpDir, 'workspace');
      const file = path.join(workspace, '..', 'escape.md');
      expect(isInsideWorkspace(workspace, file)).toBe(false);
    });

    it('handles relative paths with normalization', () => {
      const workspace = path.resolve(tmpDir, 'workspace');
      const file = path.resolve(workspace, './docs/file.md');
      expect(isInsideWorkspace(workspace, file)).toBe(true);
    });

    it('handles absolute paths correctly', () => {
      const workspace = path.resolve(tmpDir, 'workspace');
      fs.mkdirSync(workspace, { recursive: true });
      const file = path.resolve(workspace, 'file.md');
      expect(isInsideWorkspace(workspace, file)).toBe(true);
    });
  });
});
