import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/animations';
import { AppText, Avatar, Button, Icon, Sheet } from '@/components';
import type { LocalPlayer } from '@/game/local/types';
import { haptic } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';

type Props = {
  visible: boolean;
  players: LocalPlayer[];
  onClose: () => void;
  onConfirm: (playerId: string) => void;
};

/** "Quem acertou?" — escolha do jogador que ganha o ponto. */
export function WinnerSheet({ visible, players, onClose, onConfirm }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedPlayer = players.find((player) => player.id === selected);

  const close = () => {
    setSelected(null);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Quem acertou?"
      subtitle="Escolha quem encontrou a música."
      footer={
        <Button
          title={selectedPlayer ? `+1 ponto para ${selectedPlayer.name}` : 'Selecione um jogador'}
          icon="checkmark"
          disabled={!selectedPlayer}
          onPress={() => {
            if (!selected) return;
            onConfirm(selected);
            setSelected(null);
          }}
        />
      }>
      {players.map((player) => {
        const isSelected = player.id === selected;
        return (
          <PressableScale
            key={player.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={player.name}
            onPress={() => {
              haptic('selection');
              setSelected(player.id);
            }}
            style={[styles.option, isSelected ? styles.optionSelected : null]}>
            <View style={[styles.radio, isSelected ? styles.radioSelected : null]}>
              {isSelected ? <Icon name="checkmark" size={16} color={colors.white} /> : null}
            </View>
            <Avatar name={player.name} size={36} />
            <AppText variant="headline" style={styles.name} numberOfLines={1}>
              {player.name}
            </AppText>
            <AppText variant="subhead" color={colors.inkTertiary}>
              {player.score}
            </AppText>
          </PressableScale>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.separator,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.lilacSoft,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.lilacStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  name: {
    flex: 1,
  },
});
