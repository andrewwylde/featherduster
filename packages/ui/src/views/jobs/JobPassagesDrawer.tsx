import { X, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';

export interface PassageDrawerItem {
  id: string;
  label: string;
  status: 'blocker' | 'fact_needed' | 'passing';
  proposalId?: string;
  candidatePath?: string;
}

export function JobPassagesDrawer({
  isOpen,
  onClose,
  passages,
  activeId,
  onSelectPassage,
}: {
  isOpen: boolean;
  onClose: () => void;
  passages: PassageDrawerItem[];
  activeId: string;
  onSelectPassage: (id: string) => void;
}) {
  if (!isOpen) return null;

  const blockersCount = passages.filter(p => p.status === 'blocker' || p.status === 'fact_needed').length;
  const passingCount = passages.filter(p => p.status === 'passing').length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Passage overview drawer"
      className="fixed inset-0 z-50 overflow-hidden bg-slate-950/60 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md h-full bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-500" />
              Resume Passages Overview
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {blockersCount} needing review · {passingCount} passing
            </p>
          </div>
          <button
            type="button"
            aria-label="Close drawer"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Drawer Body: Passage List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {passages.map((passage, index) => {
            const isSelected = passage.id === activeId;
            return (
              <button
                key={passage.id}
                type="button"
                onClick={() => {
                  onSelectPassage(passage.id);
                  onClose();
                }}
                className={`w-full text-left p-3 rounded-lg border transition-all flex items-start justify-between gap-3 ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 ring-1 ring-emerald-500'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700 text-slate-800 dark:text-slate-200'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-400">#{index + 1}</span>
                    <span className="text-xs font-semibold truncate">{passage.label}</span>
                  </div>
                </div>

                <div className="shrink-0">
                  {passage.status === 'blocker' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 px-2 py-0.5 text-[10px] font-medium">
                      <AlertTriangle className="h-3 w-3" />
                      Blocker
                    </span>
                  )}
                  {passage.status === 'fact_needed' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 px-2 py-0.5 text-[10px] font-medium">
                      <AlertTriangle className="h-3 w-3" />
                      Verify Fact
                    </span>
                  )}
                  {passage.status === 'passing' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      Passing
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
