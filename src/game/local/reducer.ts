import { normalizeText, tidyName } from '@/utils/normalize';

import type { LocalAction, LocalGameState } from './types';

export const LOCAL_MIN_PLAYERS = 2;
export const LOCAL_MAX_PLAYERS = 20;
export const PLAYER_NAME_MAX = 24;

export const initialLocalState: LocalGameState = {
  version: 2,
  phase: 'setup',
  players: [],
  usedWords: [],
  currentWord: null,
  currentAttempts: 0,
  roundsPlayed: 0,
  currentRoundNumber: null,
  endReason: null,
  nextPlayerOrder: 1,
};

/** Número exibido em "Rodada N": o da palavra atual, se já contou, ou o próximo. */
export function displayRoundNumber(state: LocalGameState): number {
  return state.currentRoundNumber ?? state.roundsPlayed + 1;
}

/** Valida um nome de jogador; retorna a mensagem de erro ou `null` se estiver ok. */
export function validatePlayerName(state: LocalGameState, rawName: string): string | null {
  const name = tidyName(rawName);
  if (!name) return 'Digite um nome.';
  if (name.length > PLAYER_NAME_MAX) return `Use até ${PLAYER_NAME_MAX} caracteres.`;
  if (state.players.length >= LOCAL_MAX_PLAYERS) return `O limite é de ${LOCAL_MAX_PLAYERS} jogadores.`;
  const key = normalizeText(name);
  if (state.players.some((player) => normalizeText(player.name) === key)) return 'Já existe um jogador com esse nome.';
  return null;
}

function isUsed(state: LocalGameState, word: string): boolean {
  const key = normalizeText(word);
  return state.usedWords.some((used) => normalizeText(used) === key);
}

/** Conta a palavra atual como rodada (apenas uma vez por palavra). */
function withAttempt(state: LocalGameState): LocalGameState {
  if (state.currentAttempts > 0) {
    return { ...state, currentAttempts: state.currentAttempts + 1 };
  }
  const roundsPlayed = state.roundsPlayed + 1;
  return { ...state, currentAttempts: 1, roundsPlayed, currentRoundNumber: roundsPlayed };
}

/** Conta a palavra atual como rodada e dá 1 ponto para quem acertou. */
function withWinner(state: LocalGameState, playerId: string): LocalGameState {
  const counted = withAttempt(state);
  return {
    ...counted,
    players: counted.players.map((player) =>
      player.id === playerId ? { ...player, score: player.score + 1 } : player,
    ),
  };
}

function hasPlayer(state: LocalGameState, playerId: string): boolean {
  return state.players.some((player) => player.id === playerId);
}

/** Coloca uma nova palavra em jogo, ou encerra se o banco acabou. */
function withNewWord(state: LocalGameState, word: string | null): LocalGameState {
  if (word === null) {
    return { ...state, phase: 'finished', currentWord: null, endReason: 'words_exhausted' };
  }
  return {
    ...state,
    phase: 'playing',
    currentWord: word,
    usedWords: [...state.usedWords, word],
    currentAttempts: 0,
    currentRoundNumber: null,
  };
}

/**
 * Máquina de estados do modo local (função pura).
 * As palavras sorteadas chegam prontas nas ações, para manter o reducer determinístico.
 */
export function localGameReducer(state: LocalGameState, action: LocalAction): LocalGameState {
  switch (action.type) {
    case 'ADD_PLAYER': {
      if (state.phase === 'finished') return state;
      if (validatePlayerName(state, action.name) !== null) return state;
      return {
        ...state,
        players: [
          ...state.players,
          { id: action.id, name: tidyName(action.name), score: 0, joinOrder: state.nextPlayerOrder },
        ],
        nextPlayerOrder: state.nextPlayerOrder + 1,
      };
    }

    case 'REMOVE_PLAYER': {
      if (state.phase !== 'setup') return state;
      return { ...state, players: state.players.filter((player) => player.id !== action.id) };
    }

    case 'START': {
      if (state.phase !== 'setup' || state.players.length < LOCAL_MIN_PLAYERS) return state;
      const reset: LocalGameState = {
        ...state,
        usedWords: [],
        roundsPlayed: 0,
        endReason: null,
        players: state.players.map((player) => ({ ...player, score: 0 })),
      };
      return withNewWord(reset, action.word);
    }

    case 'REGISTER_ATTEMPT': {
      if (state.phase !== 'playing') return state;
      return withAttempt(state);
    }

    case 'MARK_WINNER': {
      if (state.phase !== 'playing' || !hasPlayer(state, action.playerId)) return state;
      if (action.word !== null && isUsed(state, action.word)) return state;
      return withNewWord(withWinner(state, action.playerId), action.word);
    }

    case 'SKIP_WORD': {
      // A palavra pulada já foi contada (ou não) no momento da tentativa;
      // aqui ela apenas é descartada e nunca volta.
      if (state.phase !== 'playing') return state;
      if (action.word !== null && isUsed(state, action.word)) return state;
      return withNewWord(state, action.word);
    }

    case 'FINISH': {
      if (state.phase !== 'playing') return state;
      const scored = action.winnerId && hasPlayer(state, action.winnerId) ? withWinner(state, action.winnerId) : state;
      return { ...scored, phase: 'finished', endReason: 'players' };
    }

    case 'RESET':
      return initialLocalState;

    case 'HYDRATE':
      // Partidas salvas por versões antigas (com tela de comemoração) são descartadas.
      return action.state.version === initialLocalState.version ? action.state : state;

    default:
      return state;
  }
}
