import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

export function evidenceSnapshot(directory) {
  const result = {};
  const visit = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        assert.ok(entry.isFile(), 'Evidence must contain regular files only');
        result[path.relative(directory, file).replaceAll('\\', '/')] = {
          sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
          mtime: fs.statSync(file).mtimeMs,
        };
      }
    }
  };
  visit(directory); return result;
}

export function extractReadableTrace(zip, directory) {
  // Preserve original Playwright records rather than inventing an action summary.
  // Only known text entry suffixes are read; archive paths are never extracted.
  const script = `import json,sys,zipfile,pathlib
out=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(sys.argv[1]) as z:
    traces=[n for n in z.namelist() if n.endswith('.trace')]
    networks=[n for n in z.namelist() if n.endswith('.network')]
    assert traces and networks, 'Missing Playwright event/network records'
    for names,target in [(traces,'trace-events.jsonl'),(networks,'trace-network.jsonl')]:
        data=''.join(z.read(n).decode('utf-8') for n in sorted(names))
        (out/target).write_text(data,encoding='utf-8')
    rows=[json.loads(line) for n in sorted(traces) for line in z.read(n).decode('utf-8').splitlines() if line.strip()]
    actions=[r for r in rows if r.get('type') in ('before','after','input','event')]
    assert actions, 'Missing actual interaction records'
    (out/'trace-actions.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\\n' for r in actions),encoding='utf-8')
    api=[]
    def body(part):
        resource=part.get('_file') or ('resources/'+part['_sha1'] if part.get('_sha1') else None)
        text=z.read(resource).decode('utf-8') if resource else part.get('text','')
        return json.loads(text) if text else None
    for name in sorted(networks):
        for line in z.read(name).decode('utf-8').splitlines():
            snap=json.loads(line).get('snapshot',{})
            req=snap.get('request',{}); res=snap.get('response',{})
            if '/api/' not in req.get('url',''): continue
            content=res.get('content',{})
            api.append({'at':snap.get('startedDateTime'),'method':req.get('method'),'url':req.get('url'),
                'request':body(req.get('postData',{})) if 'json' in req.get('postData',{}).get('mimeType','') else None,
                'status':res.get('status'),'response':body(content) if 'json' in content.get('mimeType','') else None,
                'failure':snap.get('_failureText'),'timings':snap.get('timings')})
    (out/'trace-api.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\\n' for r in api),encoding='utf-8')
    print(json.dumps({'trace_entries':traces,'network_entries':networks,'events':len(rows),'actions':len(actions),'api_records':len(api)}))
`;
  return JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', script, zip, directory], { encoding: 'utf8', timeout: 30000 }));
}

export function runObservedCommand(argv, cwd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (exit_code, signal) => {
      clearTimeout(timer); resolve({ argv, exit_code, signal, stdout, stderr });
    });
  });
}
