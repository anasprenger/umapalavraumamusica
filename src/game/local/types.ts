export type LocalPlayer = {
  id: string;
  name: string;
  score: number;
  joinOrder: number;
};

/**
 * Estados do modo local:
 * setup → playing → (celebrating → playing)* → finished
 */
export type LocalPhase = 'setup' | 'playing' | 'celebrating' | 'finished';

export type LocalGameState = {
  version: 1;
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
  lastWinnerId: string | null;
  endReason: 'players' | 'words_exhausted' | null;
  nextPlayerOrder: number;
};

export type LocalAction =
  | { type: 'ADD_PLAYER'; id: string; name: string }
  | { type: 'REMOVE_PLAYER'; id: string }
  | { type: 'START'; word: string | null }
  /** Uma tentativa foi feita e não era a música certa. */
  | { type: 'REGISTER_ATTEMPT' }
  | { type: 'MARK_WINNER'; playerId: string }
  | { type: 'NEXT_WORD'; word: string | null }
  | { type: 'SKIP_WORD'; word: string | null }
  | { type: 'FINISH' }
  | { type: 'PLAY_AGAIN'; word: string | null }
  | { type: 'RESET' }
  | { type: 'HYDRATE'; state: LocalGameState };
