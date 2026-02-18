import type { DesignTokens } from '../types';
import { colors } from './colors';
import { spacing } from './spacing';
import {
  fontSize,
  fontWeight,
  fontFamily,
  lineHeight,
  letterSpacing,
} from './typography';
import { borderRadius, borderWidth } from './borders';
import { boxShadow } from './shadows';

export const defaultTokens: DesignTokens = {
  colors,
  spacing,
  fontSize,
  fontWeight,
  fontFamily,
  borderRadius,
  borderWidth,
  boxShadow,
  lineHeight,
  letterSpacing,
};

export { colors } from './colors';
export { spacing } from './spacing';
export {
  fontSize,
  fontWeight,
  fontFamily,
  lineHeight,
  letterSpacing,
} from './typography';
export { borderRadius, borderWidth } from './borders';
export { boxShadow } from './shadows';
