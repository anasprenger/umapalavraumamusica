export type LocalPlayer = {
  id: string;
  name: string;
  score: number;
  joinOrder: number;
};

/**
 * Estados do modo local: setup → playing → finished.
 * Ao encerrar, os nomes só ficam até sair do pódio (depois tudo zera).
 */
export type LocalPhase = 'setup' | 'playing' | 'finished';

export type LocalGameState = {
  version: 2;
  phase: LocalPhase;
  players: LocalPlayer[];
  /** Palavras já sorteadas nesta partida (nunca se repetem). */
  usedWords: string[];
  currentWord: string | null;
  /** Tentativas registradas na palavra atual. Com pelo menos uma, a palavra conta como rodada. */
  currentAttempts: number;
  /** Rodadas contabilizadas (palavras que tiveram ao menos uma tentativa). */
  roundsPlayed: number;
  /** Número da rodada atribuído à palavra atual, quando ela já foi contabilizada. */
  currentRoundNumber: number | null;
  endReason: 'players' | 'words_exhausted' | null;
  nextPlayerOrder: number;
};

export type LocalAction =
  | { type: 'ADD_PLAYER'; id: string; name: string }
  | { type: 'REMOVE_PLAYER'; id: string }
  | { type: 'START'; word: string | null }
  /** Uma tentativa foi feita e não era a música certa. */
  | { type: 'REGISTER_ATTEMPT' }
  /** Ponto para quem acertou e já entra a próxima palavra (sem tela de comemoração). */
  | { type: 'MARK_WINNER'; playerId: string; word: string | null }
  | { type: 'SKIP_WORD'; word: string | null }
  /** Encerra; com `winnerId`, o acerto da palavra atual é contado antes. */
  | { type: 'FINISH'; winnerId?: string | null }
  /** Zera tudo, inclusive os nomes dos jogadores. */
  | { type: 'RESET' }
  | { type: 'HYDRATE'; state: LocalGameState };
