import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, maxContentWidth, spacing } from '@/theme';

type Props = {
  children: ReactNode;
  /** `light`: fundo claro com texto escuro. `purple`: fundo roxo com texto branco. */
  tone?: 'light' | 'white' | 'purple';
  scroll?: boolean;
  /** Conteúdo fixo no rodapé (ex.: botões principais). */
  footer?: ReactNode;
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: Edge[];
  keyboard?: boolean;
  /** Camada em tela cheia por cima de tudo (fases da rodada, avisos). */
  overlay?: ReactNode;
};

const backgrounds = {
  light: colors.background,
  white: colors.white,
  purple: colors.primaryDeep,
} as const;

/** Estrutura base de todas as telas: área segura, largura máxima e rodapé fixo opcional. */
export function Screen({
  children,
  tone = 'light',
  scroll = false,
  footer,
  header,
  contentStyle,
  edges = ['top', 'bottom', 'left', 'right'],
  keyboard = false,
  overlay,
}: Props) {
  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, styles.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, contentStyle]}>{children}</View>
  );

  const inner = (
    <View style={styles.column}>
      {header}
      {body}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: backgrounds[tone] }]}>
      <StatusBar style={tone === 'purple' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.flex} edges={edges}>
        {keyboard ? (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {inner}
          </KeyboardAvoidingView>
        ) : (
          inner
        )}
      </SafeAreaView>
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  content: {
    paddingHorizontal: spacing.xl,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
});
