import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/animations';
import { haptic } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';

import { AppText } from './AppText';
import { TextField } from './TextField';

export const ROUND_PRESETS = [5, 10, 20] as const;
/** Limite técnico de segurança (não é um limite de regra do jogo). */
export const MAX_ROUNDS = 9999;

type Props = {
  value: number | null;
  onChange: (rounds: number | null) => void;
  presets?: readonly number[];
  label?: string;
};

/** Escolha do número de rodadas: 5, 10, 20 ou quantidade personalizada. */
export function RoundSelector({ value, onChange, presets = ROUND_PRESETS, label = 'Número de rodadas' }: Props) {
  const isPreset = value !== null && presets.includes(value);
  const [custom, setCustom] = useState(!isPreset && value !== null);
  const [customText, setCustomText] = useState(!isPreset && value !== null ? String(value) : '');

  const selectPreset = (rounds: number) => {
    haptic('selection');
    setCustom(false);
    onChange(rounds);
  };

  const selectCustom = () => {
    haptic('selection');
    setCustom(true);
    const parsed = parseRounds(customText);
    onChange(parsed);
  };

  return (
    <View style={styles.wrapper}>
      <AppText variant="footnote" weight="semibold" color={colors.inkSecondary}>
        {label}
      </AppText>
      <View style={styles.options}>
        {presets.map((rounds) => (
          <Option key={rounds} label={String(rounds)} selected={!custom && value === rounds} onPress={() => selectPreset(rounds)} />
        ))}
        <Option label="Personalizado" selected={custom} onPress={selectCustom} wide />
      </View>
      {custom ? (
        <TextField
          autoFocus
          keyboardType="number-pad"
          placeholder="Ex.: 70"
          value={customText}
          maxLength={4}
          onChangeText={(text) => {
            const digits = text.replace(/\D/g, '');
            setCustomText(digits);
            onChange(parseRounds(digits));
          }}
          hint="Digite qualquer quantidade de rodadas."
          accessibilityLabel="Quantidade personalizada de rodadas"
        />
      ) : null}
    </View>
  );
}

export function parseRounds(text: string): number | null {
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.min(parsed, MAX_ROUNDS);
}

function Option({ label, selected, onPress, wide }: { label: string; selected: boolean; onPress: () => void; wide?: boolean }) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.option, wide ? styles.optionWide : null, selected ? styles.optionSelected : null]}>
      <AppText variant={wide ? 'subhead' : 'title3'} weight="semibold" color={selected ? colors.white : colors.primaryDark}>
        {label}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  option: {
    flexGrow: 1,
    minWidth: 64,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.lilac,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionWide: {
    minWidth: 130,
  },
  optionSelected: {
    backgroundColor: colors.primary,
  },
});
