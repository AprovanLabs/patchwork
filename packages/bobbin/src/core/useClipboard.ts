import { useState, useCallback } from 'react';
import type { SelectedElement } from '../types';

export function useClipboard() {
  const [copied, setCopied] = useState<SelectedElement | null>(null);

  const copy = useCallback((element: SelectedElement) => {
    setCopied(element);
  }, []);

  const clear = useCallback(() => {
    setCopied(null);
  }, []);

  return {
    copied,
    copy,
    clear,
    hasCopied: copied !== null,
  };
}
