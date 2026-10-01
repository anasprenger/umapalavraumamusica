import type { OnlinePlayer } from '@/types/online';

/** Situação do jogador para exibir abaixo do nome (ativo não mostra nada). */
export function playerStatus(player: Pick<OnlinePlayer, 'is_active' | 'left_reason'>): string | undefined {
  if (player.is_active) return undefined;
  return player.left_reason === 'left' ? 'Saiu da sala' : 'Desconectado';
}
