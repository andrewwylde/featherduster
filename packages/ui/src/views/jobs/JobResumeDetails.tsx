import { secondaryButton } from '../tailoring/ui.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
export const resumeViews = { checks: 'Checks', corrections: 'Corrections', comparison: 'Comparison & evidence',
  history: 'Version history', exports: 'More export options' } as const;
export type ResumeDetailView = keyof typeof resumeViews;
export function JobResumeDetails({ preview, renderView, actions, notice }: {
  preview: ReactNode; renderView(view: ResumeDetailView): ReactNode; actions?: ReactNode;
  notice?: (open: (view: ResumeDetailView) => void) => ReactNode;
}) {
  const [view, setView] = useState<ResumeDetailView | null>(null), [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const menu = useRef<HTMLDivElement>(null), restore = useRef(false);
  const show = (value: ResumeDetailView) => { setOpen(false); setView(value); };
  useEffect(() => {
    if (view) heading.current?.focus();
    else if (restore.current) { trigger.current?.focus(); restore.current = false; }
  }, [view]);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [open]);
  return <section className="space-y-4 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">{actions}</div>
      <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
        <button className={secondaryButton} ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>Details</button>
        {open && <div ref={menu} role="menu" aria-label="Resume details" className="absolute right-0 z-20 mt-2 w-64 rounded-lg border bg-white p-1 text-slate-900 shadow-lg dark:bg-slate-900 dark:text-white"
          onKeyDown={e => {
            const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }
          }}>
          {(Object.keys(resumeViews) as ResumeDetailView[]).map(key => <button className="block min-h-11 w-full px-3 text-left" role="menuitem" key={key} onClick={() => show(key)}>{resumeViews[key]}</button>)}
        </div>}
      </div>
    </div>
    {notice?.(show)}
    {view ? <section className="space-y-4">
      <button className={secondaryButton} onClick={() => { restore.current = true; setView(null); }}>Back to resume</button>
      <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">{resumeViews[view]}</h2>
      {renderView(view)}
    </section> : preview}
  </section>;
}

