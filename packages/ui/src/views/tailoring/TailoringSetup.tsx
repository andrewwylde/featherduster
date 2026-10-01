import React from 'react';
import { Cloud, HardDrive, Sparkles } from 'lucide-react';
import type { SetupPayload } from '@featherduster/core';
import type { ResumeRecord, RunnerInfo } from '../../api/client';
import { cardClass, inputClass, primaryButton, secondaryButton } from './ui';
export function TailoringSetup({ value, onChange, resumes, runners, creating, createError, onSubmit, onCancel, onOpenSettings }: {
  value: SetupPayload; onChange: (value: SetupPayload) => void; resumes: ResumeRecord[]; runners: RunnerInfo[];
  creating: boolean; createError: string | null; onSubmit: () => void; onCancel: () => void; onOpenSettings?: () => void;
}) {
  const { posting, label, baseResumeId: baseResume, runner } = value;
  const selectedRunner = runners.find(r => r.id === runner);
  const canCreate = posting.trim().length >= 20 && !!baseResume && !!runner && !creating;
  const handleCreate = (event: React.FormEvent) => { event.preventDefault(); if (canCreate) onSubmit(); };
  return (
<form onSubmit={handleCreate} className={`${cardClass} p-5 lg:p-6 space-y-4`} aria-label="New tailoring run">
          <div>
            <label htmlFor="tailor-posting" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Job posting
            </label>
            <textarea
              id="tailor-posting"
              rows={9}
              value={posting}
              onChange={(e) => onChange({ ...value, posting: e.target.value })}
              placeholder="Paste the full job posting text…"
              className={`${inputClass} mt-1.5 font-sans leading-relaxed`}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="tailor-label" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Run name <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="tailor-label"
                value={label}
                onChange={(e) => onChange({ ...value, label: e.target.value })}
                placeholder="acme-staff-platform"
                className={`${inputClass} mt-1.5`}
              />
            </div>
            <div>
              <label htmlFor="tailor-base" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Base resume
              </label>
              <select id="tailor-base" value={baseResume} onChange={(e) => onChange({ ...value, baseResumeId: e.target.value })} className={`${inputClass} mt-1.5`}>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tailor-runner" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Model runner
              </label>
              <select
                id="tailor-runner"
                value={runner}
                onChange={(e) => onChange({ ...value, runner: e.target.value })}
                className={`${inputClass} mt-1.5`}
              >
                {runners.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                    {r.available ? '' : ' (unavailable)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedRunner && (
            <p
              className={`flex items-start gap-2 text-xs leading-relaxed ${
                selectedRunner.available ? 'text-slate-600 dark:text-slate-400' : 'text-amber-800 dark:text-amber-300'
              }`}
            >
              {selectedRunner.locality === 'cloud' ? (
                <Cloud className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              ) : (
                <HardDrive className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              )}
              <span>
                {selectedRunner.detail}.{' '}
                {selectedRunner.locality === 'cloud'
                  ? 'Cloud runner: evidence is redacted with your privacy rules before it is sent.'
                  : 'Local runner: evidence never leaves this machine.'}{' '}
                {onOpenSettings && (
                  <button type="button" onClick={onOpenSettings} className="font-medium text-vermilion-600 underline dark:text-vermilion-400">
                    Configure runners
                  </button>
                )}
              </span>
            </p>
          )}

          {createError && (
            <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
              {createError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button type="button" className={secondaryButton} onClick={() => onCancel()}>
              Cancel
            </button>
            <button type="submit" className={primaryButton} disabled={!canCreate}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {creating ? 'Creating…' : 'Create run'}
            </button>
          </div>
        </form>
  );
}
