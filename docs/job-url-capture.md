# Job URL capture and recovery

URL preview first requests the public posting over HTTPS. If the site returns
HTTP 403, returns unsupported content, or exposes no usable posting in its
HTML, Featherduster makes one capture attempt in a temporary Chromium window.
The window closes after capture. Saving remains a separate action and does
not start resume preparation or submit an application.

Browser capture uses a fresh session. It does not read your browser profile,
reuse logins, accept a login prompt, or solve a CAPTCHA. A site that still
requires a human check can be saved as a link, then completed by pasting the
posting text. Preview labels that result **Link only — posting needed**.

## Installation

Install dependencies and the matching Chromium binary from the repository:

```powershell
npm install
npx playwright install chromium
npm run build
```

Browser fallback requires a desktop session on the machine running the app.
If the browser binary or desktop is unavailable, the specific failure appears
and paste recovery remains available. Featherduster does not install a browser
automatically or attach to an existing browser session.

## Diagnostics and saved provenance

Preview shows specific failures such as **HTTP 403**, **HTTP 404**, rate
limiting, timeout, DNS failure, or unavailable browser capture. Successful
recovery says **Captured with browser**. **Capture details** lists both attempts
and their destination URLs. The saved job and successful posting snapshot
retain that history; the Posting page exposes it after reload.

Older saved captures remain readable. Their missing historical HTTP statuses
cannot be reconstructed, and this change does not automatically recapture
them or alter existing resumes, evidence, or approvals.

Loading-only or explicitly busy HTML is not saved as a completed posting.
Browser capture waits up to five seconds for an extractable heading or
discovery result. An unfinished shell remains a recoverable extraction failure
even if it contains substantial navigation text.

## Network and resource boundaries

- Both transports accept public HTTPS destinations without credentials or
  custom ports. All DNS answers must be public; the selected address is pinned.
- Browser navigation, redirects, scripts, and subrequests use a short-lived
  loopback CONNECT proxy. It resolves, validates, and pins each connection;
  checking a URL in a browser route alone would not prevent DNS rebinding.
- Browser requests allow GET and HEAD. POSTs, WebSockets, service workers,
  downloads, and unnecessary image/font/media requests are blocked. Some
  sites that require POST-based data loading will still need pasted text.
- Browser capture has a 40-second deadline, a two-browser concurrency limit,
  a 150-request limit, a 32 MiB tunnel-transfer limit, and a 2 MiB HTML limit.
  The direct request retains its separate 15-second deadline.
- Invalid/private destinations, DNS failures, oversized responses, HTTP 429,
  and other HTTP errors do not trigger a browser attempt. This avoids
  retrying rate limits or using the browser to evade destination restrictions.

## Verification

Task Master task 68 covers this implementation. Regression commands:

```powershell
npx vitest run packages/cli/tests/jobs-intake.test.ts packages/cli/tests/posting-browser.test.ts packages/ui/tests/job-intake-default.test.tsx
npm run build
```

The tests cover status retention, browser recovery and failure, persisted
attempt history, safe fallback, private and mixed DNS destinations, pinned
connections, JavaScript-rendered content in real Chromium, browser cleanup,
and preview labels. Existing intake, job-route, artifact, and UI regressions
also run against the extended optional snapshot fields.

On November 9, 2026, the supplied Shutterfly posting returned 403 to the direct
request and to headless Chromium. Normal Chromium captured the posting through
the destination-validating proxy. A live intake check recovered the title and
description in about five seconds. The browser does not override the site's
challenge or fabricate successful capture when a barrier remains.

Private verification receipts are in
`walkthrough-output/capture-fix-2026-11-09/`. The earlier
[Shutterfly walkthrough](shutterfly-live-job-attempt-2026-11-09.md) describes
the pre-fix behavior and remains a historical record.
