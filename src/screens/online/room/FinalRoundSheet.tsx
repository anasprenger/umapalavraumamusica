import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, RoundSelector, Sheet } from '@/components';
import { colors, spacing } from '@/theme';

type Props = {
  visible: boolean;
  onAnswer: (extraRounds: number) => void;
};

/**
 * Aviso ao host: "O jogo está indo para a última rodada. Deseja adicionar mais?"
 * NÃO → a próxima rodada é a última. SIM → escolhe quantas rodadas adicionar.
 */
export function FinalRoundSheet({ visible, onAnswer }: Props) {
  const [adding, setAdding] = useState(false);
  const [extra, setExtra] = useState<number | null>(5);

  return (
    <Sheet
      visible={visible}
      dismissable={false}
      title={adding ? 'Adicionar rodadas' : 'Última rodada chegando'}
      subtitle={adding ? 'Quantas rodadas a mais?' : 'O jogo está indo para a última rodada. Deseja adicionar mais?'}
      footer={
        adding ? (
          <>
            <Button
              title={extra ? `Adicionar ${extra} ${extra === 1 ? 'rodada' : 'rodadas'}` : 'Escolha a quantidade'}
              disabled={!extra}
              onPress={() => {
                if (!extra) return;
                setAdding(false);
                onAnswer(extra);
              }}
            />
            <Button title="Voltar" variant="ghost" size="small" onPress={() => setAdding(false)} />
          </>
        ) : (
          <View style={styles.row}>
            <Button title="NÃO" variant="secondary" style={styles.flex} onPress={() => onAnswer(0)} />
            <Button title="SIM" style={styles.flex} onPress={() => setAdding(true)} />
          </View>
        )
      }>
      {adding ? (
        <RoundSelector value={extra} onChange={setExtra} label="Rodadas extras" />
      ) : (
        <AppText variant="footnote" color={colors.inkTertiary}>
          Só você, como host, pode responder. Se escolher NÃO, o pódio aparece depois da última rodada.
        </AppText>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
