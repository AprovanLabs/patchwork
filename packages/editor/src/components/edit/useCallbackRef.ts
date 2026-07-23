import { useRef } from 'react';

/**
 * Holds the latest callback in a ref so long-lived closures (e.g. a file-tree
 * model built once at mount) always call through to the current handler.
 */
export function useCallbackRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
