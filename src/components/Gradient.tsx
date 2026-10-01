import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, gradients, type GradientName } from '@/theme';

type Props = {
  name: GradientName;
  /** `diagonal`: do canto superior esquerdo ao inferior direito. `vertical`: de cima para baixo. */
  direction?: 'diagonal' | 'vertical';
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const ends = {
  diagonal: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  vertical: { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
} as const;

/** Degradê da paleta do jogo. */
export function Gradient({ name, direction = 'diagonal', style, children }: Props) {
  return (
    <LinearGradient colors={gradients[name]} {...ends[direction]} style={style}>
      {children}
    </LinearGradient>
  );
}

/** Fundo de tela em degradê, com círculos suaves de cor para dar profundidade. */
export function Backdrop({ tone }: { tone: 'light' | 'purple' }) {
  const purple = tone === 'purple';
  return (
    <View style={styles.fill}>
      <Gradient name={tone} style={StyleSheet.absoluteFill} />
      <View style={[styles.blob, styles.top, { backgroundColor: purple ? colors.lavender : colors.lilacStrong }]} />
      <View style={[styles.blob, styles.bottom, { backgroundColor: purple ? colors.lilacStrong : colors.lavender }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
  },
  top: {
    width: 320,
    height: 320,
    top: -140,
    right: -120,
    opacity: 0.35,
  },
  bottom: {
    width: 260,
    height: 260,
    bottom: -150,
    left: -110,
    opacity: 0.14,
  },
});
