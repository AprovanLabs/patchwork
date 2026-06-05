import { describe, it, expect } from 'vitest';
import {
  isChangeType,
  isChange,
  isStyleChange,
  isTextChange,
  isMoveChange,
  isSelectedElement,
  isAnnotation,
  isDesignTokens,
  isBobbinState,
  isBobbinChangeset,
} from '../typeGuards';
import type {
  Change,
  StyleChange,
  TextChange,
  MoveChange,
  SelectedElement,
  Annotation,
  DesignTokens,
  BobbinState,
  BobbinChangeset,
} from '../types';

function makeChange(overrides: Partial<Change> = {}): Change {
  return {
    id: 'test-id',
    type: 'style',
    timestamp: 1000,
    target: { path: 'div', xpath: '//div', tagName: 'div' },
    before: { property: 'color', value: 'red' },
    after: { property: 'color', value: 'blue' },
    ...overrides,
  };
}

function makeStyleChange(overrides: Partial<StyleChange> = {}): StyleChange {
  return {
    id: 'style-id',
    type: 'style',
    timestamp: 1000,
    target: { path: 'div', xpath: '//div', tagName: 'div' },
    before: { property: 'color', value: 'red' },
    after: { property: 'color', value: 'blue' },
    ...overrides,
  };
}

function makeTextChange(overrides: Partial<TextChange> = {}): TextChange {
  return {
    id: 'text-id',
    type: 'text',
    timestamp: 1000,
    target: { path: 'p', xpath: '//p', tagName: 'p' },
    before: 'hello',
    after: 'world',
    ...overrides,
  };
}

function makeMoveChange(overrides: Partial<MoveChange> = {}): MoveChange {
  return {
    id: 'move-id',
    type: 'move',
    timestamp: 1000,
    target: { path: 'div', xpath: '//div', tagName: 'div' },
    before: { parent: 'section', index: 0 },
    after: { parent: 'main', index: 1 },
    ...overrides,
  };
}

describe('isChangeType', () => {
  it('accepts valid change types', () => {
    expect(isChangeType('style')).toBe(true);
    expect(isChangeType('text')).toBe(true);
    expect(isChangeType('delete')).toBe(true);
    expect(isChangeType('move')).toBe(true);
    expect(isChangeType('duplicate')).toBe(true);
    expect(isChangeType('insert')).toBe(true);
    expect(isChangeType('attribute')).toBe(true);
  });

  it('rejects invalid change types', () => {
    expect(isChangeType('unknown')).toBe(false);
    expect(isChangeType('')).toBe(false);
    expect(isChangeType(123)).toBe(false);
    expect(isChangeType(null)).toBe(false);
    expect(isChangeType(undefined)).toBe(false);
  });
});

describe('isChange', () => {
  it('accepts a valid Change', () => {
    expect(isChange(makeChange())).toBe(true);
  });

  it('accepts different change types', () => {
    expect(isChange(makeChange({ type: 'text', before: 'a', after: 'b' }))).toBe(true);
    expect(isChange(makeChange({ type: 'delete', before: '<div>', after: null }))).toBe(true);
    expect(isChange(makeChange({ type: 'insert', before: null, after: '<div>' }))).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isChange(null)).toBe(false);
    expect(isChange('string')).toBe(false);
    expect(isChange(42)).toBe(false);
  });

  it('rejects objects with missing fields', () => {
    expect(isChange({})).toBe(false);
    expect(isChange({ id: 'x', type: 'style' })).toBe(false);
    expect(isChange({ id: 'x', type: 'style', timestamp: 1 })).toBe(false);
  });

  it('rejects objects with invalid type', () => {
    expect(isChange({ ...makeChange(), type: 'bogus' })).toBe(false);
  });

  it('rejects objects with invalid target', () => {
    expect(isChange({ ...makeChange(), target: { path: 1 } })).toBe(false);
  });
});

describe('isStyleChange', () => {
  it('accepts a valid StyleChange', () => {
    expect(isStyleChange(makeStyleChange())).toBe(true);
  });

  it('rejects a Change with wrong type', () => {
    expect(isStyleChange(makeTextChange())).toBe(false);
  });

  it('rejects non-Change objects', () => {
    expect(isStyleChange(null)).toBe(false);
    expect(isStyleChange({})).toBe(false);
  });

  it('rejects if before/after lack property/value strings', () => {
    const bad = {
      ...makeStyleChange(),
      before: { property: 1, value: 'red' },
    };
    expect(isStyleChange(bad)).toBe(false);
  });
});

describe('isTextChange', () => {
  it('accepts a valid TextChange', () => {
    expect(isTextChange(makeTextChange())).toBe(true);
  });

  it('rejects a Change with wrong type', () => {
    expect(isTextChange(makeStyleChange())).toBe(false);
  });

  it('rejects if before/after are not strings', () => {
    const bad = { ...makeTextChange(), before: 42 };
    expect(isTextChange(bad)).toBe(false);
  });
});

describe('isMoveChange', () => {
  it('accepts a valid MoveChange', () => {
    expect(isMoveChange(makeMoveChange())).toBe(true);
  });

  it('rejects a Change with wrong type', () => {
    expect(isMoveChange(makeStyleChange())).toBe(false);
  });

  it('rejects if before/after lack parent/index', () => {
    const bad = { ...makeMoveChange(), before: { parent: 1, index: 0 } };
    expect(isMoveChange(bad)).toBe(false);
  });
});

describe('isSelectedElement', () => {
  it('accepts a valid SelectedElement', () => {
    const el: SelectedElement = {
      element: {} as HTMLElement,
      rect: {} as DOMRect,
      path: 'div',
      xpath: '//div',
      tagName: 'div',
      classList: ['foo'],
    };
    expect(isSelectedElement(el)).toBe(true);
  });

  it('accepts with optional id', () => {
    const el: SelectedElement = {
      element: {} as HTMLElement,
      rect: {} as DOMRect,
      path: 'div',
      xpath: '//div',
      tagName: 'div',
      classList: [],
      id: 'my-id',
    };
    expect(isSelectedElement(el)).toBe(true);
  });

  it('rejects null', () => {
    expect(isSelectedElement(null)).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(isSelectedElement({ path: 'div' })).toBe(false);
  });

  it('rejects non-array classList', () => {
    const el = {
      element: {},
      rect: {},
      path: 'div',
      xpath: '//div',
      tagName: 'div',
      classList: 'not-array',
    };
    expect(isSelectedElement(el)).toBe(false);
  });

  it('rejects non-string id', () => {
    const el = {
      element: {},
      rect: {},
      path: 'div',
      xpath: '//div',
      tagName: 'div',
      classList: [],
      id: 123,
    };
    expect(isSelectedElement(el)).toBe(false);
  });
});

describe('isAnnotation', () => {
  it('accepts a valid Annotation', () => {
    const a: Annotation = {
      id: 'ann-1',
      elementPath: 'div',
      elementXpath: '//div',
      content: 'note',
      createdAt: 1000,
    };
    expect(isAnnotation(a)).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isAnnotation({})).toBe(false);
    expect(isAnnotation({ id: 'x', elementPath: 'd' })).toBe(false);
  });

  it('rejects wrong types', () => {
    expect(isAnnotation({ id: 1, elementPath: 'd', elementXpath: 'x', content: 'c', createdAt: 1 })).toBe(false);
  });
});

describe('isDesignTokens', () => {
  it('accepts a valid DesignTokens', () => {
    const tokens: DesignTokens = {
      colors: { primary: { base: '#000' } },
      spacing: { sm: '8px' },
      fontSize: { base: '16px' },
      fontWeight: { normal: '400' },
      fontFamily: { sans: 'Inter' },
      borderRadius: { sm: '4px' },
      borderWidth: { thin: '1px' },
      boxShadow: { sm: '0 1px' },
      lineHeight: { base: '1.5' },
      letterSpacing: { normal: '0' },
    };
    expect(isDesignTokens(tokens)).toBe(true);
  });

  it('rejects missing token categories', () => {
    const partial = { colors: {}, spacing: {} };
    expect(isDesignTokens(partial)).toBe(false);
  });

  it('rejects null', () => {
    expect(isDesignTokens(null)).toBe(false);
  });

  it('rejects non-object values for token categories', () => {
    const bad = {
      colors: 'not-an-object',
      spacing: {},
      fontSize: {},
      fontWeight: {},
      fontFamily: {},
      borderRadius: {},
      borderWidth: {},
      boxShadow: {},
      lineHeight: {},
      letterSpacing: {},
    };
    expect(isDesignTokens(bad)).toBe(false);
  });
});

describe('isBobbinState', () => {
  it('accepts a valid BobbinState', () => {
    const state: BobbinState = {
      isActive: true,
      isPillExpanded: false,
      hoveredElement: null,
      selectedElement: null,
      changes: [],
      annotations: [],
      clipboard: null,
      showMarginPadding: false,
      activePanel: 'style',
      theme: 'system',
    };
    expect(isBobbinState(state)).toBe(true);
  });

  it('accepts with non-null selected elements', () => {
    const state: BobbinState = {
      isActive: true,
      isPillExpanded: false,
      hoveredElement: null,
      selectedElement: {
        element: {} as HTMLElement,
        rect: {} as DOMRect,
        path: 'div',
        xpath: '//div',
        tagName: 'div',
        classList: [],
      },
      changes: [],
      annotations: [],
      clipboard: null,
      showMarginPadding: false,
      activePanel: null,
      theme: 'dark',
    };
    expect(isBobbinState(state)).toBe(true);
  });

  it('rejects missing boolean fields', () => {
    expect(isBobbinState({ isActive: true })).toBe(false);
  });

  it('rejects invalid theme', () => {
    const bad = {
      isActive: true,
      isPillExpanded: false,
      hoveredElement: null,
      selectedElement: null,
      changes: [],
      annotations: [],
      clipboard: null,
      showMarginPadding: false,
      activePanel: null,
      theme: 'invalid',
    };
    expect(isBobbinState(bad)).toBe(false);
  });

  it('rejects invalid changes array', () => {
    const bad = {
      isActive: true,
      isPillExpanded: false,
      hoveredElement: null,
      selectedElement: null,
      changes: [{}],
      annotations: [],
      clipboard: null,
      showMarginPadding: false,
      activePanel: null,
      theme: 'system',
    };
    expect(isBobbinState(bad)).toBe(false);
  });
});

describe('isBobbinChangeset', () => {
  it('accepts a valid BobbinChangeset', () => {
    const cs: BobbinChangeset = {
      version: '1.0',
      timestamp: '2024-01-01T00:00:00Z',
      changeCount: 2,
      changes: [],
      annotations: [],
    };
    expect(isBobbinChangeset(cs)).toBe(true);
  });

  it('rejects wrong version', () => {
    const bad = {
      version: '2.0',
      timestamp: '2024-01-01T00:00:00Z',
      changeCount: 0,
      changes: [],
      annotations: [],
    };
    expect(isBobbinChangeset(bad)).toBe(false);
  });

  it('rejects missing arrays', () => {
    const bad = {
      version: '1.0',
      timestamp: '2024-01-01',
      changeCount: 0,
    };
    expect(isBobbinChangeset(bad)).toBe(false);
  });

  it('rejects null', () => {
    expect(isBobbinChangeset(null)).toBe(false);
  });
});
