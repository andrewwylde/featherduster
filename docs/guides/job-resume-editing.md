# Editing a job resume

Open the job and select Resume. The generated PDF is the main view. Edit resume opens its job-linked editor. Details contains checks, corrections, comparison and evidence, versions, and more export options.

Checks run as you edit. Save draft preserves incomplete work, even when checks identify issues. Finalize resume becomes available when the current edits pass their required checks. Finalizing generates the updated PDF for this job and returns to its preview. It does not create a reusable variant, approve the resume, or submit an application.

While draft changes are pending, the review page shows the previous finalized PDF. Download previous PDF downloads that version, excluding your pending edits. Previous versions remain in Version history.

If checking is unavailable, retry checks; you can still save. If saving conflicts with a newer revision, review the latest saved revision before saving your retained local edits. If finalization fails, the draft and previous PDF remain available. A pending finalization can be checked again using its original request without creating another artifact.

When checks require input review, choose **Review current inputs** to open the job's **Inputs** view. Review the saved job context and posting, select a saved starting resume, then choose **Prepare with current inputs**. This captures fresh inputs and requests a new preparation. Saved drafts and previous PDFs remain available; edits from the old draft are not automatically carried into the new resume. Opening the review does not start preparation.

The standalone canvas's resume selector supports searching names and types, including ordered-character matches such as `snr eng` for Senior Engineer. Jobs intake starts in URLs; choose Posting text to paste a posting.

## Verify the workflow

Run `npm test` and `npm run build` from the repository root. Then capture a disposable workspace and independently check its current served build and saved outcomes:

```sh
node scripts/run-resume-finalization-walkthrough.mjs capture --evidence-dir walkthrough-output/resume-finalization --manifest walkthrough-output/resume-finalization/manifest.json
node scripts/run-resume-finalization-walkthrough.mjs identity --evidence-dir walkthrough-output/resume-finalization
```

The walkthrough requires Python (for lossless plain-text trace extraction), Playwright Chromium, LaTeX (`pdflatex`), and Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`). Capture runs the current build and complete test suite before starting the fixture browser, retaining their actual command results and logs; allow several minutes. Put those tools on PATH. Alternatively, set `POPPLER_BIN` to the Poppler binary directory; on Windows the runner also recognizes `%LOCALAPPDATA%/Programs/poppler/Library/bin`. Xpdf is not a substitute for Poppler. The browser is visible by default; set `HEADLESS=1` for a machine without a desktop.

Capture creates a new temporary workspace, with realistic synthetic evidence, multiple roles, saved corrections, preparation history, and at least twenty variants. Only the model runner is deterministic; API handlers, database writes, validation, LaTeX, and PDF text/page checks are real. Delayed and lost-response exercises use actual server responses. No existing career workspace or user job is edited.

The output contains screenshots at 1440px and 375px, a Playwright trace, and previous/current PDF downloads. The manifest follows `CaptureManifest` in `adws/adw_modules/data_types.py`: only `served_build_identity`, `outcome_identity`, `identity_method`, `observation`, `scenario_ids`, and `artifacts`. Detailed viewport, fixture, served-asset and progression metadata is in the referenced `capture-state.json`; each artifact has a relative path and a `screenshot`, `trace`, or `state` kind.

Reviewers do not need a ZIP viewer: `trace-actions.jsonl`, `trace-events.jsonl` and `trace-network.jsonl` preserve original Playwright text records from the archive. `trace-api.jsonl` also resolves the archived JSON request/response resource bodies, exposing exact checked bindings, saved revisions and finalization responses without a ZIP viewer. `interaction-journal.jsonl` records observed UI fields, focus, current status, actual requests and held/lost server responses. Plain `.pdf.txt` and `.pdf.info.txt` artifacts expose the actual downloaded documents' text and page metadata. Capture also executes two real read-only identity subprocesses and a negative probe against a cloned disposable fixture with a newly saved pending draft. `identity-probes.json`, raw stdout/error files, before/after evidence hashes and command-log entries make their execution, matching identities, regression rejection and evidence immutability inspectable. Build/test logs and the approved eleven-task plan/source index are referenced evidence, not a replacement for independent review.

Keep the temporary workspace named in `fixture.json` until identity checking is finished. Identity starts the current built app, re-reads revisions and receipts, verifies freshness and PDF text/page coverage, compares the served PDF with the captured download, and hashes freshly served HTML and assets. Its stdout contains only a `CurrentIdentity` JSON object with `served_build_identity` and `outcome_identity`. The controller compares these fresh identities with the manifest. Identity writes no files into the captured evidence directory, including on failure; temporary PDF verification runs outside it. Rebuilds that change served assets require a new capture. These are browser viewport checks, not physical-device testing.

