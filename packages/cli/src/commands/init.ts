import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import pc from 'picocolors';
import { SWE_IC_RUBRIC } from '@featherduster/core';

export interface InitWorkspaceOptions {
  /** Target workspace directory. Defaults to process.cwd() */
  workspace?: string;
  /** Alternative alias for workspace directory */
  root?: string;
  /** Overwrite existing files if they already exist */
  force?: boolean;
  /** Configure pre-push hook and settings to unconditionally block remote pushes */
  blockPush?: boolean;
  /** Port for local server (default: 4173) */
  port?: number;
  /** Active company or profile name (default: 'sample-company') */
  profile?: string;
  /** Suppress console output */
  silent?: boolean;
}

export interface InitWorkspaceResult {
  workspaceDir: string;
  success: boolean;
  createdFiles: string[];
  skippedFiles: string[];
  gitHooksConfigured: boolean;
}

export interface RunInitOptions extends InitWorkspaceOptions {
  exitOnError?: boolean;
}

/** Fallback embedded pre-push hook script */
const DEFAULT_PRE_PUSH_SH = `#!/bin/sh
# ==============================================================================
# Featherduster Git Pre-Push Hook
# ==============================================================================
# Prevents accidental remote pushes of private career evidence, telemetry,
# unverified metrics, or sensitive company data.
# ==============================================================================

set -e

BLOCK_PUSH_GIT=$(git config --bool featherduster.blockPush 2>/dev/null || echo "false")
if [ "$BLOCK_PUSH_GIT" = "true" ]; then
  cat >&2 <<'EOF'

[PUSH BLOCKED] Remote push is disabled for this Featherduster career repository.
Your career evidence, personal telemetry, and internal notes are kept strictly local.

To override:
  git config featherduster.blockPush false

EOF
  exit 1
fi

if [ -f ".featherduster/config.yaml" ]; then
  if grep -E "^\\s*block_push:\\s*true" .featherduster/config.yaml >/dev/null 2>&1; then
    cat >&2 <<'EOF'

[PUSH BLOCKED] Remote push is blocked by .featherduster/config.yaml (block_push: true).
To allow pushing, remove or set block_push: false in .featherduster/config.yaml.

EOF
    exit 1
  fi
fi

echo "Running Featherduster pre-push integrity verification..."

CHECK_CMD=""
if command -v npx >/dev/null 2>&1; then
  CHECK_CMD="npx featherduster check"
elif command -v featherduster >/dev/null 2>&1; then
  CHECK_CMD="featherduster check"
fi

if [ -n "$CHECK_CMD" ]; then
  if ! $CHECK_CMD; then
    cat >&2 <<'EOF'

[PRE-PUSH REJECTED] Featherduster integrity audit detected violations!
Please fix dangling citations, missing metrics, or banned keywords before pushing.
To bypass in an emergency: git push --no-verify

EOF
    exit 1
  fi
  echo "✔ Featherduster integrity pre-push check passed."
else
  echo "Notice: Featherduster CLI not found on PATH or via npx. Skipping automated pre-push audit."
fi

exit 0
`;

/** Fallback embedded AGENT.md guide */
const DEFAULT_AGENT_MD = `# Agent Operating Manual & Safety Directives

This document defines the non-negotiable operational rules, data boundaries, and execution playbooks for AI agents (Cursor, Claude Code, Antigravity, etc.) operating in this Featherduster career evidence repository.

---

## 1. Non-Negotiable Prime Directives (Hard Gates)

Any violation of these gates represents an immediate failure of the task:

1. **Zero Hallucinated Metrics:**
   - Never invent numbers, latencies, percentages, cost savings, or scale figures.
   - If an accomplishment or bullet is missing a quantitative metric, use the literal string \`[METRIC NEEDED]\`.
   - Never substitute plausible-sounding estimates or approximations for unverified facts.

2. **Strict Citation Contract:**
   - Every bullet in tailored resumes, brag docs, and candidate accomplishment summaries **must cite** a valid evidence ID (\`ev-###\`).
   - If a claim cannot be verified against an existing entry in \`evidence/**/*.md\`, it cannot be asserted.
   - Run \`featherduster check\` to verify citation validity before committing.

3. **Zero AI Slop:**
   - Strictly bans buzzwords without metrics ("synergy", "spearheaded cross-functional paradigms", "cutting-edge"), empty hedging ("it is worth noting that", "needless to say", "at the end of the day"), and manufactured stakes ("in today's fast-paced digital world").
   - Ban formulaic triadic triplets ("fast, reliable, and scalable") unless backed by verifiable evidence.
   - All bullets and accomplishment narratives must be concise, active, evidence-backed statements without corporate fluff.
   - Run \`featherduster check\` to detect and eliminate slop patterns.

4. **Traceability ID Stripping:**
   - Citation tags (\`ev-###\`) are internal-only metadata for auditability.
   - When generating or compiling external-facing artifacts (\`.md\`, \`.html\`, \`.typ\`, \`.tex\`), all citation tags must be cleanly removed via the redaction engine.

5. **Absolute Privacy Boundary:**
   - Never promote internal-only identifiers into public resumes or external summaries:
     - **Banned from public text:** Internal customer names, ticket IDs (e.g. \`JIRA-123\`, \`CONF-99\`), unannounced project codenames, raw Slack/chat quotes, work email addresses, and system credentials.
     - **Allowed in public text:** Approved company aliases (defined in \`.featherduster/privacy-rules.yaml\`), public project descriptions, and standard technology stacks.

6. **In-Flight Work Separation:**
   - Unreleased, in-progress, or RFC-stage initiatives must be flagged with \`in_flight: true\` or \`confidence: provisional\`.
   - Never format in-flight work as shipped, past-tense achievements.

---

## 2. CLI Tooling & Automation

Featherduster provides CLI commands to validate, compile, and manage career workspaces:

- **Integrity Check:**
  \`\`\`bash
  featherduster check
  \`\`\`
  Runs headless verification across all workspace files for dangling citations, missing metrics, privacy leaks, and AI slop.

- **Compile Resume / Brag Doc:**
  \`\`\`bash
  featherduster build [variant] --format <markdown|html|typst|latex|brag>
  \`\`\`

- **Local Server & Web UI:**
  \`\`\`bash
  featherduster [root] --port 4173
  \`\`\`

---

## 3. Workspace Directory Structure

- \`.featherduster/\`: Workspace configuration and privacy rules.
  - \`skills/\`: Bundled local agent skills (\`de-slop\`, \`career-growth\`).
- \`.claude/\`:
  - \`settings.json\`: Safety permissions denying remote git push commands.
  - \`skills/\`: Mirrored agent skills for Claude Code.
- \`evidence/<company>/\`: Structured accomplishment entries (\`ev-###-slug.md\`).
- \`rubrics/\`: Engineering leveling ladders (e.g. \`engineering-ic.yaml\`).
- \`companies/<company>/\`: Company profiles and public/ledger naming rules.
- \`resumes/\`: Templates, tailored variants, and exports.
- \`.githooks/\`: Git pre-push hook for local evidence protection.

---

## 4. Local Agent Skills in \`.featherduster/skills/\`

Featherduster bundles local-first agent skills in \`.featherduster/skills/\` (and mirrored in \`.claude/skills/\`). Agents must inspect and follow these skill specifications when executing career workflows:

- **\`de-slop\` (\`.featherduster/skills/de-slop/SKILL.md\`):**
  - Two hard rules: fidelity over flair, flag don't fabricate.
  - 6-step loop: scope, pre-flag, judge, triage, rewrite, self-score, report.
  - Strips empty hedging, filler, manufactured stakes, and buzzword inflation while preserving verified facts and metrics.

- **\`career-growth\` (\`.featherduster/skills/career-growth/SKILL.md\`):**
  - Index skill routing career development, performance reviews, and resume workflows.

- **\`career-growth-tailor-resume\` (\`.featherduster/skills/career-growth/career-growth-tailor-resume/SKILL.md\`):**
  - Surgical job description matching adhering strictly to the **Ledger Ceiling Rule** (never add unbacked skills or keywords).
  - 4 gates: Ingest JD, Alignment Matrix, Strategic Re-weighting / Terminology Harmonization, Interview Defensibility Brief.
  - Transferable vs fabricated discipline: keep truthful tools on the resume, bridge adjacent patterns in the interview brief.

- **\`career-growth-evidence\` (\`.featherduster/skills/career-growth/career-growth-evidence/SKILL.md\`):**
  - Ingests work signals from GitHub, Linear, Slack, and local notes into structured evidence entries.

- **\`career-growth-accomplishments\` (\`.featherduster/skills/career-growth/career-growth-accomplishments/SKILL.md\`):**
  - Builds and maintains the accomplishment journal / brag doc grouped by strategic themes and impact.

- **\`career-growth-competency\` (\`.featherduster/skills/career-growth/career-growth-competency/SKILL.md\`):**
  - Maps verified evidence to engineering leveling ladders (L3–L6) for gap analysis.

- **\`career-growth-self-review\` (\`.featherduster/skills/career-growth/career-growth-self-review/SKILL.md\`):**
  - Drafts structured, first-person self-assessments backed strictly by cited evidence.

- **\`career-growth-promotion-packet\` (\`.featherduster/skills/career-growth/career-growth-promotion-packet/SKILL.md\`):**
  - Assembles promotion cases with leveling worksheet sections and gap identification.

### How Agents Should Use Local Skills
When asked to tailor a resume, collect evidence, audit prose, or prepare a performance review, agents must read the relevant local \`SKILL.md\` in \`.featherduster/skills/\` before taking action. Always execute the defined gates and preserve the Core Principles.
`;

const DEFAULT_CLAUDE_SETTINGS_JSON = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "permissions": {
    "deny": [
      "Bash(git push)",
      "Bash(git push:*)",
      "Bash(git remote add:*)",
      "Bash(git remote set-url:*)",
      "Bash(git remote rename:*)",
      "Bash(git config remote.*)",
      "Bash(gh repo create:*)",
      "Bash(gh repo sync:*)",
      "Bash(gh repo clone:*)"
    ]
  }
}
`;

function getTemplatesDir(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidate1 = path.resolve(currentDir, '../templates');
    if (fs.existsSync(candidate1)) {
      return candidate1;
    }
    const candidate2 = path.resolve(currentDir, '../../src/templates');
    if (fs.existsSync(candidate2)) {
      return candidate2;
    }
  } catch {
    // URL/path resolution fallback
  }
  return '';
}

function collectSkillFiles(
  skillsDir: string,
  baseDir: string = skillsDir
): Array<{ relativeSubPath: string; content: string }> {
  if (!skillsDir || !fs.existsSync(skillsDir)) return [];
  const files: Array<{ relativeSubPath: string; content: string }> = [];
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(skillsDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectSkillFiles(fullPath, baseDir));
      } else if (entry.isFile()) {
        const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        const content = fs.readFileSync(fullPath, 'utf-8');
        files.push({ relativeSubPath: rel, content });
      }
    }
  } catch {
    // ignore filesystem read error
  }
  return files;
}

function loadTemplate(filename: string): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidate1 = path.resolve(currentDir, '../templates', filename);
    if (fs.existsSync(candidate1)) {
      return fs.readFileSync(candidate1, 'utf-8');
    }
    const candidate2 = path.resolve(currentDir, '../../src/templates', filename);
    if (fs.existsSync(candidate2)) {
      return fs.readFileSync(candidate2, 'utf-8');
    }
  } catch {
    // URL/path resolution fallback
  }

  if (filename === 'pre-push.sh') return DEFAULT_PRE_PUSH_SH;
  if (filename === 'AGENT.md') return DEFAULT_AGENT_MD;
  if (filename === 'claude-settings.json') return DEFAULT_CLAUDE_SETTINGS_JSON;
  throw new Error(`Template '${filename}' could not be loaded.`);
}

function isGitRepo(workspaceDir: string): boolean {
  const gitDir = path.join(workspaceDir, '.git');
  if (fs.existsSync(gitDir)) return true;
  try {
    const stdout = execSync('git rev-parse --show-toplevel', {
      cwd: workspaceDir,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    return path.resolve(stdout.trim()).toLowerCase() === path.resolve(workspaceDir).toLowerCase();
  } catch {
    return false;
  }
}

function setupGitConfig(workspaceDir: string, blockPush?: boolean): boolean {
  if (!isGitRepo(workspaceDir)) {
    return false;
  }

  try {
    execSync('git config core.hooksPath .githooks', {
      cwd: workspaceDir,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    if (blockPush) {
      execSync('git config featherduster.blockPush true', {
        cwd: workspaceDir,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Initializes and scaffolds a clean Featherduster career corpus workspace.
 */
export async function initWorkspace(
  options?: InitWorkspaceOptions | string
): Promise<InitWorkspaceResult> {
  const opts: InitWorkspaceOptions =
    typeof options === 'string' ? { workspace: options } : options || {};

  const workspaceDir = path.resolve(opts.workspace || opts.root || process.cwd());
  const force = Boolean(opts.force);
  const profile = opts.profile || 'sample-company';
  const port = opts.port || 4173;
  const blockPush = Boolean(opts.blockPush);

  // 1. Ensure primary directory tree
  const directoriesToEnsure = [
    path.join(workspaceDir, '.featherduster'),
    path.join(workspaceDir, '.featherduster', 'skills'),
    path.join(workspaceDir, '.claude'),
    path.join(workspaceDir, '.claude', 'skills'),
    path.join(workspaceDir, 'evidence', profile),
    path.join(workspaceDir, 'rubrics'),
    path.join(workspaceDir, 'resumes', 'templates'),
    path.join(workspaceDir, 'resumes', 'tailored'),
    path.join(workspaceDir, 'resumes', 'exports'),
    path.join(workspaceDir, 'companies', profile),
    path.join(workspaceDir, '.githooks'),
  ];

  for (const dir of directoriesToEnsure) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 2. Prepare file manifests
  const filesToScaffold: Array<{
    relativePath: string;
    content: string;
    mode?: number;
  }> = [];

  // .featherduster/config.yaml
  const configObj: Record<string, any> = {
    active_profile: profile,
    default_export_target: 'markdown',
    port,
    export_targets: ['markdown', 'html', 'typst', 'latex', 'brag'],
  };
  if (blockPush) {
    configObj.block_push = true;
  }
  filesToScaffold.push({
    relativePath: path.join('.featherduster', 'config.yaml'),
    content: yaml.dump(configObj, { indent: 2 }),
  });

  // .featherduster/privacy-rules.yaml
  const privacyObj = {
    rules: {
      strip_patterns: ['[A-Z]{2,10}-\\d+', 'CONF-\\d+', 'SECRET-\\d+'],
      replacements: [
        { search: 'SampleCorp', replace: 'Enterprise Client' },
        { search: 'ProjectTitan', replace: 'Core Infrastructure Migration' },
      ],
      banned_keywords: ['CONFIDENTIAL', 'TOP_SECRET', 'PROPRIETARY_ALGO'],
    },
  };
  filesToScaffold.push({
    relativePath: path.join('.featherduster', 'privacy-rules.yaml'),
    content: yaml.dump(privacyObj, { indent: 2 }),
  });

  // evidence/sample-company/ev-001-starter.md
  const starterEvidence = `---
id: ev-001
date: '2026-01-15'
company: ${profile}
title: Production Microservice Migration & Scalability Hardening
summary: Led architectural migration from monolithic backend to distributed microservices.
impact: Reduced p99 latency by 45% and eliminated single points of failure across core payment flows.
themes:
  - architecture
  - distributed-systems
  - performance
confidence: verified
in_flight: false
metrics:
  - name: latency reduction
    value: 45%
    status: verified
  - name: availability
    value: 99.99%
    status: verified
internal_references:
  - type: pr
    ref: '#1042'
  - type: ticket
    ref: ARCH-582
---

# Production Microservice Migration & Scalability Hardening

## Context & Problem
The legacy monolithic application was experiencing cascading timeouts during peak traffic, with p99 latency spiking to 1,200ms and tight database coupling causing deployment friction.

## Technical Actions
- Designed and extracted three core bounded contexts into asynchronous, gRPC-backed microservices.
- Implemented distributed tracing with OpenTelemetry and connection pooling in Go.
- Established automated blue-green deployment pipelines with canary health checks.

## Measured Impact & Outcomes
- Reduced p99 API latency by 45% (down from 1,200ms to 660ms).
- Maintained 99.99% system availability throughout the migration.
`;
  filesToScaffold.push({
    relativePath: path.join('evidence', profile, 'ev-001-starter.md'),
    content: starterEvidence,
  });

  // rubrics/engineering-ic.yaml
  filesToScaffold.push({
    relativePath: path.join('rubrics', 'engineering-ic.yaml'),
    content: yaml.dump(SWE_IC_RUBRIC, { indent: 2 }),
  });

  // resumes/templates/starter.md
  const starterResume = `# Morgan Blake
Staff Software Engineer

morgan.blake@example.com | (555) 019-2834 | San Francisco, CA | github.com/mblake | linkedin.com/in/mblake

## Summary
Staff Software Engineer with 10+ years specializing in distributed systems, high-throughput cloud infrastructure, and technical leadership across high-growth engineering teams.

## Experience
### Staff Software Engineer - Sample Company
2024-01 - Present | Remote

- Led architectural migration from monolithic backend to distributed microservices, reducing p99 latency by 45% (ev-001).
- Maintained 99.99% system availability while establishing automated blue-green deployment pipelines (ev-001).

## Education
### B.S. Computer Science - University of California, Berkeley
2014 - 2018

## Skills
- **Languages**: Go, TypeScript, Python, Rust, SQL
- **Systems & Cloud**: AWS, Kubernetes, Docker, PostgreSQL, Redis, gRPC, OpenTelemetry
`;
  filesToScaffold.push({
    relativePath: path.join('resumes', 'templates', 'starter.md'),
    content: starterResume,
  });

  // resumes/tailored/starter.yaml
  const starterSpec = {
    profile: {
      name: 'Morgan Blake',
      title: 'Staff Software Engineer',
      email: 'morgan.blake@example.com',
      phone: '+1 (555) 019-2834',
      location: 'San Francisco, CA',
      links: {
        github: 'https://github.com/mblake',
        linkedin: 'https://linkedin.com/in/mblake',
      },
    },
    summary:
      'Staff Software Engineer with 10+ years specializing in distributed systems, high-throughput cloud infrastructure, and technical leadership across high-growth engineering teams.',
    experiences: [
      {
        company: 'Sample Company',
        role: 'Staff Software Engineer',
        location: 'Remote',
        startDate: '2024-01',
        endDate: 'Present',
        bullets: [
          {
            text: 'Led architectural migration from monolithic backend to distributed microservices, reducing p99 latency by 45% (ev-001).',
            citations: ['ev-001'],
          },
          {
            text: 'Maintained 99.99% system availability while establishing automated blue-green deployment pipelines (ev-001).',
            citations: ['ev-001'],
          },
        ],
      },
    ],
    education: [
      {
        institution: 'University of California, Berkeley',
        degree: 'B.S. Computer Science',
        year: '2018',
      },
    ],
    skills: [
      {
        category: 'Languages',
        skills: ['Go', 'TypeScript', 'Python', 'Rust', 'SQL'],
      },
      {
        category: 'Systems & Cloud',
        skills: ['AWS', 'Kubernetes', 'Docker', 'PostgreSQL', 'Redis', 'gRPC', 'OpenTelemetry'],
      },
    ],
  };
  filesToScaffold.push({
    relativePath: path.join('resumes', 'tailored', 'starter.yaml'),
    content: yaml.dump(starterSpec, { indent: 2 }),
  });

  // companies/sample-company/profile.yaml
  const companyProfile = {
    company: profile,
    name: 'Sample Company',
    title_public: 'Senior Software Engineer',
    title_internal: 'Senior Software Engineer',
    role: 'Senior Software Engineer',
    start: '2024-01',
    end: 'Present',
    location: 'Remote',
    status: 'active',
    description: 'High-growth technology organization building distributed cloud platforms.',
    names_public: ['Sample Company'],
    names_ledger_only: ['InternalCodename', 'ProjectTitan'],
    ownership: {
      owned: ['Core distributed microservice architecture'],
      contributed: ['Shared API gateways and telemetry pipelines'],
      implemented: ['Blue-green deployment infrastructure'],
    },
  };
  filesToScaffold.push({
    relativePath: path.join('companies', profile, 'profile.yaml'),
    content: yaml.dump(companyProfile, { indent: 2 }),
  });

  // AGENT.md
  filesToScaffold.push({
    relativePath: 'AGENT.md',
    content: loadTemplate('AGENT.md'),
  });

  // .githooks/pre-push
  filesToScaffold.push({
    relativePath: path.join('.githooks', 'pre-push'),
    content: loadTemplate('pre-push.sh'),
    mode: 0o755,
  });

  // .claude/settings.json (Git push defense permissions)
  filesToScaffold.push({
    relativePath: path.join('.claude', 'settings.json'),
    content: loadTemplate('claude-settings.json'),
  });

  // Bundled skills in .featherduster/skills and .claude/skills
  const templatesDir = getTemplatesDir();
  const skillsTemplateDir = templatesDir ? path.join(templatesDir, 'skills') : '';
  const skillFiles = collectSkillFiles(skillsTemplateDir);

  for (const skillFile of skillFiles) {
    filesToScaffold.push({
      relativePath: path.join('.featherduster', 'skills', skillFile.relativeSubPath),
      content: skillFile.content,
    });
    filesToScaffold.push({
      relativePath: path.join('.claude', 'skills', skillFile.relativeSubPath),
      content: skillFile.content,
    });
  }

  // 3. Write files with idempotency
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const item of filesToScaffold) {
    const fullPath = path.join(workspaceDir, item.relativePath);
    const normalizedRelative = item.relativePath.replace(/\\/g, '/');

    if (fs.existsSync(fullPath) && !force) {
      skippedFiles.push(normalizedRelative);
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, item.content, 'utf-8');
      if (item.mode) {
        try {
          fs.chmodSync(fullPath, item.mode);
        } catch {
          // ignore chmod errors on systems that do not support it
        }
      }
      createdFiles.push(normalizedRelative);
    }
  }

  // 4. Configure git hooks if git repository
  const gitHooksConfigured = setupGitConfig(workspaceDir, blockPush);

  return {
    workspaceDir,
    success: true,
    createdFiles,
    skippedFiles,
    gitHooksConfigured,
  };
}

/**
 * Headless CLI command runner for workspace initialization.
 */
export async function runInitCommand(
  options?: RunInitOptions | string
): Promise<InitWorkspaceResult> {
  const opts: RunInitOptions =
    typeof options === 'string' ? { workspace: options } : options || {};

  try {
    const result = await initWorkspace(opts);

    if (!opts.silent) {
      console.log('\n' + pc.bold(pc.cyan('Featherduster Workspace Initializer')) + '\n');
      console.log(pc.gray(`Target: ${result.workspaceDir}\n`));

      for (const file of result.createdFiles) {
        console.log(`  ${pc.green('✔')} Created  ${pc.bold(file)}`);
      }
      for (const file of result.skippedFiles) {
        console.log(
          `  ${pc.yellow('⚠')} Skipped  ${file} (already exists, use --force to overwrite)`
        );
      }

      if (result.gitHooksConfigured) {
        console.log(`  ${pc.green('✔')} Git hook configured: core.hooksPath -> .githooks`);
      } else {
        console.log(
          `  ${pc.gray('•')} Note: Not a git repository or git not initialized. .githooks/pre-push created.`
        );
      }

      console.log('\n' + pc.green('✔ Workspace initialized successfully!') + '\n');
      console.log('Next steps:');
      console.log(`  ${pc.cyan('featherduster')}        Start local web UI and API server`);
      console.log(`  ${pc.cyan('featherduster check')}  Run citation & privacy integrity audit\n`);
    }

    return result;
  } catch (err: any) {
    if (!opts.silent) {
      console.error(pc.red(`Failed to initialize workspace: ${err.message}`));
    }
    if (opts.exitOnError !== false) {
      process.exit(1);
    }
    throw err;
  }
}
