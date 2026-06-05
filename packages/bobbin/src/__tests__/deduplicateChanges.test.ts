import { describe, it, expect } from 'vitest';
import { deduplicateChanges } from '../utils/deduplicateChanges';
import type { Change, StyleChange, TextChange, MoveChange } from '../types';

function makeStyleChange(
  path: string,
  property: string,
  value: string,
  id = 'id-1',
): StyleChange {
  return {
    id,
    type: 'style',
    timestamp: 1000,
    target: { path, xpath: `//${path}`, tagName: path },
    before: { property, value: 'original' },
    after: { property, value },
  };
}

function makeTextChange(
  path: string,
  before: string,
  after: string,
  id = 'tid-1',
): TextChange {
  return {
    id,
    type: 'text',
    timestamp: 1000,
    target: { path, xpath: `//${path}`, tagName: path },
    before,
    after,
  };
}

function makeMoveChange(
  path: string,
  fromParent: string,
  fromIndex: number,
  toParent: string,
  toIndex: number,
  id = 'mid-1',
): MoveChange {
  return {
    id,
    type: 'move',
    timestamp: 1000,
    target: { path, xpath: `//${path}`, tagName: path },
    before: { parent: fromParent, index: fromIndex },
    after: { parent: toParent, index: toIndex },
  };
}

describe('deduplicateChanges', () => {
  it('returns empty array for no changes', () => {
    const result = deduplicateChanges([], new Map());
    expect(result).toEqual([]);
  });

  it('returns unique style changes for different properties', () => {
    const changes: Change[] = [
      makeStyleChange('div', 'color', 'blue', 'id-1'),
      makeStyleChange('div', 'font-size', '16px', 'id-2'),
    ];
    const result = deduplicateChanges(changes, new Map());
    expect(result).toHaveLength(2);
  });

  it('keeps only the latest style change for same property', () => {
    const changes: Change[] = [
      makeStyleChange('div', 'color', 'blue', 'id-1'),
      makeStyleChange('div', 'color', 'green', 'id-2'),
    ];
    const result = deduplicateChanges(changes, new Map());
    expect(result).toHaveLength(1);
    const styleResult = result[0] as StyleChange;
    expect(styleResult.after.value).toBe('green');
  });

  it('removes style change when value reverts to original', () => {
    const originalStates = new Map<string, Map<string, string>>();
    originalStates.set('div', new Map([['color', 'blue']]));

    const changes: Change[] = [
      makeStyleChange('div', 'color', 'blue', 'id-1'),
    ];
    const result = deduplicateChanges(changes, originalStates);
    expect(result).toHaveLength(0);
  });

  it('keeps style change when value differs from original', () => {
    const originalStates = new Map<string, Map<string, string>>();
    originalStates.set('div', new Map([['color', 'red']]));

    const changes: Change[] = [
      makeStyleChange('div', 'color', 'blue', 'id-1'),
    ];
    const result = deduplicateChanges(changes, originalStates);
    expect(result).toHaveLength(1);
  });

  it('does not deduplicate text changes by content', () => {
    const changes: Change[] = [
      makeTextChange('p', 'a', 'b', 'tid-1'),
      makeTextChange('p', 'c', 'd', 'tid-2'),
    ];
    const result = deduplicateChanges(changes, new Map());
    expect(result).toHaveLength(2);
  });

  it('does not deduplicate move changes', () => {
    const changes: Change[] = [
      makeMoveChange('div', 'section', 0, 'main', 1, 'mid-1'),
      makeMoveChange('div', 'main', 1, 'section', 2, 'mid-2'),
    ];
    const result = deduplicateChanges(changes, new Map());
    expect(result).toHaveLength(2);
  });

  it('handles mixed change types', () => {
    const originalStates = new Map<string, Map<string, string>>();
    originalStates.set('div', new Map([['color', 'red']]));

    const changes: Change[] = [
      makeStyleChange('div', 'color', 'blue', 'id-1'),
      makeTextChange('div', 'a', 'b', 'tid-1'),
      makeMoveChange('div', 'section', 0, 'main', 1, 'mid-1'),
    ];
    const result = deduplicateChanges(changes, originalStates);
    expect(result).toHaveLength(3);
  });

  it('handles reverts in a sequence of style changes', () => {
    const originalStates = new Map<string, Map<string, string>>();
    originalStates.set('div', new Map([['color', 'red']]));

    const changes: Change[] = [
      makeStyleChange('div', 'color', 'blue', 'id-1'),
      makeStyleChange('div', 'color', 'green', 'id-2'),
      makeStyleChange('div', 'color', 'red', 'id-3'),
    ];
    const result = deduplicateChanges(changes, originalStates);
    expect(result).toHaveLength(0);
  });

  it('handles style changes for different elements independently', () => {
    const changes: Change[] = [
      makeStyleChange('div', 'color', 'blue', 'id-1'),
      makeStyleChange('span', 'color', 'green', 'id-2'),
    ];
    const result = deduplicateChanges(changes, new Map());
    expect(result).toHaveLength(2);
  });

  it('handles delete/insert/attribute changes without dedup by content', () => {
    const changes: Change[] = [
      {
        id: 'del-1',
        type: 'delete',
        timestamp: 1000,
        target: { path: 'div', xpath: '//div', tagName: 'div' },
        before: '<div/>',
        after: null,
      },
      {
        id: 'ins-1',
        type: 'insert',
        timestamp: 1000,
        target: { path: 'div', xpath: '//div', tagName: 'div' },
        before: null,
        after: '<span/>',
      },
    ];
    const result = deduplicateChanges(changes, new Map());
    expect(result).toHaveLength(2);
  });
});
