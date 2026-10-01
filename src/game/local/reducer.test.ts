import { describe, expect, it } from 'vitest';

import { displayRoundNumber, initialLocalState, localGameReducer, validatePlayerName } from './reducer';
import type { LocalAction, LocalGameState } from './types';

function run(actions: LocalAction[], state: LocalGameState = initialLocalState): LocalGameState {
  return actions.reduce(localGameReducer, state);
}

const withPlayers: LocalAction[] = [
  { type: 'ADD_PLAYER', id: 'a', name: 'Ana' },
  { type: 'ADD_PLAYER', id: 'j', name: 'João' },
  { type: 'ADD_PLAYER', id: 'm', name: 'Maria' },
];

const started = run([...withPlayers, { type: 'START', word: 'amor' }]);

describe('configuração do modo local', () => {
  it('exige pelo menos 2 jogadores para começar', () => {
    const one = run([{ type: 'ADD_PLAYER', id: 'a', name: 'Ana' }, { type: 'START', word: 'amor' }]);
    expect(one.phase).toBe('setup');
    expect(started.phase).toBe('playing');
    expect(started.currentWord).toBe('amor');
  });

  it('recusa nomes vazios e repetidos (ignorando acentos e caixa)', () => {
    const state = run(withPlayers);
    expect(validatePlayerName(state, '   ')).toBe('Digite um nome.');
    expect(validatePlayerName(state, 'joao')).toBe('Já existe um jogador com esse nome.');
    expect(validatePlayerName(state, 'Pedro')).toBeNull();
    expect(run([{ type: 'ADD_PLAYER', id: 'x', name: 'ANA' }], state).players).toHaveLength(3);
  });

  it('permite adicionar jogadores durante a partida', () => {
    const state = run([{ type: 'ADD_PLAYER', id: 'p', name: 'Pedro' }], started);
    expect(state.players.map((p) => p.name)).toEqual(['Ana', 'João', 'Maria', 'Pedro']);
    expect(state.players[3].score).toBe(0);
  });

  it('só permite remover jogadores antes de começar', () => {
    expect(run([{ type: 'REMOVE_PLAYER', id: 'a' }], started).players).toHaveLength(3);
    expect(run([...withPlayers, { type: 'REMOVE_PLAYER', id: 'a' }]).players).toHaveLength(2);
  });
});

describe('contagem de rodadas no modo local', () => {
  it('acerto dá 1 ponto, conta a rodada e já passa para a próxima palavra', () => {
    const state = run([{ type: 'MARK_WINNER', playerId: 'j', word: 'casa' }], started);
    expect(state.phase).toBe('playing');
    expect(state.currentWord).toBe('casa');
    expect(state.currentAttempts).toBe(0);
    expect(state.roundsPlayed).toBe(1);
    expect(state.players.find((p) => p.id === 'j')?.score).toBe(1);
    expect(displayRoundNumber(state)).toBe(2);
  });

  it('acerto de jogador inexistente ou com palavra repetida é ignorado', () => {
    expect(run([{ type: 'MARK_WINNER', playerId: 'x', word: 'casa' }], started)).toBe(started);
    expect(run([{ type: 'MARK_WINNER', playerId: 'j', word: 'Amor' }], started)).toBe(started);
  });

  it('acerto na última palavra do banco conta o ponto e encerra', () => {
    const state = run([{ type: 'MARK_WINNER', playerId: 'a', word: null }], started);
    expect(state.phase).toBe('finished');
    expect(state.endReason).toBe('words_exhausted');
    expect(state.roundsPlayed).toBe(1);
    expect(state.players.find((p) => p.id === 'a')?.score).toBe(1);
  });

  it('palavra pulada sem tentativa NÃO conta como rodada', () => {
    const state = run([{ type: 'SKIP_WORD', word: 'casa' }], started);
    expect(state.roundsPlayed).toBe(0);
    expect(state.currentWord).toBe('casa');
    expect(displayRoundNumber(state)).toBe(1);
  });

  it('palavra com tentativa e depois pulada conta como rodada, sem ponto', () => {
    const state = run([{ type: 'REGISTER_ATTEMPT' }, { type: 'SKIP_WORD', word: 'casa' }], started);
    expect(state.roundsPlayed).toBe(1);
    expect(state.players.every((p) => p.score === 0)).toBe(true);
    expect(displayRoundNumber(state)).toBe(2);
  });

  it('a mesma palavra nunca conta duas vezes', () => {
    const state = run(
      [{ type: 'REGISTER_ATTEMPT' }, { type: 'REGISTER_ATTEMPT' }, { type: 'MARK_WINNER', playerId: 'a', word: 'casa' }],
      started,
    );
    expect(state.roundsPlayed).toBe(1);
    expect(state.players.find((p) => p.id === 'a')?.score).toBe(1);
  });

  it('contador de rodadas acompanha várias palavras', () => {
    const state = run(
      [
        { type: 'MARK_WINNER', playerId: 'a', word: 'casa' }, // rodada 1
        { type: 'SKIP_WORD', word: 'sol' }, // não conta
        { type: 'REGISTER_ATTEMPT' }, // rodada 2
        { type: 'SKIP_WORD', word: 'noite' },
        { type: 'MARK_WINNER', playerId: 'm', word: 'lua' }, // rodada 3
      ],
      started,
    );
    expect(state.roundsPlayed).toBe(3);
    expect(state.usedWords).toEqual(['amor', 'casa', 'sol', 'noite', 'lua']);
    expect(state.players.map((p) => p.score)).toEqual([1, 0, 1]);
  });

  it('não aceita palavra repetida na mesma partida', () => {
    const state = run([{ type: 'SKIP_WORD', word: 'AMOR' }], started);
    expect(state).toBe(started);
  });

  it('encerra quando o banco de palavras acaba', () => {
    const state = run([{ type: 'SKIP_WORD', word: null }], started);
    expect(state.phase).toBe('finished');
    expect(state.endReason).toBe('words_exhausted');
  });
});

describe('finalização e nova partida', () => {
  it('finaliza a qualquer momento durante o jogo', () => {
    expect(run([{ type: 'FINISH' }], started).phase).toBe('finished');
    const afterPoint = run([{ type: 'MARK_WINNER', playerId: 'a', word: 'casa' }, { type: 'FINISH' }], started);
    expect(afterPoint.phase).toBe('finished');
    expect(afterPoint.roundsPlayed).toBe(1);
  });

  it('finalizar com alguém escolhido conta o acerto da palavra atual uma única vez', () => {
    const state = run([{ type: 'REGISTER_ATTEMPT' }, { type: 'FINISH', winnerId: 'm' }], started);
    expect(state.phase).toBe('finished');
    expect(state.roundsPlayed).toBe(1);
    expect(state.players.find((p) => p.id === 'm')?.score).toBe(1);
    expect(run([{ type: 'FINISH', winnerId: 'x' }], started).players.every((p) => p.score === 0)).toBe(true);
  });

  it('ao zerar depois do fim, os nomes dos jogadores também somem', () => {
    const finished = run([{ type: 'MARK_WINNER', playerId: 'a', word: 'casa' }, { type: 'FINISH' }], started);
    const fresh = run([{ type: 'RESET' }], finished);
    expect(fresh).toEqual(initialLocalState);
    expect(fresh.players).toEqual([]);
  });

  it('partidas salvas por versões antigas são descartadas', () => {
    const legacy = { ...started, version: 1, phase: 'celebrating' } as unknown as LocalGameState;
    expect(run([{ type: 'HYDRATE', state: legacy }])).toBe(initialLocalState);
    expect(run([{ type: 'HYDRATE', state: started }])).toBe(started);
  });
});
