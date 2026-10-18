import { useEffect, useState } from 'react';
import type { ArtifactVersion, Job } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { primaryButton, secondaryButton } from '../tailoring/ui.js';

type File = { name: string; type: string; confidential: boolean };
type Release = { id: string; created_at: string; files: File[]; unavailable_reason?: string };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Export failed. Your content and saved files are retained.');
  return result;
}

/** Compact, opt-in publication inside resume review. Historical files never claim freshness. */
/** A string `blocked` is the reason shown to the user; `true` means a historical or pending resume. */
export function JobExports({ job, artifact, blocked = false }: { job: Job; artifact: ArtifactVersion; blocked?: boolean | string }) {
  const [open, setOpen] = useState(false), [material, setMaterial] = useState('resume');
  const [files, setFiles] = useState<File[]>([]), [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Record<string, unknown> | null>(null), [reload, setReload] = useState(0);
  const base = `/api/jobs/${job.id}/exports`;
  useEffect(() => {
    if (!open) return;
    let live = true;
    setFiles([]); setSelection(null); setError(''); setNotice('');
    request<{ releases: Release[] }>(base).then(value => { if (live) setReleases(value.releases); }, e => { if (live) setError(e.message); });
    const check = async () => {
      if (blocked) throw new Error(typeof blocked === 'string' ? blocked : 'This is a historical or pending resume. Return to the current checked resume; saved releases remain below.');
      const next: Record<string, unknown> = { artifact_id: artifact.id, artifact_fingerprint: artifact.version_fingerprint, dossier: material === 'dossier' };
      for (const kind of ['cover_letter', 'interview_brief'] as const) {
        if (material !== kind && material !== 'all') continue;
        if (localStorage.getItem(`job-material:${job.workspace_id}:${job.id}:${kind}`)) throw new Error('This material has an unsaved draft. Return to its editor and save/check before exporting.');
        const value = await apiClient.getJobMaterial(job.id, kind);
        if (!value.current) throw new Error(`Create and review the ${kind === 'cover_letter' ? 'cover letter' : 'interview brief'} first. Resume exports do not require it.`);
        next[kind] = value.current.id;
      }
      const result = await request<{ files: File[] }>(`${base}/check?selection=${encodeURIComponent(JSON.stringify(next))}`);
      if (live) { setSelection(next); setFiles(result.files.filter(file => material === 'all' ? !file.confidential : material === 'resume' ? file.name.startsWith('resume.') : material === 'dossier' ? file.confidential : file.name.startsWith(material + '.'))); }
    };
    void check().catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [open, material, job.id, job.revision, job.workspace_id, artifact.id, artifact.version_fingerprint, blocked, reload, base]);
  const url = (name: string, download = true) => `${base}/current/${encodeURIComponent(name)}?selection=${encodeURIComponent(JSON.stringify(selection))}&download=${download ? '1' : '0'}`;
  const act = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); } finally { setBusy(false); }
  };
  return <details className="space-y-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Export and saved releases</summary>
    {open && <div className="space-y-3 text-sm">
      <p>Exports neither approve nor submit. Every current file is checked again when requested. Saved releases retain their original content. A bundle contains the resume formats plus the selected optional material; the dossier is included only when selected.</p>
      <label className="block">Material <select aria-label="Export material" className="ml-2 bg-transparent border rounded p-2" value={material} onChange={e => setMaterial(e.target.value)}>
        <option value="resume">Resume</option><option value="cover_letter">Cover letter</option><option value="interview_brief">Interview brief</option><option value="all">Resume, letter and interview brief</option><option value="dossier">Confidential evidence dossier</option>
      </select></label>
      {material === 'dossier' && <p role="note">Private candidate preparation only. This distinct dossier contains unredacted source evidence and tickets. Do not send it with an application.</p>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <button className={secondaryButton} disabled={busy} onClick={() => setReload(n => n + 1)}>Check current exports</button>
      <ul className="space-y-2">{files.map(file => <li key={file.name} className="flex flex-wrap gap-3 items-center">
        <button className={secondaryButton} disabled={busy || !selection} onClick={() => void act(async () => {
          const response = await fetch(url(file.name));
          if (!response.ok) { const value = await response.json(); throw new Error(value.error ?? 'Download failed'); }
          const blob = await response.blob(), href = URL.createObjectURL(blob), link = document.createElement('a');
          link.href = href; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
          setNotice(`Downloaded ${file.name}`);
        })}>Download {file.name}</button>
        {(file.type === 'text/html' || file.type === 'application/pdf') && <a className="underline" href={url(file.name, false)} target="_blank" rel="noreferrer">Open {file.name} to print</a>}
        {file.name.endsWith('.txt') && <button className={secondaryButton} disabled={busy} onClick={() => void act(async () => {
          const response = await fetch(url(file.name, false));
          if (!response.ok) { const value = await response.json(); throw new Error(value.error ?? 'Copy failed'); }
          const text = await response.text();
          try { await navigator.clipboard.writeText(text); } catch { throw new Error('Clipboard access is blocked by your browser. Download the .txt file instead.'); }
          setNotice('Copied saved text');
        })}>Copy plain text</button>}
      </li>)}</ul>
      <button className={primaryButton} disabled={busy || !selection || !files.length} onClick={() => void act(async () => {
        await request(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection, idempotency_key: crypto.randomUUID() }) });
        const value = await request<{ releases: Release[] }>(base); setReleases(value.releases); setNotice('Saved actual files and manifest. Reopen them below after reload.');
      })}>Save release bundle</button>
      <details><summary className="cursor-pointer">Saved releases ({releases.length}) — historical files</summary>
        {releases.map(release => <section key={release.id} className="py-3 space-y-2"><h3>{release.created_at} · {release.id.slice(0, 8)}</h3><a className="underline" href={`${base}/${release.id}/release.json?download=1`}>Download manifest</a>{release.unavailable_reason && <p role="alert">{release.unavailable_reason}</p>}<ul>{release.files.map(file => <li key={file.name}><a className="underline inline-block py-2" href={`${base}/${release.id}/${encodeURIComponent(file.name)}?download=1`}>{file.confidential ? 'Confidential · ' : ''}{file.name}</a>{(file.type === 'text/html' || file.type === 'application/pdf') && <> · <a className="underline" target="_blank" rel="noreferrer" href={`${base}/${release.id}/${encodeURIComponent(file.name)}`}>Open to print</a></>}</li>)}</ul></section>)}
      </details>
    </div>}
  </details>;
}
