export const vermilion = {
  50: '#fff1ef',
  100: '#ffe1dc',
  200: '#ffc7be',
  500: '#d93829', // Main vermilion accent
  600: '#c23022',
  700: '#a32418',
  800: '#841f16',
  900: '#691c14',
  950: '#45120c',
};

export type EvidenceStatus = 'verified' | 'remembered' | 'missing_proof';

export interface StatusStyle {
  label: string;
  badgeClass: string;
  dotClass: string;
}

export const evidenceStatusStyles: Record<EvidenceStatus, StatusStyle> = {
  verified: {
    label: 'Verified',
    badgeClass:
      'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
  },
  remembered: {
    label: 'Remembered',
    badgeClass:
      'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/80',
    dotClass: 'bg-slate-400 dark:bg-slate-500',
  },
  missing_proof: {
    label: 'Missing proof',
    badgeClass:
      'bg-vermilion-50 text-vermilion-700 border border-vermilion-200 dark:bg-vermilion-950/60 dark:text-vermilion-300 dark:border-vermilion-800/60',
    dotClass: 'bg-vermilion-500 dark:bg-vermilion-400',
  },
};
