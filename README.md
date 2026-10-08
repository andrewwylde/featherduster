# Featherduster

A local tool for keeping a résumé honest. Every bullet cites a dated evidence entry, and
`featherduster check` fails when a bullet cites something that doesn't exist or states a number
the evidence doesn't back up.

![Integrity audit flagging a dangling citation and unbacked metrics](docs/images/integrity-audit.png)

## Why

Résumé bullets drift. Across a few rewrites a number gets rounded up, a team result becomes a
personal one, and a year later nobody, including me, can say where a claim came from. I wanted
each line on my résumé to point at a note I wrote when the work happened, and I wanted a tool to
tell me when a line stopped pointing at anything.

## How it works

**Evidence** is a folder of markdown files, one per piece of work, with YAML frontmatter:

```yaml
# evidence/acme/ev-002-onboarding.md
---
id: ev-002
date: '2026-03-04'
company: acme
title: Rebuilt self-serve onboarding
impact: Fewer new accounts stall before their first project. [METRIC NEEDED]
confidence: provisional        # verified | provisional | retracted
metrics:
  - name: signup completion
    value: '[METRIC NEEDED]'
    status: missing
---
Context, what I did, and what changed, in plain prose.
```

**Résumés** are YAML specs in `resumes/tailored/`. Each bullet lists the evidence it relies on:

```yaml
- text: Rebuilt self-serve onboarding, lifting signup completion by 30% (ev-002).
  citations: [ev-002]
```

**`featherduster check`** reads both and exits non-zero when it finds:

- a citation that doesn't resolve to an evidence entry
- a bullet citing evidence whose metrics aren't marked verified (the "30%" above)
- an unresolved `[METRIC NEEDED]` token
- a banned keyword from `privacy-rules.yaml` (codenames, client names)
- stock filler phrases in markdown files ("spearheaded cross-functional synergies")

For the example above:

```
$ featherduster check
✖ [FAIL] Integrity check failed with 6 violation(s) across 7 files:

   DANGLING_CITATION  resumes/tailored/starter.yaml
    Dangling citation 'ev-007' cannot be resolved to any evidence entry

   MISSING_METRIC  resumes/tailored/starter.yaml:33
    Line 33: Evidence ev-002 contains unverified or missing metrics
   …
```

Run it in a pre-push hook or CI and an unbacked claim can't land quietly.

**`featherduster build`** compiles a spec to Markdown, print-ready HTML, Typst, LaTeX, a brag
doc grouped by a leveling rubric, or an interview prep brief. On the way out it strips citation
tags and applies `privacy-rules.yaml` (ticket-ID patterns removed, internal names swapped for
public ones).

**The web UI** (`featherduster [workspace]`, served on `127.0.0.1:4173`) browses and filters the
evidence, groups it into threads by theme, maps it against a leveling rubric, and shows the same
audit as `check`.

![Evidence explorer with verified, provisional, and needs-metrics counts](docs/images/evidence-explorer.png)

### Optional: tailoring to a job posting

Paste a posting and a model works through four steps you review one at a time: break down the
posting, match it to your evidence, propose cited edits, and write an interview prep brief. Each
proposed edit is re-checked by the same rules before you can accept it.

Runners: the Claude Code CLI, the Codex CLI, the Anthropic API, or a local Ollama model. Local
runners see raw text. Cloud runners only receive text after `privacy-rules.yaml` redaction, and
only after a one-time consent screen that shows the exact payload. This is the only feature that
sends anything off your machine; everything else works offline.

## Getting started

Featherduster isn't published to npm yet. Run it from a clone (Node 18+):

```bash
git clone https://github.com/andrewwylde/featherduster.git
cd featherduster
npm install
npm run build

# create a workspace (kept outside this repo; it holds your private notes)
node packages/cli/dist/bin.js init ~/career --block-push

node packages/cli/dist/bin.js check ~/career      # audit
node packages/cli/dist/bin.js ~/career            # web UI on http://127.0.0.1:4173
node packages/cli/dist/bin.js build -w ~/career --format typst -o resumes/exports/resume.typ
```

`init` creates a sample evidence entry, a starter résumé spec, a privacy rules file, an
engineering IC rubric, and an `AGENT.md` with the rules a coding agent should follow when
editing the workspace. `--block-push` adds a git pre-push hook that refuses to push the
workspace anywhere, since it's meant to hold unredacted notes about your employers.

## Limits

- `check` proves a bullet is traceable to an entry and that its numbers are marked verified. It
  can't prove the entry is true. If an entry is wrong, for example a PR attributed to you that
  someone else wrote, the bullet citing it passes. Check authorship when importing work history.
- `build` doesn't run `check`. Run `check` first, or wire it into a hook.
- An evidence file whose frontmatter fails validation is skipped, so it shows up as a dangling
  citation rather than a schema error.
- The filler-phrase scan covers markdown files, not résumé YAML specs.
- The canvas's built-in "Starter Template" uses hard-coded sample data, not your workspace.

## Code

TypeScript monorepo with npm workspaces:

| Package | What it is |
|---|---|
| `packages/core` | Zod schemas, evidence store, integrity checks, redaction, and the compilers. No I/O. |
| `packages/cli` | The `featherduster` command and a [Hono](https://hono.dev/) server bound to `127.0.0.1`. |
| `packages/ui` | React + Vite + Tailwind front end, served by the CLI. |

```bash
npm test          # Vitest across all packages
npm run build     # core → ui → cli
```

Much of this code was written with AI coding agents working from task lists; `adws/`,
`.taskmaster/`, and the Python files in `scripts/` are that tooling. I review and own what lands.

## License

MIT
