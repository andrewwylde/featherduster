import React from 'react';
import { type EvidenceStatus, evidenceStatusStyles } from '../../theme/tokens';

interface EvidenceBadgeProps {
  status: EvidenceStatus | string;
  size?: 'sm' | 'md';
  className?: string;
}

export const EvidenceBadge: React.FC<EvidenceBadgeProps> = ({
  status,
  size = 'sm',
  className = '',
}) => {
  const normStatus: EvidenceStatus =
    status === 'verified'
      ? 'verified'
      : status === 'missing_proof' || status === 'missing' || status === 'METRIC NEEDED'
      ? 'missing_proof'
      : 'remembered';

  const config = evidenceStatusStyles[normStatus];

  const sizeClasses =
    size === 'sm'
      ? 'px-2 py-0.5 text-[11px] font-medium'
      : 'px-2.5 py-1 text-xs font-semibold';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border transition-colors ${sizeClasses} ${config.badgeClass} ${className}`}
      data-status={normStatus}
      title={`Evidence state: ${config.label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
};
