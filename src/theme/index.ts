import type { ViewStyle } from 'react-native';

export { avatarPalette, colors, gradients } from './colors';
export type { ColorName, GradientName } from './colors';
export { fontFor, textVariants } from './typography';
export type { FontWeight, TextVariant } from './typography';

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Largura máxima do conteúdo em telas grandes (tablet/web), mantendo o layout de celular. */
export const maxContentWidth = 520;

/** Sombras suaves no estilo iOS (boxShadow é suportado no iOS, Android e web). */
function shadow(opacity: number, blur: number, offsetY: number): ViewStyle {
  return { boxShadow: `0px ${offsetY}px ${blur}px rgba(46, 20, 112, ${opacity})` };
}

export const shadows = {
  soft: shadow(0.07, 18, 4),
  medium: shadow(0.12, 28, 10),
  strong: shadow(0.24, 40, 16),
} as const;

export const durations = {
  fast: 180,
  normal: 280,
  slow: 450,
} as const;
