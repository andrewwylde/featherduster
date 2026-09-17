import React from 'react';
import { FlaskConical } from 'lucide-react';

/** Temporary, explicit label for views still rendering fixture data. Removed in Task 10. */
export const SampleDataBanner: React.FC<{ what: string }> = ({ what }) => (
  <div
    role="note"
    aria-label="Sample data"
    className="mb-5 flex items-start gap-2.5 rounded-desk border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-200"
  >
    <FlaskConical className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
    <p>
      <strong>Sample data — not your ledger.</strong> {what} is a design preview built from made-up examples. Nothing here
      reflects your evidence, and nothing here is saved. Your real entries are under <strong>Evidence</strong>.
    </p>
  </div>
);
