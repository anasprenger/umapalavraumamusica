import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type Props = {
  title: string;
  icon: IconName;
  /** Conteúdo à direita (ex.: contador de jogadores). */
  right?: ReactNode;
};

/** Título de seção dos cartões: ícone num círculo lilás e o texto em roxo. */
export function SectionTitle({ title, icon, right }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Icon name={icon} size={14} color={colors.primary} />
      </View>
      <AppText variant="overline" color={colors.primary} style={styles.title}>
        {title}
      </AppText>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.lilac,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
});
