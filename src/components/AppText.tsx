import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, fontFor, textVariants, type FontWeight, type TextVariant } from '@/theme';

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  color?: string;
  align?: 'left' | 'center' | 'right';
  weight?: FontWeight;
  uppercase?: boolean;
};

/** Texto padrão do app: aplica a escala tipográfica e as cores da identidade. */
export function AppText({
  variant = 'body',
  color = colors.ink,
  align,
  weight,
  uppercase,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        textVariants[variant],
        { color },
        align ? { textAlign: align } : null,
        weight ? fontFor(weight) : null,
        uppercase ? styles.uppercase : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  uppercase: { textTransform: 'uppercase' },
});
