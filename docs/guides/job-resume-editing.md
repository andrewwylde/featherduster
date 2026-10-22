# Editing a job resume

Open the job and select Resume. The generated PDF is the main view. Edit resume opens its job-linked editor. Details contains checks, corrections, comparison and evidence, versions, and more export options.

Checks run as you edit. Save draft preserves incomplete work, even when checks identify issues. Finalize resume becomes available when the current edits pass their required checks. Finalizing generates the updated PDF for this job and returns to its preview. It does not create a reusable variant, approve the resume, or submit an application.

While draft changes are pending, the review page shows the previous finalized PDF. Download previous PDF downloads that version, excluding your pending edits. Previous versions remain in Version history.

If checking is unavailable, retry checks; you can still save. If saving conflicts with a newer revision, review the latest saved revision before saving your retained local edits. If finalization fails, the draft and previous PDF remain available. A pending finalization can be checked again using its original request without creating another artifact.

When checks require input review, choose **Review current inputs** to open the job's **Inputs** view. Review the saved job context and posting, select a saved starting resume, then choose **Prepare with current inputs**. This captures fresh inputs and requests a new preparation. Saved drafts and previous PDFs remain available; edits from the old draft are not automatically carried into the new resume. Opening the review does not start preparation.

The standalone canvas's resume selector supports searching names and types, including ordered-character matches such as `snr eng` for Senior Engineer. Jobs intake starts in URLs; choose Posting text to paste a posting.

## Automated verification walkthrough

To verify the resume editing and finalization flow end-to-end, run the walkthrough script:

```sh
node scripts/run-resume-finalization-walkthrough.mjs capture --evidence-dir walkthrough-output/resume-finalization --manifest walkthrough-output/resume-finalization/manifest.json
node scripts/run-resume-finalization-walkthrough.mjs identity --evidence-dir walkthrough-output/resume-finalization
```

### Prerequisites
- Python 3.10+
- Playwright Chromium (`npx playwright install chromium`)
- LaTeX (`pdflatex`)
- Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) on `PATH` or configured via `POPPLER_BIN` (on Windows, `%LOCALAPPDATA%/Programs/poppler/Library/bin` is also recognized)

### What it tests
The walkthrough provisions an isolated temporary workspace with synthetic evidence and runs through the complete editing lifecycle:
- Launches a test server and drives the browser via Playwright (set `HEADLESS=1` for headless environments).
- Exercises draft saving, conflict resolution, validation checks, and finalization against real API handlers and SQLite state.
- Compiles the final résumé using LaTeX and validates page budget and text coverage.
- Outputs artifacts (screenshots, Playwright traces, request journals, and downloaded PDFs) into `--evidence-dir` for inspection.
- The `identity` step re-evaluates the running build and saved database records against the captured manifest to verify outcome reproducibility.
