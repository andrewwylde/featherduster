// Minimal stand-in for the Typst CLI used by renderer and server tests.
import fs from 'node:fs';

const args = process.argv.slice(2);
// ok = compiles, fail = emits diagnostics, missing = behaves like an absent binary
const mode = process.env.FAKE_TYPST_MODE || 'ok';
const pageCount = Number(process.env.FAKE_TYPST_PAGES || '1');

// Lets a test make the binary "disappear" mid-run, to prove detection caching.
const vanishWhen = process.env.FAKE_TYPST_VANISH_WHEN;

if (mode === 'missing' || (vanishWhen && fs.existsSync(vanishWhen))) {
  process.stderr.write('typst: command not found\n');
  process.exit(127);
}

if (args[0] === '--version') {
  process.stdout.write('typst 0.13.1 (fake)\n');
  process.exit(0);
}

if (args[0] === 'compile') {
  // Lets a test hold a render open long enough to check the server still answers.
  const delayMs = Number(process.env.FAKE_TYPST_DELAY_MS || '0');
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

  if (mode === 'fail') {
    process.stderr.write('error: unknown variable: wobble\n  ┌─ resume.typ:7:3\n');
    process.exit(1);
  }

  const format = args[args.indexOf('--format') + 1];
  const input = args[args.length - 2];
  const output = args[args.length - 1];
  const source = fs.readFileSync(input, 'utf-8');

  if (format === 'pdf') {
    fs.writeFileSync(output, `%PDF-1.7\n% fake pdf from ${source.length} bytes of typst\n%%EOF\n`);
  } else {
    if (!output.includes('{n}')) {
      process.stderr.write('error: output path must contain {n}\n');
      process.exit(1);
    }
    // Real typst zero-pads to the width of the page count (page-01.svg ...
    // page-18.svg). FAKE_TYPST_PAD=off drops the padding so the numeric sort is
    // tested on names where a lexical sort would get the order wrong.
    const pad = process.env.FAKE_TYPST_PAD === 'off' ? 1 : String(pageCount).length;
    for (let n = 1; n <= pageCount; n++) {
      fs.writeFileSync(
        output.replace('{n}', String(n).padStart(pad, '0')),
        `<svg xmlns="http://www.w3.org/2000/svg" data-page="${n}"><title>page ${n}</title></svg>`
      );
    }
  }
  process.exit(0);
}

process.stderr.write(`fake-typst: unexpected args ${args.join(' ')}\n`);
process.exit(2);
