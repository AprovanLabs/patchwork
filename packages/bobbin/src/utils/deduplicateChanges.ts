import type { Change, StyleChange } from '../types';

export function deduplicateChanges(
  changes: Change[],
  originalStates: Map<string, Map<string, string>>,
): Change[] {
  const uniqueChanges = new Map<string, Change>();

  for (const change of changes) {
    let key: string;

    if (change.type === 'style') {
      const styleChange = change as StyleChange;
      key = `${change.target.path}:style:${styleChange.after.property}`;
    } else {
      key = `${change.target.path}:${change.type}:${change.id}`;
    }

    if (change.type === 'style') {
      const styleChange = change as StyleChange;
      const originalValue = originalStates
        .get(change.target.path)
        ?.get(styleChange.after.property);
      if (originalValue === styleChange.after.value) {
        uniqueChanges.delete(key);
        continue;
      }
    }

    uniqueChanges.set(key, change);
  }

  return Array.from(uniqueChanges.values());
}
