# Changelog

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
