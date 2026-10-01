import { describe, expect, it } from 'vitest';

import {
  advancePhases,
  buildSnapshot,
  createRoom,
  endGame,
  joinRoom,
  kickPlayer,
  leaveRoom,
  normalizeCode,
  PHASE_MS,
  randomCode,
  reactivate,
  requestFinish,
  requestNewWord,
  resolveGuess,
  respondFinalRound,
  restartRoom,
  type RoomDoc,
  RuleError,
  startGame,
  submitGuess,
  sweepPlayers,
  voteKey,
  type VoteDoc,
} from './rules';

const WORDS = ['amor', 'mar', 'sol', 'lua', 'noite', 'céu'];
const T0 = 1_000_000;

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof RuleError ? error.code : 'unexpected';
  }
}

/** Sala com os jogadores p1..pN (p1 é o host). */
function room(players = 3, rounds = 5): RoomDoc {
  let doc = createRoom('ABC234', 'p1', 'Ana', rounds, T0);
  for (let i = 2; i <= players; i += 1) doc = joinRoom(doc, `p${i}`, `Jogador ${i}`, T0).doc;
  return doc;
}

/** Sala já com a primeira palavra na tela. */
function playing(players = 3, rounds = 5) {
  const started = startGame(room(players, rounds), 'p1', T0);
  return advancePhases(started, T0 + PHASE_MS.starting, [], WORDS, () => 0).doc;
}

function guess(doc: RoomDoc, player: string, outcome: 'correct' | 'incorrect' | 'error', at = T0 + 5000) {
  const submitted = submitGuess(doc, player, 'Uma música', `g-${player}-${at}`, at);
  if (!submitted.result.accepted) throw new Error('palpite recusado');
  return resolveGuess(submitted.doc, submitted.result.guess.id, outcome, { title: 'Música', artist: 'Artista' }, at + 10)
    .doc;
}

function vote(doc: RoomDoc, playerId: string, choice: VoteDoc['choice']): VoteDoc {
  return { playerId, key: voteKey(doc)!, choice, at: T0 };
}

/** Avança até o fim da fase atual. */
function expire(doc: RoomDoc, votes: VoteDoc[] = []) {
  return advancePhases(doc, (doc.phaseEndsAt ?? T0) + 1, votes, WORDS, () => 0).doc;
}

describe('salas e lobby (modo online dentro do Claude)', () => {
  it('quem cria vira host; o código tem 6 caracteres sem letras ambíguas', () => {
    const doc = room(1);
    expect(doc.hostPlayerId).toBe('p1');
    expect(randomCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(normalizeCode(' ab-c 234 ')).toBe('ABC234');
  });

  it('só o host inicia, e pode começar sozinho para testar', () => {
    expect(code(() => startGame(room(2), 'p2', T0))).toBe('not_host');
    expect(startGame(room(2), 'p1', T0).status).toBe('starting');
    expect(startGame(room(1), 'p1', T0).status).toBe('starting');
  });

  it('partida com um jogador só: acerto conta e "Finalizar" encerra na hora', () => {
    let doc = playing(1);
    doc = guess(doc, 'p1', 'correct');
    expect(doc.players[0].score).toBe(1);
    expect(doc.roundsPlayed).toBe(1);
    doc = expire(expire(doc));
    const result = requestFinish(doc, 'p1', T0 + 20_000);
    expect(result.finished).toBe(true);
    expect(result.doc.endReason).toBe('majority_finish');
  });

  it('limita a 10 jogadores ativos, dá sufixo a nomes repetidos e não duplica quem volta', () => {
    const full = room(10);
    expect(code(() => joinRoom(full, 'p11', 'Zé', T0))).toBe('room_full');
    const doc = joinRoom(room(1), 'p2', 'ana', T0).doc;
    expect(doc.players.map((p) => p.name)).toEqual(['Ana', 'ana 2']);
    const again = joinRoom(doc, 'p2', 'Outro nome', T0);
    expect(again.changed).toBe(false);
    expect(again.doc.players).toHaveLength(2);
  });
});

describe('palavras e palpites', () => {
  it('a primeira palavra aparece depois da contagem inicial e nunca se repete', () => {
    let doc = playing();
    expect(doc.status).toBe('playing');
    const seen = new Set([doc.word!.word]);
    for (let i = 0; i < WORDS.length - 1; i += 1) {
      doc = requestNewWord(doc, 'p1', T0).doc;
      doc = expire(doc);
      seen.add(doc.word!.word);
    }
    expect(seen.size).toBe(WORDS.length);
    doc = expire(requestNewWord(doc, 'p1', T0).doc);
    expect(doc.status).toBe('finished');
    expect(doc.endReason).toBe('words_exhausted');
  });

  it('palpites simultâneos: só o primeiro é aceito', () => {
    const doc = playing();
    const first = submitGuess(doc, 'p2', 'Primeira', 'g1', T0);
    const second = submitGuess(first.doc, 'p3', 'Segunda', 'g2', T0);
    expect(first.result.accepted).toBe(true);
    expect(second.result).toEqual({ accepted: false, reason: 'busy' });
    expect(second.doc.activeGuess?.playerId).toBe('p2');
  });

  it('acerto dá o ponto, conta a rodada e segue para a próxima palavra', () => {
    const doc = guess(playing(), 'p2', 'correct');
    expect(doc.status).toBe('correct');
    expect(doc.roundsPlayed).toBe(1);
    expect(doc.players.find((p) => p.id === 'p2')?.score).toBe(1);
    const countdown = expire(doc);
    expect(countdown.status).toBe('countdown');
    expect(expire(countdown).word?.sequence).toBe(2);
  });

  it('um resultado atrasado (depois do tempo esgotado) não altera a partida', () => {
    const doc = playing();
    const submitted = submitGuess(doc, 'p2', 'Música', 'g1', T0);
    const expired = expire(submitted.doc);
    expect(expired.status).toBe('playing');
    expect(expired.roundsPlayed).toBe(0);
    expect(resolveGuess(expired, 'g1', 'correct', {}, T0 + PHASE_MS.verifyTimeout + 5).applied).toBe(false);
  });

  it('falha na verificação não conta rodada e libera novos palpites', () => {
    const doc = guess(playing(), 'p2', 'error');
    expect(doc.status).toBe('playing');
    expect(doc.roundsPlayed).toBe(0);
    expect(doc.word?.hasAttempt).toBe(false);
  });
});

describe('contagem de rodadas e votação', () => {
  it('palavra errada e nova tentativa: conta uma única vez', () => {
    let doc = expire(guess(playing(), 'p2', 'incorrect'));
    expect(doc.status).toBe('decision');
    doc = expire(doc, [vote(doc, 'p1', 'new_guess'), vote(doc, 'p2', 'new_guess')]);
    expect(doc.status).toBe('playing');
    doc = guess(doc, 'p3', 'incorrect', T0 + 20_000);
    expect(doc.roundsPlayed).toBe(1);
    expect(doc.word?.roundNumber).toBe(1);
  });

  it('empate ou ninguém votando sorteia nova palavra', () => {
    let doc = expire(guess(playing(4), 'p2', 'incorrect'));
    const tie = expire(doc, [vote(doc, 'p1', 'new_guess'), vote(doc, 'p2', 'new_word')]);
    expect(tie.word?.sequence).toBe(2);
    doc = expire(guess(playing(4), 'p2', 'incorrect'));
    expect(expire(doc).word?.sequence).toBe(2);
  });

  it('votos de outra votação não contam', () => {
    const doc = expire(guess(playing(), 'p2', 'incorrect'));
    const old: VoteDoc = { playerId: 'p1', key: '1:1:0', choice: 'new_guess', at: T0 };
    expect(expire(doc, [old]).word?.sequence).toBe(2);
  });

  it('palavra pulada sem tentativa NÃO conta como rodada', () => {
    const { doc, voteKey: key } = requestNewWord(playing(), 'p2', T0);
    expect(key).toBe('1:1:1');
    const next = expire(doc, [{ playerId: 'p2', key, choice: 'new_word', at: T0 }]);
    expect(next.roundsPlayed).toBe(0);
    expect(next.word?.sequence).toBe(2);
  });

  it('a partida termina ao completar as rodadas configuradas', () => {
    let doc = playing(3, 2);
    doc = expire(expire(guess(doc, 'p2', 'correct')));
    doc = guess(doc, 'p3', 'correct', T0 + 30_000);
    expect(buildSnapshot(doc, 'p1', [], T0).kicked).toBe(false);
    doc = expire(doc);
    expect(doc.status).toBe('finished');
    expect(doc.endReason).toBe('rounds_completed');
  });
});

describe('finalizar, host e conexão', () => {
  it('finalizar precisa de mais da metade dos ativos e pedidos repetidos não contam', () => {
    let doc = playing(4);
    doc = requestFinish(doc, 'p1', T0).doc;
    doc = requestFinish(doc, 'p1', T0).doc;
    doc = requestFinish(doc, 'p2', T0).doc;
    expect(doc.status).toBe('playing');
    const snapshot = buildSnapshot(doc, 'p1', [], T0);
    expect(!snapshot.kicked && snapshot.finish).toMatchObject({ count: 2, needed: 3, i_requested: true });
    const result = requestFinish(doc, 'p3', T0);
    expect(result.finished).toBe(true);
    expect(result.doc.endReason).toBe('majority_finish');
  });

  it('host sai → próximo na ordem de entrada; quem volta entra no fim da fila', () => {
    let doc = leaveRoom(playing(3), 'p1', T0).doc;
    expect(doc.hostPlayerId).toBe('p2');
    doc = joinRoom(doc, 'p1', 'Ana', T0).doc;
    doc = leaveRoom(doc, 'p2', T0).doc;
    expect(doc.hostPlayerId).toBe('p3');
  });

  it('sem presença → inativo (mantém pontos), reconecta sem duplicar e sem retomar o host', () => {
    let doc = guess(playing(3), 'p1', 'correct');
    doc = sweepPlayers(doc, ['p1'], T0).doc;
    expect(doc.players.find((p) => p.id === 'p1')).toMatchObject({ isActive: false, leftReason: 'timeout', score: 1 });
    expect(doc.hostPlayerId).toBe('p2');
    doc = reactivate(doc, 'p1', T0).doc;
    expect(doc.players.filter((p) => p.id === 'p1')).toHaveLength(1);
    expect(doc.players.find((p) => p.id === 'p1')?.isActive).toBe(true);
    expect(doc.hostPlayerId).toBe('p2');
  });

  it('palpite de quem sumiu deixa de travar a partida; se todos somem, a sala encerra', () => {
    const submitted = submitGuess(playing(3), 'p2', 'Música', 'g1', T0).doc;
    const swept = sweepPlayers(submitted, [], T0, { guesserGone: true }).doc;
    expect(swept.status).toBe('playing');
    expect(sweepPlayers(swept, ['p1', 'p2', 'p3'], T0).doc.endReason).toBe('abandoned');
  });

  it('expulso não volta e vê apenas o aviso', () => {
    const doc = kickPlayer(playing(3), 'p1', 'p3', T0);
    expect(code(() => joinRoom(doc, 'p3', 'Zé', T0))).toBe('kicked');
    expect(buildSnapshot(doc, 'p3', [], T0).kicked).toBe(true);
    expect(code(() => kickPlayer(doc, 'p2', 'p1', T0))).toBe('not_host');
  });

  it('aviso de última rodada: NÃO encerra o aviso; SIM adiciona rodadas', () => {
    const doc = playing(2, 1);
    const snapshot = buildSnapshot(doc, 'p1', [], T0);
    expect(!snapshot.kicked && snapshot.room.final_round_prompt).toBe(true);
    const no = buildSnapshot(respondFinalRound(doc, 'p1', 0, T0), 'p1', [], T0);
    expect(!no.kicked && no.room.final_round_prompt).toBe(false);
    expect(respondFinalRound(doc, 'p1', 5, T0).configuredRounds).toBe(6);
  });

  it('host encerra e depois reinicia a mesma sala zerando pontos e palavras', () => {
    let doc = guess(playing(2), 'p2', 'correct');
    doc = endGame(doc, 'p1', T0).doc;
    expect(doc.endReason).toBe('host_ended');
    doc = restartRoom(doc, 'p1', 10, T0);
    expect(doc).toMatchObject({ status: 'waiting', configuredRounds: 10, roundsPlayed: 0, usedWords: [], match: 2 });
    expect(doc.players.every((p) => p.score === 0)).toBe(true);
  });
});
