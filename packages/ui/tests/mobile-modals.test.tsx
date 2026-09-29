/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickCaptureModal } from '../src/components/QuickCaptureModal';
import { PreFlightModal } from '../src/components/PreFlightModal';
import { RubricImporterModal } from '../src/components/RubricImporterModal';

describe('Touch-first mobile modals', () => {
  afterEach(cleanup);

  it('QuickCaptureModal renders responsive bottom-sheet container and stacked metric rows', () => {
    render(
      <QuickCaptureModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        existingIds={['ev-001']}
        existingCompanies={['acme']}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /Capture Evidence Card/i });
    expect(dialog).toBeInTheDocument();
    // Verify responsive bottom-sheet classes
    expect(dialog).toHaveClass('rounded-t-2xl');
    expect(dialog).toHaveClass('sm:rounded-2xl');

    // Add a metric and check stacked fields
    const addMetricBtn = screen.getByRole('button', { name: /Add Metric/i });
    fireEvent.click(addMetricBtn);

    const metricNameInput = screen.getByPlaceholderText(/Metric Name/i);
    const metricValueInput = screen.getByPlaceholderText(/Value/i);
    expect(metricNameInput).toBeInTheDocument();
    expect(metricValueInput).toBeInTheDocument();

    // Verify touch sizing
    expect(metricNameInput).toHaveClass('text-base');
    expect(metricValueInput).toHaveClass('text-base');

    // Verify footer actions are present and have touch height
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    const saveBtn = screen.getByRole('button', { name: /Save Evidence Card/i });
    expect(cancelBtn).toHaveClass('min-h-[44px]');
    expect(saveBtn).toHaveClass('min-h-[44px]');
  });

  it('PreFlightModal renders responsive bottom-sheet layout', () => {
    render(
      <PreFlightModal
        isOpen={true}
        onClose={vi.fn()}
        text="Sample resume text"
      />
    );

    const dialog = screen.getByRole('dialog', { name: /Pre-Flight Export Gate/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('rounded-t-2xl');
    expect(dialog).toHaveClass('sm:rounded-2xl');
  });

  it('RubricImporterModal renders responsive bottom-sheet layout and touch-safe inputs', () => {
    render(
      <RubricImporterModal
        isOpen={true}
        onClose={vi.fn()}
        onImportSuccess={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /Import Leveling Rubric/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('rounded-t-2xl');
    expect(dialog).toHaveClass('sm:rounded-2xl');

    const rubricInput = screen.getByPlaceholderText(/e\.g\. staff-ladder/i);
    expect(rubricInput).toHaveClass('text-base');
  });
});
