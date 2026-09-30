import { useEffect, useRef } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, maxContentWidth, spacing } from '@/theme';

import { AppText } from './AppText';

type Props = {
  sources?: { title: string; uri: string }[] | null;
  /** HTML das sugestões de busca do Google (vem pronto na resposta com busca). */
  searchHtml?: string | null;
};

/**
 * Onde a música foi confirmada na web, com as sugestões de busca do Google que precisam
 * aparecer junto de respostas verificadas com a busca (exigência do Google).
 */
export function SearchSources({ sources, searchHtml }: Props) {
  const box = useRef<View>(null);
  const showHtml = Platform.OS === 'web' && Boolean(searchHtml);

  useEffect(() => {
    if (!showHtml) return;
    // No navegador, a View é um elemento da página: o HTML do Google fica isolado num shadow DOM.
    const host = box.current as unknown as HTMLElement | null;
    if (!host?.attachShadow) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.innerHTML = searchHtml ?? '';
  }, [showHtml, searchHtml]);

  if (!sources?.length && !showHtml) return null;
  return (
    <View style={styles.wrap}>
      {sources?.length ? (
        <View style={styles.row}>
          <AppText variant="caption" color={colors.onPrimarySecondary}>
            Confirmado em:
          </AppText>
          {sources.map((source) => (
            <Pressable key={source.uri} onPress={() => void Linking.openURL(source.uri)} accessibilityRole="link">
              <AppText variant="caption" weight="bold" color={colors.white} numberOfLines={1}>
                {source.title}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
      {showHtml ? <View ref={box} style={styles.suggestions} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  suggestions: {
    width: '100%',
  },
});
