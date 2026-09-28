import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { layout } from '@/animations';
import { colors, spacing } from '@/theme';
import { rankPlayers, type Rankable } from '@/utils/ranking';

import { AppText } from './AppText';
import { PlayerRow } from './PlayerRow';

type Player = Rankable & { isHost?: boolean; inactive?: boolean; statusText?: string };

type Props = {
  players: readonly Player[];
  meId?: string | null;
  tone?: 'light' | 'purple';
};

/** Placar ordenado por pontuação, com animação suave quando as posições mudam. */
export function Scoreboard({ players, meId, tone = 'light' }: Props) {
  const ranked = rankPlayers(players);
  return (
    <View style={styles.list}>
      {ranked.map((player) => (
        <Animated.View key={player.id} layout={layout} style={styles.row}>
          <AppText
            variant="subhead"
            weight="semibold"
            color={tone === 'purple' ? colors.onPrimaryTertiary : colors.inkTertiary}
            style={styles.position}>
            {player.position}º
          </AppText>
          <View style={styles.flex}>
            <PlayerRow
              name={player.name}
              score={player.score}
              isHost={player.isHost}
              isMe={player.id === meId}
              inactive={player.inactive}
              statusText={player.statusText ?? (player.inactive ? 'Desconectado' : undefined)}
              tone={tone}
            />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  position: {
    width: 28,
  },
  flex: {
    flex: 1,
  },
});
