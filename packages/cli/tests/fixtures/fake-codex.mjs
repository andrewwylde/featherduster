// Minimal stand-in for the Codex CLI used by runner and settings tests.
import fs from 'node:fs';

const args = process.argv.slice(2);
const record = process.env.FAKE_CODEX_RECORD;
const auth = process.env.FAKE_CODEX_AUTH || 'chatgpt';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (d) => (data += d));
    process.stdin.on('end', () => resolve(data));
  });
}

if (args[0] === '--version') {
  process.stdout.write('codex-cli 9.9.9\n');
  process.exit(0);
}

if (args[0] === 'login' && args[1] === 'status') {
  if (auth === 'out') {
    process.stderr.write('Not logged in\n');
    process.exit(1);
  }
  process.stderr.write(auth === 'apikey' ? 'Logged in using an API key - sk-proj-abcdefghijklmnopqrstuvwxyz\n' : 'Logged in using ChatGPT\n');
  process.exit(0);
}

if (args[0] === 'login' && args.includes('--with-api-key')) {
  const key = (await readStdin()).trim();
  if (record) fs.writeFileSync(record, JSON.stringify({ keyLength: key.length, hasEnvKey: !!process.env.OPENAI_API_KEY }));
  process.stdout.write(`Successfully logged in using API key ${key}\n`);
  process.exit(key.startsWith('sk-') ? 0 : 1);
}

if (args[0] === 'login') {
  if (args.includes('--device-auth')) {
    process.stdout.write('To sign in, visit https://auth.openai.com/codex/device and enter code ABCD-EFGH\n');
  } else {
    process.stdout.write('Starting local login server. If your browser did not open, navigate to https://auth.openai.com/oauth/authorize?client=codex\n');
  }
  const mode = process.env.FAKE_CODEX_LOGIN || 'ok';
  if (mode === 'hang') setInterval(() => {}, 1000);
  else setTimeout(() => process.exit(mode === 'ok' ? 0 : 1), 200);
} else if (args[0] === 'logout') {
  process.stdout.write('Successfully logged out\n');
  process.exit(0);
} else if (args[0] === 'exec') {
  const stdin = await readStdin();
  const out = args[args.indexOf('-o') + 1];
  const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf-8'));
  if (record) {
    fs.writeFileSync(
      record,
      JSON.stringify({ args, stdin, schema, cwd: process.cwd(), cwdEntries: fs.readdirSync(process.cwd()), hasEnvKey: !!process.env.OPENAI_API_KEY })
    );
  }
  const mode = process.env.FAKE_CODEX_MODE || 'ok';
  if (mode === 'hang') {
    setInterval(() => {}, 1000);
  } else {
    process.stdout.write(JSON.stringify({ type: 'turn.started' }) + '\n');
    process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'thinking' } }) + '\n');
    if (mode === 'auth') {
      process.stderr.write('Error: Not logged in. Run codex login.\n');
      process.exit(1);
    }
    fs.writeFileSync(out, mode === 'text' ? 'not json' : JSON.stringify({ word: 'PINEAPPLE' }));
    process.exit(0);
  }
}
