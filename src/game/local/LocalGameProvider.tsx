import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from 'react';

import { pickRandomWord } from '@/data/words';
import { storage } from '@/services/storage';

import { initialLocalState, localGameReducer, validatePlayerName } from './reducer';
import type { LocalGameState } from './types';

type LocalGameApi = {
  state: LocalGameState;
  hydrated: boolean;
  /** Retorna uma mensagem de erro, ou `null` se o jogador foi adicionado. */
  addPlayer: (name: string) => string | null;
  removePlayer: (id: string) => void;
  start: () => void;
  registerAttempt: () => void;
  markWinner: (playerId: string) => void;
  nextWord: () => void;
  skipWord: () => void;
  finish: () => void;
  playAgain: () => void;
  /** Volta para a configuração mantendo os nomes dos jogadores. */
  backToSetup: () => void;
};

const LocalGameContext = createContext<LocalGameApi | null>(null);

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Estado do modo local, compartilhado entre as telas e salvo no aparelho. */
export function LocalGameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(localGameReducer, initialLocalState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    storage.loadLocalGame<LocalGameState>().then((saved) => {
      if (cancelled) return;
      if (saved && saved.version === 1) dispatch({ type: 'HYDRATE', state: saved });
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated) void storage.saveLocalGame(state);
  }, [state, hydrated]);

  const draw = () => pickRandomWord(state.usedWords);

  const api: LocalGameApi = {
    state,
    hydrated,
    addPlayer: (name) => {
      const error = validatePlayerName(state, name);
      if (error) return error;
      dispatch({ type: 'ADD_PLAYER', id: newId(), name });
      return null;
    },
    removePlayer: (id) => dispatch({ type: 'REMOVE_PLAYER', id }),
    start: () => dispatch({ type: 'START', word: pickRandomWord([]) }),
    registerAttempt: () => dispatch({ type: 'REGISTER_ATTEMPT' }),
    markWinner: (playerId) => dispatch({ type: 'MARK_WINNER', playerId }),
    nextWord: () => dispatch({ type: 'NEXT_WORD', word: draw() }),
    skipWord: () => dispatch({ type: 'SKIP_WORD', word: draw() }),
    finish: () => dispatch({ type: 'FINISH' }),
    playAgain: () => dispatch({ type: 'PLAY_AGAIN', word: pickRandomWord([]) }),
    backToSetup: () => {
      const players = state.players.map((player) => ({ ...player, score: 0 }));
      dispatch({
        type: 'HYDRATE',
        state: { ...initialLocalState, players, nextPlayerOrder: state.nextPlayerOrder },
      });
    },
  };

  return <LocalGameContext.Provider value={api}>{children}</LocalGameContext.Provider>;
}

export function useLocalGame(): LocalGameApi {
  const context = useContext(LocalGameContext);
  if (!context) throw new Error('useLocalGame precisa estar dentro de <LocalGameProvider>.');
  return context;
}
