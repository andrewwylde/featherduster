import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import pc from 'picocolors';
import {
  ResumeSpec,
  ResumeSpecSchema,
  compileMarkdownResume,
  compileHtmlPrintResume,
  compileTypstResume,
  compileLatexResume,
  compileBragDoc,
  redactText,
} from '@featherduster/core';
import {
  findFiles,
  loadEvidenceStore,
  loadPrivacyRules,
  loadRubrics,
} from '../server.js';

export type BuildFormat = 'markdown' | 'html' | 'brag' | 'typst' | 'latex';

export interface BuildOptions {
  workspace?: string;
  format?: BuildFormat;
  spec?: string;
  rubric?: string;
  candidateName?: string;
  period?: string;
  output?: string;
  stdout?: boolean;
  strict?: boolean;
}

export interface BuildResult {
  output: string;
  outputPath?: string;
  violations: string[];
  isClean: boolean;
}

function getExtensionForFormat(format: BuildFormat): string {
  switch (format) {
    case 'markdown':
      return 'md';
    case 'html':
      return 'html';
    case 'brag':
      return 'md';
    case 'typst':
      return 'typ';
    case 'latex':
      return 'tex';
  }
}

/**
 * Headless resume & brag doc compilation engine.
 */
export async function runBuild(options?: BuildOptions): Promise<BuildResult> {
  const workspaceDir = path.resolve(options?.workspace || process.cwd());
  const format: BuildFormat = options?.format || 'markdown';
  const privacyRules = loadPrivacyRules(workspaceDir);

  let output = '';

  if (format === 'brag') {
    const rubrics = loadRubrics(workspaceDir);
    let targetRubric = rubrics[0];

    if (options?.rubric) {
      const found = rubrics.find((r) => r.id === options.rubric);
      if (!found) {
        throw new Error(`Rubric with id '${options.rubric}' not found in workspace`);
      }
      targetRubric = found;
    } else if (options?.spec) {
      const specPath = path.isAbsolute(options.spec)
        ? options.spec
        : path.join(workspaceDir, options.spec);
      const raw = fs.readFileSync(specPath, 'utf-8');
      targetRubric = (specPath.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw)) as any;
    }

    if (!targetRubric) {
      throw new Error('No leveling rubric found in workspace to compile brag doc');
    }

    const store = loadEvidenceStore(workspaceDir);
    output = compileBragDoc(targetRubric, store, {
      candidateName: options?.candidateName,
      period: options?.period,
      rules: privacyRules,
    });
  } else {
    // Resume spec compilation
    let specObj: ResumeSpec;

    if (options?.spec) {
      const specPath = path.isAbsolute(options.spec)
        ? options.spec
        : path.join(workspaceDir, options.spec);
      const raw = fs.readFileSync(specPath, 'utf-8');
      const parsed = specPath.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
      specObj = ResumeSpecSchema.parse(parsed);
    } else {
      // Look for a resume spec file in resumes/
      const resumesDir = path.join(workspaceDir, 'resumes');
      const specFiles = findFiles(resumesDir, ['.json', '.yaml', '.yml']);
      if (specFiles.length === 0) {
        throw new Error(
          'No resume spec (.json/.yaml) found in resumes/. Please provide --spec <path>.'
        );
      }
      const raw = fs.readFileSync(specFiles[0], 'utf-8');
      const parsed = specFiles[0].endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
      specObj = ResumeSpecSchema.parse(parsed);
    }

    switch (format) {
      case 'markdown':
        output = compileMarkdownResume(specObj, privacyRules);
        break;
      case 'html':
        output = compileHtmlPrintResume(specObj, privacyRules);
        break;
      case 'typst':
        output = compileTypstResume(specObj, privacyRules);
        break;
      case 'latex':
        output = compileLatexResume(specObj, privacyRules);
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  const check = redactText(output, privacyRules);

  if (options?.strict && !check.isClean) {
    throw new Error(
      `Strict build failure: Banned keywords detected in output: ${check.violations.join(', ')}`
    );
  }

  let outputPath: string | undefined;
  if (options?.stdout) {
    process.stdout.write(output);
  } else {
    const ext = getExtensionForFormat(format);
    const defaultOutput = path.join(
      workspaceDir,
      'resumes',
      'exports',
      `resume-${format}.${ext}`
    );
    if (options?.output) {
      outputPath = path.isAbsolute(options.output)
        ? path.resolve(options.output)
        : path.resolve(workspaceDir, options.output);
      const relToWorkspace = path.relative(workspaceDir, outputPath);
      if (relToWorkspace.startsWith('..') || path.isAbsolute(relToWorkspace)) {
        throw new Error('Path traversal detected: Output file must reside within workspace directory');
      }
    } else {
      outputPath = defaultOutput;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf-8');
  }

  return {
    output,
    outputPath,
    violations: check.violations,
    isClean: check.isClean,
  };
}

/**
 * Headless CLI build command handler.
 */
export async function runBuildCommand(options?: BuildOptions): Promise<BuildResult> {
  try {
    const result = await runBuild(options);
    if (!options?.stdout) {
      console.log(pc.green(`✔ Successfully compiled ${options?.format || 'markdown'} document`));
      if (result.outputPath) {
        console.log(pc.gray(`  Saved to: ${result.outputPath}`));
      }
      if (!result.isClean) {
        console.log(
          pc.yellow(
            `⚠ Warning: Banned keyword(s) detected in compiled output: ${result.violations.join(', ')}`
          )
        );
      }
    }
    return result;
  } catch (err: any) {
    console.error(pc.red(`✖ Build error: ${err.message}`));
    process.exit(1);
  }
}
