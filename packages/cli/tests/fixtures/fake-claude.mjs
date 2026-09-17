// Minimal stand-in for the Claude Code CLI used by runner tests.
import fs from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';

if (args.includes('--version')) {
  process.stdout.write('9.9.9 (Claude Code)\n');
  process.exit(0);
}

let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  const record = {
    args,
    cwd: process.cwd(),
    cwdEntries: fs.readdirSync(process.cwd()),
    stdin,
    system: fs.readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf-8'),
  };
  if (process.env.FAKE_CLAUDE_RECORD) fs.writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify(record));

  const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  emit({ type: 'system', subtype: 'init', model: 'claude-test' });

  if (mode === 'hang') {
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'auth') {
    emit({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' });
    process.exit(1);
  }
  if (mode === 'text-json') {
    emit({ type: 'result', is_error: false, result: '{"word":"fallback"}' });
    process.exit(0);
  }
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }] } });
  emit({ type: 'result', is_error: false, result: '', structured_output: { word: 'PINEAPPLE' } });
  process.exit(0);
});
