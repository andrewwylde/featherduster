import fs from 'node:fs';
import path from 'node:path';
const [tool, ...args] = process.argv.slice(2);
const mode = process.env.MODE;
if (process.env.TRACE) fs.appendFileSync(process.env.TRACE, JSON.stringify({ tool, args, cwd: process.cwd() }) + '\n');
if (args.includes('--version') || args.includes('-v')) {
  if (process.env.MISSING === tool) process.exit(1);
  if (mode === 'probe-hang') await new Promise(r => setTimeout(r, 10000));
  console.error('fixture version 1');
} else if (tool === 'pdflatex') {
  if (mode === 'hang') await new Promise(r => setTimeout(r, 10000));
  if (mode === 'flood') process.stdout.write('x'.repeat(2000000));
  else if (mode === 'compile-error') { console.error('bad source'); process.exit(1); }
  else if (mode !== 'absent') {
    const data = mode === 'empty' ? '' : JSON.stringify({ pages: Number(process.env.PAGES ?? 1), text: process.env.TEXT ?? '', mode });
    fs.writeFileSync('resume.pdf', data);
  }
  console.log('Output written (1 page)');
} else {
  const file = tool === 'pdfinfo' ? args[0] : tool === 'pdftotext' ? args.at(-2) : args.at(-2);
  const pdf = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (tool === 'pdfinfo') console.log(pdf.mode === 'bad-info' ? 'Pages: nope' : `Pages: ${pdf.pages}`);
  if (tool === 'pdftotext') console.log(pdf.text);
  if (tool === 'pdftoppm') {
    if (pdf.mode === 'preview-error') process.exit(1);
    for (let p = 1; p <= pdf.pages; p++) {
      if (pdf.mode === 'missing-preview') continue;
      fs.writeFileSync(`${args.at(-1)}-${p}.png`, pdf.mode === 'bad-png' ? 'invalid' : Buffer.from([137,80,78,71,13,10,26,10,p]));
    }
  }
}
