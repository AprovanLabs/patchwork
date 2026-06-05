import type {
  ChangeType,
  Change,
  StyleChange,
  TextChange,
  MoveChange,
  SelectedElement,
  Annotation,
  DesignTokens,
  BobbinState,
  BobbinChangeset,
} from './types';

const CHANGE_TYPE_VALUES: readonly string[] = [
  'style',
  'text',
  'delete',
  'move',
  'duplicate',
  'insert',
  'attribute',
];

export function isChangeType(value: unknown): value is ChangeType {
  return typeof value === 'string' && CHANGE_TYPE_VALUES.includes(value);
}

export function isChangeTarget(
  value: unknown,
): value is Change['target'] & Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.path === 'string' &&
    typeof obj.xpath === 'string' &&
    typeof obj.tagName === 'string'
  );
}

export function isChange(value: unknown): value is Change {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    isChangeType(obj.type) &&
    typeof obj.timestamp === 'number' &&
    isChangeTarget(obj.target)
  );
}

export function isStyleChange(value: unknown): value is StyleChange {
  if (!isChange(value)) return false;
  if (value.type !== 'style') return false;
  const obj = value as unknown as Record<string, unknown>;
  const before = obj.before;
  const after = obj.after;
  if (typeof before !== 'object' || before === null) return false;
  if (typeof after !== 'object' || after === null) return false;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return (
    typeof b.property === 'string' &&
    typeof b.value === 'string' &&
    typeof a.property === 'string' &&
    typeof a.value === 'string'
  );
}

export function isTextChange(value: unknown): value is TextChange {
  if (!isChange(value)) return false;
  if (value.type !== 'text') return false;
  const obj = value as unknown as Record<string, unknown>;
  return typeof obj.before === 'string' && typeof obj.after === 'string';
}

export function isMoveChange(value: unknown): value is MoveChange {
  if (!isChange(value)) return false;
  if (value.type !== 'move') return false;
  const obj = value as unknown as Record<string, unknown>;
  const before = obj.before;
  const after = obj.after;
  if (typeof before !== 'object' || before === null) return false;
  if (typeof after !== 'object' || after === null) return false;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return (
    typeof b.parent === 'string' &&
    typeof b.index === 'number' &&
    typeof a.parent === 'string' &&
    typeof a.index === 'number'
  );
}

export function isSelectedElement(value: unknown): value is SelectedElement {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.tagName === 'string' &&
    typeof obj.path === 'string' &&
    typeof obj.xpath === 'string' &&
    Array.isArray(obj.classList) &&
    (obj.id === undefined || typeof obj.id === 'string')
  );
}

export function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.elementPath === 'string' &&
    typeof obj.elementXpath === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.createdAt === 'number'
  );
}

export function isDesignTokens(value: unknown): value is DesignTokens {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const keys = [
    'colors',
    'spacing',
    'fontSize',
    'fontWeight',
    'fontFamily',
    'borderRadius',
    'borderWidth',
    'boxShadow',
    'lineHeight',
    'letterSpacing',
  ];
  return keys.every(
    (k) => k in obj && typeof obj[k] === 'object' && obj[k] !== null,
  );
}

export function isBobbinState(value: unknown): value is BobbinState {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.isActive === 'boolean' &&
    typeof obj.isPillExpanded === 'boolean' &&
    typeof obj.showMarginPadding === 'boolean' &&
    (obj.hoveredElement === null || isSelectedElement(obj.hoveredElement)) &&
    (obj.selectedElement === null || isSelectedElement(obj.selectedElement)) &&
    Array.isArray(obj.changes) &&
    obj.changes.every(isChange) &&
    Array.isArray(obj.annotations) &&
    obj.annotations.every(isAnnotation) &&
    (obj.clipboard === null || isSelectedElement(obj.clipboard)) &&
    (obj.activePanel === null ||
      obj.activePanel === 'style' ||
      obj.activePanel === 'inspector') &&
    (obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'system')
  );
}

export function isBobbinChangeset(value: unknown): value is BobbinChangeset {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.version === '1.0' &&
    typeof obj.timestamp === 'string' &&
    typeof obj.changeCount === 'number' &&
    Array.isArray(obj.changes) &&
    Array.isArray(obj.annotations)
  );
}
