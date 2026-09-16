import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import {
  lintCitations,
  validateMetrics,
  redactText,
  auditSlop,
  SLOP_WEIGHTS,
  SlopMatch,
} from '@featherduster/core';
import {
  findFiles,
  loadEvidenceStore,
  loadPrivacyRules,
} from '../server.js';

export interface CheckIssue {
  file: string;
  type:
    | 'dangling_citation'
    | 'missing_metric'
    | 'provisional_evidence'
    | 'retracted_evidence'
    | 'banned_keyword'
    | 'ai_slop'
    | 'slop';
  message: string;
  line?: number;
  citation?: string;
  keyword?: string;
  slopMatch?: SlopMatch;
}

export interface CheckResult {
  isClean: boolean;
  issues: CheckIssue[];
  totalFiles: number;
  validCitationsCount: number;
  danglingCitationsCount: number;
  slopMatchesCount: number;
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
  try {
    const rootEntries = fs.readdirSync(resolvedDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      const lower = entry.name.toLowerCase();
      if (
        entry.isFile() &&
        (lower.endsWith('.md') || lower.endsWith('.markdown')) &&
        !lower.startsWith('agent') &&
        !lower.startsWith('readme') &&
        !lower.startsWith('contributing') &&
        !lower.startsWith('changelog')
      ) {
        filesToCheck.push(path.join(resolvedDir, entry.name));
      }
    }
  } catch {
    // Ignore error reading root directory
  }

  for (const dir of candidateDirs) {
    filesToCheck.push(
      ...findFiles(dir, ['.md', '.markdown', '.txt', '.tex', '.typ', '.yaml', '.yml'])
    );
  }

  const issues: CheckIssue[] = [];
  let validCitationsCount = 0;
  let danglingCitationsCount = 0;
  let slopMatchesCount = 0;

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

      // 4. AI Slop & Buzzword Audit across evidence and resume markdown files
      const isEvidenceOrResume =
        (relativePath.startsWith('evidence/') ||
          relativePath.startsWith('resumes/') ||
          relativePath.includes('/evidence/') ||
          relativePath.includes('/resumes/')) &&
        (file.endsWith('.md') || file.endsWith('.markdown'));

      if (isEvidenceOrResume) {
        const slopResult = auditSlop(content);
        slopMatchesCount += slopResult.matches.length;

        // Collect slop issues: matches with high or moderate severity (weight >= 2) or moderate/high slop band
        const severeMatches = slopResult.matches.filter(
          (m) =>
            (SLOP_WEIGHTS[m.type] ?? 1) >= 2 ||
            slopResult.slopBand === 'moderate' ||
            slopResult.slopBand === 'high'
        );

        for (const match of severeMatches) {
          issues.push({
            file: relativePath,
            type: 'ai_slop',
            message: `AI slop / buzzword pattern '${match.matchedText}' (${match.patternName}) detected`,
            line: match.line,
            slopMatch: match,
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
    slopMatchesCount,
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
    console.log(pc.gray(`  • ${result.slopMatchesCount} AI slop / buzzword filler patterns detected.`));
    console.log('');
  } else {
    console.log(
      pc.red(
        `✖ [FAIL] Integrity check failed with ${result.issues.length} violation(s) across ${result.totalFiles} files:\n`
      )
    );
    console.log(pc.gray(`  • ${result.validCitationsCount} valid citation(s) verified against evidence store.`));
    if (result.danglingCitationsCount > 0) {
      console.log(pc.red(`  • ${result.danglingCitationsCount} dangling citation(s) detected.`));
    }
    const slopText = `  • ${result.slopMatchesCount} AI slop / buzzword filler patterns detected.`;
    console.log(result.slopMatchesCount > 0 ? pc.yellow(slopText) : pc.gray(slopText));
    console.log('');

    for (const issue of result.issues) {
      const sanitizedFile = issue.file.replace(/\x1b\[[0-9;]*m/g, '');
      const sanitizedMessage = issue.message.replace(/\x1b\[[0-9;]*m/g, '');
      const location = issue.line
        ? `${pc.yellow(sanitizedFile)}:${pc.cyan(String(issue.line))}`
        : pc.yellow(sanitizedFile);

      const tag =
        issue.type === 'ai_slop' || issue.type === 'slop'
          ? pc.bgYellow(pc.black(` SLOP `))
          : pc.bgRed(pc.black(` ${issue.type.toUpperCase()} `));
      console.log(`  ${tag} ${location}`);
      console.log(`    ${pc.red(sanitizedMessage)}\n`);
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
