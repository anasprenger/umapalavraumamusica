import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { registerDialogHost, type DialogRequest } from '@/services/dialogs';
import { colors, radii, shadows, spacing } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';

/**
 * Diálogos de confirmação desenhados pelo app (usados na web; no iOS/Android
 * o `confirmAction` usa o Alert nativo). Fica montado uma vez no layout raiz.
 */
export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const pending = useRef<DialogRequest | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    return registerDialogHost((next) => {
      // Um novo pedido substitui o anterior, que é respondido como "cancelar".
      pending.current?.resolve(false);
      pending.current = next;
      setRequest(next);
    });
  }, []);

  const close = (confirmed: boolean) => {
    pending.current?.resolve(confirmed);
    pending.current = null;
    setRequest(null);
  };

  if (!request) return null;
  const hasCancel = request.cancelLabel !== null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => close(false)}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Fechar" onPress={() => close(false)} />
        <Animated.View
          entering={ZoomIn.duration(180)}
          style={[styles.card, shadows.strong]}
          accessibilityRole="alert"
          accessibilityViewIsModal>
          <View style={styles.texts}>
            <AppText variant="title3" align="center">
              {request.title}
            </AppText>
            {request.message ? (
              <AppText variant="subhead" color={colors.inkSecondary} align="center">
                {request.message}
              </AppText>
            ) : null}
          </View>
          <View style={styles.actions}>
            {hasCancel ? (
              <Button
                title={request.cancelLabel ?? 'Cancelar'}
                variant="secondary"
                size="medium"
                style={styles.flex}
                onPress={() => close(false)}
              />
            ) : null}
            <Button
              title={request.confirmLabel ?? 'Confirmar'}
              variant={request.destructive ? 'danger' : 'primary'}
              size="medium"
              style={styles.flex}
              onPress={() => close(true)}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  texts: {
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
