export type Rankable = { id: string; name: string; score: number; joinOrder?: number };

export type RankedEntry<T extends Rankable> = T & { position: number };

export type PodiumTier<T extends Rankable> = { position: number; players: RankedEntry<T>[] };

/**
 * Classificação com empates (ranking "denso"): jogadores com a mesma pontuação
 * dividem a mesma posição e ninguém é removido da lista.
 * Ex.: 5, 5, 3, 1 → 1º, 1º, 2º, 3º.
 */
export function rankPlayers<T extends Rankable>(players: readonly T[]): RankedEntry<T>[] {
  const sorted = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const orderA = a.joinOrder ?? 0;
    const orderB = b.joinOrder ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  let position = 0;
  let previousScore: number | null = null;
  return sorted.map((player) => {
    if (previousScore === null || player.score !== previousScore) {
      position += 1;
      previousScore = player.score;
    }
    return { ...player, position };
  });
}

/** Separa a classificação em pódio (1º, 2º e 3º lugares) e demais jogadores. */
export function buildPodium<T extends Rankable>(players: readonly T[]) {
  const ranked = rankPlayers(players);
  const tiers: PodiumTier<T>[] = [];
  for (const position of [1, 2, 3]) {
    const group = ranked.filter((entry) => entry.position === position);
    if (group.length > 0) tiers.push({ position, players: group });
  }
  const rest = ranked.filter((entry) => entry.position > 3);
  return { ranked, tiers, rest };
}
