import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, shadows, spacing } from '@/theme';

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

/** Cartão limpo com cantos arredondados e sombra suave. */
export function Card({ children, style, tone = 'white', padded = true }: Props) {
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: backgrounds[tone] },
        tone === 'white' ? shadows.soft : null,
        padded ? styles.padded : null,
        style,
      ]}>
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
});
