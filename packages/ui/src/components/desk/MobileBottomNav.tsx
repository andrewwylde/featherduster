import React from 'react';
import {
  FileText,
  WandSparkles,
  MessageSquare,
  BookOpen,
  Target,
  Menu,
} from 'lucide-react';
import type { DeskTab } from './DeskSidebar';

interface MobileBottomNavProps {
  currentTab: DeskTab;
  onSelectTab: (tab: DeskTab) => void;
  onOpenMore: () => void;
  isMoreOpen: boolean;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentTab,
  onSelectTab,
  onOpenMore,
  isMoreOpen,
}) => {
  const primaryTabs: Array<{ id: DeskTab; label: string; icon: React.ElementType; ariaLabel: string }> = [
    { id: 'briefing', label: 'Briefing', icon: FileText, ariaLabel: 'Mobile Briefing' },
    { id: 'tailor', label: 'Tailor', icon: WandSparkles, ariaLabel: 'Mobile Tailor' },
    { id: 'threads', label: 'Threads', icon: MessageSquare, ariaLabel: 'Mobile Threads' },
    { id: 'evidence', label: 'Evidence', icon: BookOpen, ariaLabel: 'Mobile Evidence' },
    { id: 'skills', label: 'Skills', icon: Target, ariaLabel: 'Mobile Skills' },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#0f131d]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe md:hidden shadow-lg"
    >
      <div className="flex items-center justify-around h-14">
        {primaryTabs.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id && !isMoreOpen;

          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.ariaLabel}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelectTab(item.id)}
              className={`relative flex flex-col items-center justify-center flex-1 h-full min-h-[44px] px-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 ${
                isActive
                  ? 'text-vermilion-600 dark:text-vermilion-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {isActive && (
                <span
                  className="absolute top-0 inset-x-2 h-[2px] bg-vermilion-500 rounded-full"
                  aria-hidden="true"
                />
              )}
              <Icon className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] tracking-tight">{item.label}</span>
            </button>
          );
        })}

        {/* More button */}
        <button
          type="button"
          aria-label="Mobile More"
          aria-expanded={isMoreOpen}
          onClick={onOpenMore}
          className={`relative flex flex-col items-center justify-center flex-1 h-full min-h-[44px] px-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vermilion-500 ${
            isMoreOpen || currentTab === 'settings'
              ? 'text-vermilion-600 dark:text-vermilion-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          {(isMoreOpen || currentTab === 'settings') && (
            <span
              className="absolute top-0 inset-x-2 h-[2px] bg-vermilion-500 rounded-full"
              aria-hidden="true"
            />
          )}
          <Menu className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">More</span>
        </button>
      </div>
    </nav>
  );
};
