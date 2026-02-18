// Main component
export { Bobbin } from './Bobbin';
export type { BobbinComponentProps } from './Bobbin';

// Hooks
export { useBobbin } from './core/useBobbin';
export { useElementSelection } from './core/useElementSelection';
export { useChangeTracker } from './core/useChangeTracker';
export { useClipboard } from './core/useClipboard';

// Utilities
export {
  serializeChangesToYAML,
  parseYAMLChangeset,
} from './core/changeSerializer';
export { getElementPath, getElementXPath, generateId } from './utils/selectors';

// Types
export type {
  BobbinProps,
  BobbinState,
  BobbinActions,
  SelectedElement,
  Change,
  ChangeType,
  StyleChange,
  TextChange,
  MoveChange,
  Annotation,
  DesignTokens,
  BobbinChangeset,
} from './types';

// Tokens
export { defaultTokens } from './tokens';
export { colors } from './tokens/colors';
export { spacing } from './tokens/spacing';
export {
  fontSize,
  fontWeight,
  fontFamily,
  lineHeight,
  letterSpacing,
} from './tokens/typography';
export { borderRadius, borderWidth } from './tokens/borders';
export { boxShadow } from './tokens/shadows';
