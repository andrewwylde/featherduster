# @featherduster/cli

The `featherduster` command and local server. See the [repository README](../../README.md).

Not published to npm yet; run it from a clone with `node packages/cli/dist/bin.js` after
`npm install && npm run build` at the repo root.

## Commands

- `featherduster [workspace]`: web UI on `http://127.0.0.1:4173`
- `featherduster init [workspace] [--block-push]`: create a workspace
- `featherduster check [workspace]`: audit citations, metrics, and privacy rules; exits 1 on violations
- `featherduster build -w <workspace> --format <markdown|html|typst|latex|brag|brief>`: compile a résumé spec

## License

MIT
