import { Alert, Platform } from 'react-native';

export type DialogOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** `null` mostra só o botão de confirmação (aviso simples). */
  cancelLabel?: string | null;
  destructive?: boolean;
};

export type DialogRequest = DialogOptions & { resolve: (confirmed: boolean) => void };

type DialogListener = (request: DialogRequest) => void;

let hostListener: DialogListener | null = null;

/**
 * Na web, os diálogos são desenhados pelo próprio app (`DialogHost`): `window.confirm`
 * é feio, foge da identidade visual e é bloqueado em páginas embutidas.
 */
export function registerDialogHost(listener: DialogListener): () => void {
  hostListener = listener;
  return () => {
    if (hostListener === listener) hostListener = null;
  };
}

function showOnWeb(options: DialogOptions): Promise<boolean> {
  if (hostListener) {
    const listener = hostListener;
    return new Promise((resolve) => listener({ ...options, resolve }));
  }
  if (typeof window === 'undefined') return Promise.resolve(false);
  const text = options.message ? `${options.title}\n\n${options.message}` : options.title;
  return Promise.resolve(options.cancelLabel === null ? (window.alert(text), true) : window.confirm(text));
}

/** Confirmação: Alert nativo no iOS/Android, diálogo do app na web. */
export function confirmAction({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
}: DialogOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    return showOnWeb({ title, message, confirmLabel, cancelLabel, destructive });
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel ?? 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Aviso simples com um botão "OK". */
export function notify(title: string, message?: string): Promise<void> {
  if (Platform.OS === 'web') {
    return showOnWeb({ title, message, confirmLabel: 'OK', cancelLabel: null }).then(() => undefined);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [{ text: 'OK', onPress: () => resolve() }], {
      cancelable: true,
      onDismiss: () => resolve(),
    });
  });
}
