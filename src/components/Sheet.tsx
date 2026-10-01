import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, maxContentWidth, radii, spacing } from '@/theme';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

type Props = {
  visible: boolean;
  onClose?: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Impede fechar tocando fora (para decisões obrigatórias). */
  dismissable?: boolean;
};

/** Painel inferior no estilo iOS, usado para menus, confirmações e escolhas. */
export function Sheet({ visible, onClose, title, subtitle, children, footer, dismissable = true }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissable ? onClose : undefined}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Fechar"
          onPress={dismissable ? onClose : undefined}
        />
        <Animated.View
          entering={FadeInDown.duration(280)}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs }]}>
          <View style={styles.grabber} />
          {title || (dismissable && onClose) ? (
            <View style={styles.header}>
              <View style={styles.titles}>
                {title ? <AppText variant="title3">{title}</AppText> : null}
                {subtitle ? (
                  <AppText variant="subhead" color={colors.inkSecondary}>
                    {subtitle}
                  </AppText>
                ) : null}
              </View>
              {dismissable && onClose ? (
                <IconButton icon="close" onPress={onClose} accessibilityLabel="Fechar" size={34} />
              ) : null}
            </View>
          ) : null}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: maxContentWidth,
    maxHeight: '85%',
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.lilacStrong,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    gap: spacing.xs,
  },
  footer: {
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
});
