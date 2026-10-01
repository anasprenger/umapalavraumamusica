import { Platform, type TextStyle } from 'react-native';

/**
 * Tipografia inspirada na escala do iOS (SF Pro).
 * - iOS: usa a fonte do sistema (SF Pro).
 * - Android: usa Inter (carregada no layout raiz), a alternativa mais próxima da SF Pro.
 * - Web: usa a pilha de fontes do sistema, com Inter como alternativa.
 */
export type FontWeight = 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy';

const interFamilies: Record<FontWeight, string> = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
};

const numericWeights: Record<FontWeight, TextStyle['fontWeight']> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
};

const webStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter_400Regular, Inter, "Segoe UI", Roboto, sans-serif';

export function fontFor(weight: FontWeight): TextStyle {
  return Platform.select<TextStyle>({
    ios: { fontWeight: numericWeights[weight] },
    android: { fontFamily: interFamilies[weight] },
    default: { fontFamily: webStack, fontWeight: numericWeights[weight] },
  });
}

export const textVariants = {
  display: { fontSize: 56, lineHeight: 62, letterSpacing: 0.5, ...fontFor('heavy') },
  largeTitle: { fontSize: 34, lineHeight: 41, letterSpacing: 0.2, ...fontFor('bold') },
  title1: { fontSize: 28, lineHeight: 34, letterSpacing: 0.2, ...fontFor('bold') },
  title2: { fontSize: 22, lineHeight: 28, letterSpacing: 0.1, ...fontFor('bold') },
  title3: { fontSize: 20, lineHeight: 25, ...fontFor('semibold') },
  headline: { fontSize: 17, lineHeight: 22, ...fontFor('semibold') },
  body: { fontSize: 17, lineHeight: 23, ...fontFor('regular') },
  callout: { fontSize: 16, lineHeight: 21, ...fontFor('regular') },
  subhead: { fontSize: 15, lineHeight: 20, ...fontFor('regular') },
  footnote: { fontSize: 13, lineHeight: 18, ...fontFor('regular') },
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0.3, ...fontFor('medium') },
  overline: { fontSize: 13, lineHeight: 16, letterSpacing: 2, ...fontFor('semibold') },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof textVariants;
