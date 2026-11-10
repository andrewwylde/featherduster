# @featherduster/cli

The `featherduster` command and local server. See the [repository README](../../README.md).

Not published to npm yet; use Node 20+ and run it from a clone with `node packages/cli/dist/bin.js` after
`npm install && npm run build` at the repo root.

## Commands

- `featherduster [workspace]`: web UI on `http://127.0.0.1:4173`
- `featherduster init [workspace] [--block-push]`: create a workspace
- `featherduster check [workspace]`: audit citations, metrics, and privacy rules; exits 1 on violations
- `featherduster build -w <workspace> --format <markdown|html|typst|latex|brag|brief>`: compile a résumé, rubric-based brag doc, or private interview brief

`check` validates citations it finds and recognized metric flags; it does not compare claimed
numbers with evidence values. `build` does not run `check`, and `brief` output is unredacted
private preparation material. Initialize Git before `init --block-push` to activate the hook.

## Job URL capture

URL capture can open a temporary Chromium window when a direct request is
refused or cannot expose a usable posting. Run `npx playwright install chromium`
once from the repository after installing dependencies. A desktop session is
required; unavailable or blocked captures retain paste recovery. See
[capture behavior and diagnostics](../../docs/job-url-capture.md).

## License

MIT
