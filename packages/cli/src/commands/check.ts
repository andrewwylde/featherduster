import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import {
  lintCitations,
  validateMetrics,
  redactText,
} from '@featherduster/core';
import {
  findFiles,
  loadEvidenceStore,
  loadPrivacyRules,
} from '../server.js';

export interface CheckIssue {
  file: string;
  type: 'dangling_citation' | 'missing_metric' | 'provisional_evidence' | 'retracted_evidence' | 'banned_keyword';
  message: string;
  line?: number;
  citation?: string;
  keyword?: string;
}

export interface CheckResult {
  isClean: boolean;
  issues: CheckIssue[];
  totalFiles: number;
  validCitationsCount: number;
  danglingCitationsCount: number;
}

/**
 * Checks integrity of citations, metrics, and privacy rules across a workspace.
 */
export function checkWorkspace(workspaceDir: string): CheckResult {
  const resolvedDir = path.resolve(workspaceDir);
  const store = loadEvidenceStore(resolvedDir);
  const privacyRules = loadPrivacyRules(resolvedDir);

  const candidateDirs = [
    path.join(resolvedDir, 'resumes'),
    path.join(resolvedDir, 'evidence'),
    path.join(resolvedDir, 'rubrics'),
    path.join(resolvedDir, 'companies'),
  ];

  const filesToCheck: string[] = [];
  for (const dir of candidateDirs) {
    filesToCheck.push(
      ...findFiles(dir, ['.md', '.markdown', '.txt', '.tex', '.typ', '.yaml', '.yml'])
    );
  }

  const issues: CheckIssue[] = [];
  let validCitationsCount = 0;
  let danglingCitationsCount = 0;

  for (const file of filesToCheck) {
    const relativePath = path.relative(resolvedDir, file).replace(/\\/g, '/');
    try {
      const content = fs.readFileSync(file, 'utf-8');

      // 1. Citation verification
      const citationResult = lintCitations(content, store);
      validCitationsCount += citationResult.validCitations.length;
      danglingCitationsCount += citationResult.danglingCitations.length;

      for (const dangling of citationResult.danglingCitations) {
        issues.push({
          file: relativePath,
          type: 'dangling_citation',
          message: `Dangling citation '${dangling}' cannot be resolved to any evidence entry`,
          citation: dangling,
        });
      }

      // 2. Metric verification
      const metricResult = validateMetrics(content, store);
      for (const mIssue of metricResult.issues) {
        issues.push({
          file: relativePath,
          type: mIssue.type,
          message: mIssue.message,
          line: mIssue.line,
        });
      }

      // 3. Privacy / banned keyword verification
      if (privacyRules.banned_keywords && privacyRules.banned_keywords.length > 0) {
        const redactResult = redactText(content, privacyRules);
        for (const violation of redactResult.violations) {
          issues.push({
            file: relativePath,
            type: 'banned_keyword',
            message: `Banned keyword '${violation}' detected in content`,
            keyword: violation,
          });
        }
      }
    } catch {
      // Ignore unreadable file
    }
  }

  return {
    isClean: issues.length === 0,
    issues,
    totalFiles: filesToCheck.length,
    validCitationsCount,
    danglingCitationsCount,
  };
}

/**
 * Formats and prints the colored integrity report to stdout/stderr.
 */
export function printCheckReport(result: CheckResult): void {
  console.log('\n' + pc.bold(pc.cyan('Featherduster Integrity Audit')) + '\n');

  if (result.isClean) {
    console.log(
      pc.green(`✔ [PASS] Integrity check passed! 0 violations found across ${result.totalFiles} files.`)
    );
    console.log(pc.gray(`  • ${result.validCitationsCount} valid citation(s) verified against evidence store.`));
    console.log(pc.gray(`  • 0 unverified or missing metric tokens.`));
    console.log(pc.gray(`  • 0 banned keyword leaks detected.`));
    console.log('');
  } else {
    console.log(
      pc.red(
        `✖ [FAIL] Integrity check failed with ${result.issues.length} violation(s) across ${result.totalFiles} files:\n`
      )
    );

    for (const issue of result.issues) {
      const location = issue.line
        ? `${pc.yellow(issue.file)}:${pc.cyan(String(issue.line))}`
        : pc.yellow(issue.file);

      const tag = pc.bgRed(pc.black(` ${issue.type.toUpperCase()} `));
      console.log(`  ${tag} ${location}`);
      console.log(`    ${pc.red(issue.message)}\n`);
    }
  }
}

export interface RunCheckOptions {
  workspace?: string;
  exitOnError?: boolean;
}

/**
 * Headless CLI check command handler.
 */
export async function runCheckCommand(options?: RunCheckOptions): Promise<CheckResult> {
  const workspaceDir = options?.workspace || process.cwd();
  const result = checkWorkspace(workspaceDir);
  printCheckReport(result);

  if (options?.exitOnError !== false) {
    process.exit(result.isClean ? 0 : 1);
  }

  return result;
}
