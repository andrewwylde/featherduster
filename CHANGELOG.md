# Changelog

## 0.3.0-rc.1 — local candidate, November 10, 2026

This candidate adds browser-assisted posting capture and incorporates the
recent resume-review, recovery, and evidence-workflow changes. It is prepared
locally for review and has not been published. Version 0.2.0 also remains an
unpublished GitHub draft; this entry does not imply a prior public release.

### Job capture

- Preserve specific HTTP failures and capture-attempt history through save and
  reload. Distinguish a saved link needing posting text from a captured job.
- Recover HTTP 403 and unusable HTML through a temporary, isolated Chromium
  window. Validate and pin public destinations for browser network traffic,
  preserve bounded work, and retain paste recovery when capture remains blocked.
- Reject loading-only and busy page shells. Wait for rendered posting content,
  including when the title appears before the description, instead of saving
  navigation or placeholder text as a completed capture.

### Resume preparation and review

- Save generated wording changes and inherited-resume corrections together,
  preserve acknowledged edits across reload, and show inherited corrections in
  the final PDF change summary.
- Show the captured starting resume separately from the next-run selection,
  with searchable, namespaced resume identities.
- Improve progress stage, dispatched-call counts, terminal timing, and semantic
  failure isolation. Keep technical failures separate from factual questions.
- Expand supported accomplishment selection and shared employment-fact support,
  while retaining source bindings, job-specific drafts, and final PDF approval.

### Installation and remaining work

Browser capture requires a desktop session and the matching Chromium binary:
run `npx playwright install chromium` after `npm ci`. It uses a fresh session,
not the user's logged-in browser. See [capture details](docs/job-url-capture.md).

This is a release candidate, not a claim that every walkthrough finding is
resolved. Fresh skills operations can still contradict their intended result,
and the skills editor remains unreachable from the unified review path.
The current dependency audit reports three findings requiring disposition,
and the seven-job automatic-preparation test fails its readiness deadline.
See the [release assessment](docs/releases/v0.3.0-rc.1-validation.md) before
publication. No tag, push, npm publication, or GitHub release accompanies this
local version bump.

## 0.2.0 — 2026-10-22

This first GitHub release brings together Featherduster's local evidence ledger,
resume integrity checks, compilers, and job-specific resume preparation.

### Resume preparation and review

- Prepare multiple selected jobs with bounded automatic work. Conservative edits
  remove unsupported qualifiers; necessary factual questions pause only the
  affected job. Each final PDF still requires the user's review.
- Review proposals in a unified passage card with fact attestation and drawer
  navigation. Search source and resume selectors to find the starting material.
- Keep the generated resume in focus, with checks, evidence, comparisons, and
  history behind secondary navigation. Save job drafts independently of checks,
  review changed inputs directly, and finalize a new export when checks pass.
- Require the current rendered preview before approving a PDF. Preserve prior
  PDFs and invalidate approval when the reviewed content changes.

### Job tracking

- Open Jobs on **Needs work** and use **Mark applied** or **Archive job** to clear
  finished work. Applied, Archived, and All filters retain access to saved records.
- Restore archived jobs or correct an applied status without deleting resumes
  or history. Marking applied records an application made elsewhere; it sends
  nothing to an employer.
- Show tracking confirmations as dismissible toasts that clear after six seconds.
- Make reload/recovery actions visible as buttons and default job intake to URLs.

### Installation and upgrade

Featherduster is installed from source, not npm. Use Node 20 or newer:

```powershell
git clone --branch release/v0.2.0 https://github.com/andrewwylde/featherduster.git
cd featherduster
npm ci
npm run build
node packages/cli/dist/bin.js --version
node packages/cli/dist/bin.js C:\path\to\career --port 4173 --no-open
```

The release branch is available for draft testing. Once published, the `v0.2.0`
tag identifies the released source. Keep career workspaces outside this repository.
For an existing installation, back up the career workspace, stop its local server,
update the source, run `npm ci` and `npm run build`, and start the server again
against the same workspace. Refreshing the browser alone does not load backend changes.

Model-assisted preparation requires a configured runner and its consent/authentication.
Offline evidence browsing, integrity checks, and source compilation do not require
a model. PDF rendering requires the relevant local toolchain: Typst for Typst
previews, or `pdflatex` with the required template fonts/packages for LaTeX.
Verified LaTeX PDFs also require Poppler's `pdfinfo`, `pdftotext`, and `pdftoppm`.
The LaTeX templates require Latin Modern and `glyphtounicode`; install missing
packages explicitly. No model provider or PDF tooling is installed by this release.

### Validation limits

Release checks use disposable fixtures and configured test runners. They do not
establish the quality of responses from a live model provider. Review generated
resume content before using it for an application.
