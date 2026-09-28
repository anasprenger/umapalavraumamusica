import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import { formatPoints } from '@/utils/format';

import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

type Props = {
  name: string;
  score?: number;
  isHost?: boolean;
  isMe?: boolean;
  inactive?: boolean;
  statusText?: string;
  trailing?: ReactNode;
  tone?: 'light' | 'purple';
};

/** Linha de jogador: avatar, nome, selo de host e pontuação. */
export function PlayerRow({ name, score, isHost, isMe, inactive, statusText, trailing, tone = 'light' }: Props) {
  const onPurple = tone === 'purple';
  const main = onPurple ? colors.white : colors.ink;
  const secondary = onPurple ? colors.onPrimarySecondary : colors.inkSecondary;

  return (
    <View style={[styles.row, inactive ? styles.inactive : null]}>
      <Avatar name={name} dimmed={inactive} tone={onPurple ? 'white' : 'color'} />
      <View style={styles.info}>
        <View style={styles.nameLine}>
          <AppText variant="headline" color={main} numberOfLines={1} style={styles.name}>
            {name}
            {isMe ? <AppText variant="subhead" color={secondary}>{'  (você)'}</AppText> : null}
          </AppText>
          {isHost ? (
            <View style={[styles.hostBadge, onPurple ? styles.hostBadgePurple : null]}>
              <Icon name="star" size={11} color={onPurple ? colors.primaryDark : colors.white} />
              <AppText variant="caption" weight="bold" color={onPurple ? colors.primaryDark : colors.white}>
                HOST
              </AppText>
            </View>
          ) : null}
        </View>
        {statusText ? (
          <AppText variant="footnote" color={secondary}>
            {statusText}
          </AppText>
        ) : null}
      </View>
      {typeof score === 'number' ? (
        <AppText variant="headline" color={onPurple ? colors.white : colors.primary} accessibilityLabel={formatPoints(score)}>
          {score}
        </AppText>
      ) : null}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  inactive: {
    opacity: 0.6,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    flexShrink: 1,
  },
  hostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  hostBadgePurple: {
    backgroundColor: colors.white,
  },
});
