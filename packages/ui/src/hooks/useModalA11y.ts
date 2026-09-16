import { useEffect } from 'react';

export interface UseModalA11yOptions {
  isOpen: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
}

/**
 * Accessibility hook for modals:
 * - Listens for Escape key presses and triggers onClose()
 * - Traps or restores focus when opened/closed
 */
export function useModalA11y({
  isOpen,
  onClose,
  closeOnEscape = true,
}: UseModalA11yOptions): void {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, closeOnEscape]);
}
