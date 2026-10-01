/** @vitest-environment jsdom */
import { expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DraftStatus } from '../src/views/tailoring/DraftStatus';
afterEach(cleanup);
it('renders truthful live status and an accessible retry button', () => {
  const retry = vi.fn(); const { rerender } = render(<DraftStatus status="browser-only" onRetry={retry} />);
  expect(screen.getByRole('status').textContent).toBe('Saved in this browser · Workspace save pending');
  rerender(<DraftStatus status="unsaved" onRetry={retry} />); expect(screen.getByRole('status').textContent).toContain('Unsaved changes'); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(retry).toHaveBeenCalledOnce();
  rerender(<DraftStatus status="saving" onRetry={retry} />); expect(screen.getByRole('status').textContent).toBe('Saving…');
  rerender(<DraftStatus status="saved" savedAt="2026-09-30T12:00:00Z" onRetry={retry} />); expect(screen.getByRole('status').textContent).toBe('Draft saved'); expect(screen.getByText(/Draft saved/)).toBeTruthy();
});
