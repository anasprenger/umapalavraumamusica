/** "1 ponto", "2 pontos". */
export function formatPoints(points: number): string {
  return `${points} ${points === 1 ? 'ponto' : 'pontos'}`;
}

/** "1 jogador", "3 jogadores". */
export function formatPlayers(count: number): string {
  return `${count} ${count === 1 ? 'jogador' : 'jogadores'}`;
}

/** "1 rodada", "5 rodadas". */
export function formatRounds(count: number): string {
  return `${count} ${count === 1 ? 'rodada' : 'rodadas'}`;
}

/** "1º", "2º"... */
export function ordinal(position: number): string {
  return `${position}º`;
}

/** Iniciais para o avatar ("Ana Maria" → "AM", "Ana" → "A"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Índice estável a partir de um texto (para cores de avatar). */
export function hashIndex(value: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}
