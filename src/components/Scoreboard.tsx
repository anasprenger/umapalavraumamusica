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

const MEDALS: Record<number, string> = { 1: colors.gold, 2: colors.silver, 3: colors.bronze };

function medal(position: number, tone: 'light' | 'purple'): string {
  return MEDALS[position] ?? (tone === 'purple' ? colors.onPrimarySurface : colors.lilac);
}

/** Placar ordenado por pontuação, com animação suave quando as posições mudam. */
export function Scoreboard({ players, meId, tone = 'light' }: Props) {
  const ranked = rankPlayers(players);
  return (
    <View style={styles.list}>
      {ranked.map((player) => (
        <Animated.View key={player.id} layout={layout} style={styles.row}>
          <View style={[styles.position, { backgroundColor: medal(player.position, tone) }]}>
            <AppText
              variant="footnote"
              weight="bold"
              color={player.position <= 3 ? colors.primaryDeep : tone === 'purple' ? colors.white : colors.primary}>
              {player.position}º
            </AppText>
          </View>
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
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
});
