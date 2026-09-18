import React from 'react';
import {
  FileText,
  MessageSquare,
  BookOpen,
  Target,
  Shield,
  WandSparkles,
  Settings,
} from 'lucide-react';

export type DeskTab = 'briefing' | 'tailor' | 'threads' | 'evidence' | 'skills' | 'settings';

interface DeskSidebarProps {
  currentTab: DeskTab;
  onSelectTab: (tab: DeskTab) => void;
  onOpenOnboarding: () => void;
}

const pathByTab: Record<DeskTab, string> = {
  briefing: '/briefing',
  tailor: '/tailor',
  threads: '/threads',
  evidence: '/evidence',
  skills: '/skills',
  settings: '/settings',
};

export const DeskSidebar: React.FC<DeskSidebarProps> = ({
  currentTab,
  onSelectTab,
  onOpenOnboarding,
}) => {
  const navItems: Array<{ id: DeskTab; label: string; icon: React.ElementType }> = [
    { id: 'briefing', label: 'Briefing', icon: FileText },
    { id: 'tailor', label: 'Tailor', icon: WandSparkles },
    { id: 'threads', label: 'Threads', icon: MessageSquare },
    { id: 'evidence', label: 'Evidence', icon: BookOpen },
    { id: 'skills', label: 'Skills', icon: Target },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col justify-between border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f131d] p-6 select-none"
      aria-label="Main Navigation"
    >
      <div>
        <div className="mb-8">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Featherduster
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-snug">
            Private career intelligence.
          </p>
        </div>

        {/* Primary Navigation */}
        <nav className="space-y-1.5" aria-label="Desk sections">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <a
                key={item.id}
                href={pathByTab[item.id]}
                onClick={(event) => {
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    onSelectTab(item.id);
                  }
                }}
                className={`group relative flex w-full items-center gap-3 px-3 py-2.5 rounded-desk text-sm font-medium transition-colors text-left focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0f131d] focus-visible:outline-none ${
                  isActive
                    ? 'bg-vermilion-50/70 text-vermilion-600 dark:bg-vermilion-950/25 dark:text-vermilion-400 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/40'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                {/* Restrained vermilion left indicator bar */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-vermilion-500 rounded-r-full"
                    aria-hidden="true"
                  />
                )}
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive
                      ? 'text-vermilion-500 dark:text-vermilion-400'
                      : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'
                  }`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className="pt-6 border-t border-slate-100 dark:border-slate-800/60 space-y-3">
        <button
          onClick={onOpenOnboarding}
          className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors w-full text-left py-1 focus-visible:ring-2 focus-visible:ring-vermilion-500 focus-visible:outline-none rounded"
          title="Review local-first privacy foundation and starting paths"
        >
          <Shield className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
          <span>Privacy</span>
        </button>

        <p className="text-xs text-slate-600 dark:text-slate-400 font-normal leading-relaxed max-w-[140px]">
          Build what's next.
        </p>
      </div>
    </aside>
  );
};
