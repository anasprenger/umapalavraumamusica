import { StyleSheet, View } from 'react-native';

import { avatarPalette, colors } from '@/theme';
import { hashIndex, initials } from '@/utils/format';

import { AppText } from './AppText';

type Props = {
  name: string;
  size?: number;
  dimmed?: boolean;
  tone?: 'color' | 'white';
  /** Contorno para separar avatares sobrepostos. */
  ringColor?: string;
};

/** Círculo com as iniciais do jogador. */
export function Avatar({ name, size = 40, dimmed = false, tone = 'color', ringColor }: Props) {
  const swatch = avatarPalette[hashIndex(name, avatarPalette.length)];
  const background = tone === 'white' ? colors.white : swatch.bg;
  const foreground = tone === 'white' ? colors.primaryDark : swatch.fg;
  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background, opacity: dimmed ? 0.4 : 1 },
        ringColor ? { borderWidth: 3, borderColor: ringColor } : null,
      ]}>
      <AppText
        variant={size >= 56 ? 'title3' : 'footnote'}
        weight="bold"
        color={foreground}
        style={{ fontSize: Math.round(size * 0.38), lineHeight: Math.round(size * 0.46) }}>
        {initials(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
