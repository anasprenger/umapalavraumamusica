import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, shadows, spacing } from '@/theme';

import { Gradient } from './Gradient';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'white' | 'lilac' | 'purple' | 'glass';
  padded?: boolean;
};

const backgrounds = {
  white: colors.surface,
  lilac: colors.lilacSoft,
  purple: colors.primary,
  glass: colors.onPrimarySurface,
} as const;

/** Cartão limpo com cantos arredondados e sombra suave (o roxo vem em degradê). */
export function Card({ children, style, tone = 'white', padded = true }: Props) {
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: backgrounds[tone] },
        tone === 'white' ? shadows.soft : null,
        tone === 'purple' ? styles.glow : null,
        padded ? styles.padded : null,
        style,
      ]}>
      {tone === 'purple' ? <Gradient name="word" style={[StyleSheet.absoluteFill, styles.fill]} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.xl,
  },
  padded: {
    padding: spacing.lg,
  },
  fill: {
    borderRadius: radii.xl,
  },
  glow: {
    boxShadow: '0px 12px 26px rgba(74, 35, 176, 0.3)',
  },
});
