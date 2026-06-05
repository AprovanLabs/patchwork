import { useState, useCallback, useRef, useMemo } from 'react';
import { deduplicateChanges } from '../utils/deduplicateChanges';
import { generateId } from '../utils/selectors';
import type {
  Change,
  StyleChange,
  TextChange,
  MoveChange,
  ChangeType,
} from '../types';

export function useChangeTracker() {
  const [changes, setChanges] = useState<Change[]>([]);
  const historyRef = useRef<Change[]>([]);
  const originalStatesRef = useRef<Map<string, Map<string, string>>>(new Map());

  const recordOriginalState = useCallback(
    (path: string, property: string, value: string) => {
      if (!originalStatesRef.current.has(path)) {
        originalStatesRef.current.set(path, new Map());
      }
      const elementState = originalStatesRef.current.get(path)!;
      if (!elementState.has(property)) {
        elementState.set(property, value);
      }
    },
    [],
  );

  const addChange = useCallback(
    <T extends Change>(change: Omit<T, 'id' | 'timestamp'>) => {
      const fullChange = {
        ...change,
        id: generateId(),
        timestamp: Date.now(),
      } as T;

      setChanges((prev) => [...prev, fullChange]);
      historyRef.current.push(fullChange);
      return fullChange;
    },
    [],
  );

  const recordStyleChange = useCallback(
    (
      path: string,
      xpath: string,
      tagName: string,
      property: string,
      value: string,
      originalValue: string,
    ): StyleChange => {
      recordOriginalState(path, property, originalValue);

      return addChange<StyleChange>({
        type: 'style',
        target: { path, xpath, tagName },
        before: { property, value: originalValue },
        after: { property, value },
      });
    },
    [addChange, recordOriginalState],
  );

  const recordTextChange = useCallback(
    (
      path: string,
      xpath: string,
      tagName: string,
      originalText: string,
      newText: string,
    ): TextChange => {
      return addChange<TextChange>({
        type: 'text',
        target: { path, xpath, tagName },
        before: originalText,
        after: newText,
      });
    },
    [addChange],
  );

  const recordMoveChange = useCallback(
    (
      path: string,
      xpath: string,
      tagName: string,
      fromParent: string,
      fromIndex: number,
      toParent: string,
      toIndex: number,
    ): MoveChange => {
      return addChange<MoveChange>({
        type: 'move',
        target: { path, xpath, tagName },
        before: { parent: fromParent, index: fromIndex },
        after: { parent: toParent, index: toIndex },
      });
    },
    [addChange],
  );

  const recordChange = useCallback(
    (
      type: ChangeType,
      path: string,
      xpath: string,
      tagName: string,
      before: unknown,
      after: unknown,
      metadata?: Record<string, unknown>,
    ) => {
      return addChange({
        type,
        target: { path, xpath, tagName },
        before,
        after,
        metadata,
      });
    },
    [addChange],
  );

  const undo = useCallback(() => {
    if (changes.length === 0) return null;

    const lastChange = changes[changes.length - 1];
    setChanges((prev) => prev.slice(0, -1));
    return lastChange;
  }, [changes]);

  const clearChanges = useCallback(() => {
    setChanges([]);
    originalStatesRef.current.clear();
  }, []);

  const getChanges = useCallback(() => [...changes], [changes]);

  // Deduplicated changes - only count unique (element + property) combinations
  // This prevents counting every keystroke as a separate change
  const deduplicatedChanges = useMemo(
    () => deduplicateChanges(changes, originalStatesRef.current),
    [changes],
  );

  return {
    changes,
    deduplicatedChanges,
    changeCount: deduplicatedChanges.length,
    recordStyleChange,
    recordTextChange,
    recordMoveChange,
    recordChange,
    undo,
    clearChanges,
    getChanges,
    originalStates: originalStatesRef.current,
  };
}
