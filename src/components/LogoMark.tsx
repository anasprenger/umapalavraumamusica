import { useId } from 'react';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

type Props = {
  size?: number;
  /** `app`: quadrado roxo com nota branca (igual ao ícone). `note`: apenas a nota. */
  variant?: 'app' | 'note';
  color?: string;
};

/** Caminho da nota musical (colcheias ligadas), desenhado numa grade de 100×100. */
export const NOTE_PATH =
  'M40 24.5 L74 16.5 C76.4 15.9 78.5 17.7 78.5 20.1 V64 C78.5 71.2 72.1 77 64.2 77 C56.9 77 51.5 72.8 51.5 67.2 C51.5 61.4 57.8 56.8 65.3 56.8 C67.4 56.8 69.3 57.2 70.9 57.9 V32.1 L47.6 37.5 V72 C47.6 79.2 41.2 85 33.3 85 C26 85 20.6 80.8 20.6 75.2 C20.6 69.4 26.9 64.8 34.4 64.8 C36.5 64.8 38.4 65.2 40 65.9 Z';

/** Marca do app: nota musical branca sobre roxo, desenhada em vetor. */
export function LogoMark({ size = 96, variant = 'app', color = '#FFFFFF' }: Props) {
  // IDs de gradiente precisam ser únicos na página (na web, vários logos coexistem no DOM).
  const gradientId = `logoBg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (variant === 'note') {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Nota musical">
        <Path d={NOTE_PATH} fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Uma Palavra, Uma Música">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#8052F0" />
          <Stop offset="1" stopColor="#5626CC" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="23" fill={`url(#${gradientId})`} />
      <Path d={NOTE_PATH} fill={color} transform="translate(2 -1)" />
    </Svg>
  );
}
