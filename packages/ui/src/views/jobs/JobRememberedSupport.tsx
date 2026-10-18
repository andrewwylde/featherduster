import { useCallback, useEffect, useState } from 'react';
import type { CorpusSnapshot, CorpusView, Job, SkillSupport } from '@featherduster/core';
import { apiClient } from '../../api/client.js';
import { useIntentKey } from '../../hooks/useJobsData.js';
import { appliesTo, sameRelationship, sourceTitles, supportDescription, uniqueLabels, withdrawEffect, withdrawLabel } from '../../components/corpus-labels.js';
import { ConfirmWithdraw } from '../../components/ConfirmWithdraw.js';

type Entry = CorpusView['history'][number];
const live = (e: Entry) => e.update.change.kind === 'skill_support' && !['withdrawn', 'superseded'].includes(e.state);

/**
 * Remembered relationships on one job: those offered to it (captured with its inputs) and those remembered from it.
 * Withdrawal is global through the corpus API; this job's captured inputs stay as they were.
 */
export function JobRememberedSupport({ job, support, titleOf, knowledge, refreshKey }: { job: Job; support: SkillSupport[]; titleOf: (id: string) => string; knowledge?: CorpusSnapshot; refreshKey?: number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [withdrawn, setWithdrawn] = useState<string[]>([]);
  const [here, setHere] = useState<{ view: CorpusView; entries: Entry[] } | null>(null);
  const [open, setOpen] = useState(false);
  const key = useIntentKey();
  const opts = { currentJobId: job.id };
  const withdraw = async (view: CorpusView, ids: string[]) => {
    let revision = view.snapshot.revision, done = 0;
    for (const id of ids) {
      const reason = `Withdrawn from ${job.company} — ${job.role}`;
      const body = { workspace_id: view.workspace_id, expected_revision: revision, explanation: reason, change: { kind: 'withdrawal' as const, update_id: id, reason } };
      try {
        const receipt = await apiClient.withdrawCorpusChange(id, { ...body, idempotency_key: key(body) });
        revision = receipt.result?.revision ?? revision + 1; done++;
      } catch (e) {
        const why = e instanceof Error ? e.message : 'Withdrawal failed';
        throw new Error(done ? `Withdrew ${done} of ${ids.length} matching relationships; ${why}. Try again to withdraw the rest.` : why);
      }
    }
  };
  /** Prefer the update ids this job captured with its inputs; otherwise match the live corpus. Only active updates are withdrawn. */
  const idsFor = (view: CorpusView, s: SkillSupport) => {
    const captured = new Set(knowledge?.updates.filter(u => u.change.kind === 'skill_support' && sameRelationship(s, u.change.value)).map(u => u.id) ?? []);
    const active = view.history.filter(live);
    return (captured.size ? active.filter(e => captured.has(e.update.id)) : active.filter(e => e.update.change.kind === 'skill_support' && sameRelationship(s, e.update.change.value))).map(e => e.update.id);
  };
  const run = async (action: () => Promise<string>) => {
    setBusy(true); setMessage('');
    try { setMessage(await action()); } catch (e) { setMessage(e instanceof Error ? e.message : 'Withdrawal failed'); } finally { setBusy(false); }
  };
  const loadHere = useCallback(async () => {
    try {
      const view = await apiClient.getCorpus();
      const ids = new Set(view.feedback.filter(f => f.feedback.job_id === job.id).map(f => f.feedback.id));
      setHere({ view, entries: view.history.filter(e => live(e) && ids.has(e.update.feedback_id)) });
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Remembered knowledge unavailable'); }
  }, [job.id]);
  useEffect(() => { if (open) void loadHere(); }, [open, loadHere, refreshKey]);
  const offered = (e: Entry) => e.update.change.kind === 'skill_support' && support.some(s => e.update.change.kind === 'skill_support' && sameRelationship(s, e.update.change.value));
  const hereEntries = here?.entries.filter(e => !offered(e)) ?? [];
  const hereTitle = (id: string) => here?.view.records.find(r => r.source.id === id)?.source.title || titleOf(id);
  // One pass over both lists keeps every withdraw name in this region unique.
  const allLabels = uniqueLabels([
    ...support.map(s => ({ label: withdrawLabel(s, opts), detail: sourceTitles(s, titleOf) })),
    ...hereEntries.map(e => e.update.change.kind === 'skill_support' ? { label: withdrawLabel(e.update.change.value, opts), detail: sourceTitles(e.update.change.value, hereTitle) } : { label: 'Withdraw' }),
  ]);
  const offerLabels = allLabels.slice(0, support.length), hereLabels = allLabels.slice(support.length);
  return <section aria-label="Remembered support" className="space-y-2 rounded-desk border border-slate-200 dark:border-slate-800 p-3 text-sm">
    <h3 className="font-semibold">Remembered support</h3>
    {support.length ? support.map((s, i) => {
      const done = withdrawn.includes(`offer:${i}`);
      return <div key={i} className="space-y-1">
        <p>Remembered support offered: {supportDescription(s, titleOf)}. {appliesTo(s.scope, opts)}.{done && ' Withdrawn; future preparations will not offer it.'}</p>
        {!done && <ConfirmWithdraw label={offerLabels[i]} effect={withdrawEffect(s.scope, opts)} disabled={busy} onConfirm={() => void run(async () => {
          const view = await apiClient.getCorpus();
          const ids = idsFor(view, s);
          if (!ids.length) { setWithdrawn(w => [...w, `offer:${i}`]); return 'Already withdrawn. Future preparations will not offer it.'; }
          await withdraw(view, ids); setWithdrawn(w => [...w, `offer:${i}`]); if (open) void loadHere();
          return 'Withdrawn. Future preparations will not offer it; this job keeps the inputs it captured.';
        })} />}
      </div>;
    }) : <p>No remembered relationships apply to this job.</p>}
    <details onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}><summary className="cursor-pointer">Remembered from this job</summary>
      {!here ? <p>Loading…</p> : hereEntries.length === 0 ? <p>{here.entries.length ? 'Everything remembered from this job is listed above.' : 'Nothing active was remembered from this job.'}</p> : hereEntries.map((e, i) => {
        const c = e.update.change;
        if (c.kind !== 'skill_support') return null;
        return <div key={e.update.id} className="space-y-1 py-1">
          <p>{supportDescription(c.value, hereTitle)}. {appliesTo(c.value.scope, opts)}.</p>
          <ConfirmWithdraw label={hereLabels[i]} effect={withdrawEffect(c.value.scope, opts)} disabled={busy} onConfirm={() => void run(async () => { await withdraw(here.view, [e.update.id]); await loadHere(); return 'Withdrawn. Future preparations will not offer it.'; })} />
        </div>;
      })}
    </details>
    <p role="status">{message}</p>
  </section>;
}
