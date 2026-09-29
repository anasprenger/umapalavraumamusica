/**
 * Testes de integração das regras do jogo online (Postgres + funções RPC).
 * Rodar: npm run test:db   (veja docs/TESTES.md para subir um Postgres local)
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import pg from 'pg';

import { callAs, createTestDatabase, gameApi, newUser, RpcError, selectAs, setupPlaying, setupRoom } from './helpers.mjs';

let db;
let pool;

before(async () => {
  db = await createTestDatabase();
  pool = db.pool;
});

after(async () => {
  await db?.drop();
});

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RpcError, `esperava RpcError, veio ${error}`);
    assert.equal(error.code, code);
    return true;
  });
}

const correct = { title: 'Amor Colorido', artist: 'Luan Santana', excerpt: 'meu amor colorido', matchedWord: 'amor', confidence: 0.95, provider: 'test' };

// -----------------------------------------------------------------------------
describe('salas e lobby', () => {
  it('quem cria a sala vira host e recebe um código de 6 caracteres', async () => {
    const api = gameApi(pool);
    const ana = newUser();
    const room = await api.createRoom(ana, 'Ana', 10);
    assert.match(room.code, /^[A-Z0-9]{6}$/);
    const state = await api.state(ana, room.room_id);
    assert.equal(state.me.is_host, true);
    assert.equal(state.room.status, 'waiting');
    assert.equal(state.room.configured_rounds, 10);
    assert.equal(state.players.length, 1);
  });

  it('aceita quantidade personalizada de rodadas (ex.: 70) e recusa inválidas', async () => {
    const api = gameApi(pool);
    const room = await api.createRoom(newUser(), 'Ana', 70);
    assert.ok(room.room_id);
    await rejects(api.createRoom(newUser(), 'Ana', 0), 'invalid_rounds');
    await rejects(api.createRoom(newUser(), '   ', 5), 'invalid_name');
  });

  it('só o host inicia a partida', async () => {
    const { api, users, roomId, code } = await setupRoom(pool, ['Ana']);
    const joao = newUser();
    await api.joinRoom(joao, code, 'João');
    await rejects(api.start(joao, roomId), 'not_host');
    await api.start(users[0], roomId);
    assert.equal((await api.state(joao, roomId)).room.status, 'starting');
  });

  it('o host pode começar sozinho para testar', async () => {
    const { api, users, roomId } = await setupRoom(pool, ['Ana']);
    await api.start(users[0], roomId);
    assert.equal((await api.state(users[0], roomId)).room.status, 'starting');
  });

  it('limita a sala a 10 jogadores ativos', async () => {
    const names = Array.from({ length: 10 }, (_, i) => `Jogador ${i + 1}`);
    const { api, code } = await setupRoom(pool, names);
    await rejects(api.joinRoom(newUser(), code, 'Onze'), 'room_full');
  });

  it('nomes repetidos recebem sufixo e o código ignora caixa/espaços', async () => {
    const { api, code, roomId, users } = await setupRoom(pool, ['Ana']);
    const other = newUser();
    await api.joinRoom(other, ` ${code.toLowerCase()} `, 'ana');
    const state = await api.state(users[0], roomId);
    assert.deepEqual(state.players.map((p) => p.name), ['Ana', 'ana 2']);
  });

  it('entrar de novo não duplica o jogador', async () => {
    const { api, code, roomId, users } = await setupRoom(pool, ['Ana', 'João']);
    await api.joinRoom(users[1], code, 'João');
    await api.joinRoom(users[1], code, 'João');
    assert.equal((await api.state(users[0], roomId)).players.length, 2);
  });
});

// -----------------------------------------------------------------------------
describe('sorteio de palavras', () => {
  it('a primeira palavra aparece após a contagem inicial', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    const state = await api.state(users[1], roomId);
    assert.equal(state.room.status, 'playing');
    assert.ok(state.current_word.word.length > 0);
    assert.equal(state.current_word.display_round, 1);
  });

  it('uma palavra nunca se repete na mesma partida', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João'], 500);
    const seen = new Set();
    for (let i = 0; i < 60; i += 1) {
      const state = await api.state(users[0], roomId);
      const key = state.current_word.word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      assert.ok(!seen.has(key), `palavra repetida: ${state.current_word.word}`);
      seen.add(key);
      await api.skip(users[0], roomId);
      await api.tick(users[0], roomId); // ninguém votou → nova palavra
    }
    const { rows } = await pool.query('select count(*)::int as n from public.used_words where room_id = $1', [roomId]);
    assert.equal(rows[0].n, 61);
  });
});

// -----------------------------------------------------------------------------
describe('ordem dos palpites', () => {
  it('dois jogadores enviando ao mesmo tempo: só o primeiro é processado', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      // Ana começa a transação e segura a sala; João envia enquanto isso.
      await a.query('begin');
      await a.query('set local role service_role');
      const first = a.query('select public.submit_guess($1, $2, $3) as r', [users[0], roomId, 'Amor Colorido']);
      const firstResult = (await first).rows[0].r;
      const secondPromise = callAs(b, 'service', 'submit_guess', { p_user_id: users[1], p_room_id: roomId, p_text: 'Amor Perfeito' });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await a.query('commit');
      const secondResult = await secondPromise;
      assert.equal(firstResult.accepted, true);
      assert.equal(secondResult.accepted, false);
      assert.equal(secondResult.reason, 'busy');
    } finally {
      a.release();
      b.release();
    }
    const state = await api.state(users[1], roomId);
    assert.equal(state.room.status, 'verifying');
    assert.equal(state.active_guess.player_name, 'Ana');
  });

  it('três jogadores enviando simultaneamente: exatamente um é aceito', async () => {
    const { users, roomId } = await setupPlaying(pool, ['Ana', 'João', 'Maria']);
    const clients = await Promise.all(users.map(() => pool.connect()));
    try {
      const results = await Promise.all(
        users.map((user, i) =>
          callAs(clients[i], 'service', 'submit_guess', { p_user_id: user, p_room_id: roomId, p_text: `palpite ${i}` }),
        ),
      );
      assert.equal(results.filter((r) => r.accepted).length, 1);
      assert.equal(results.filter((r) => !r.accepted && r.reason === 'busy').length, 2);
    } finally {
      clients.forEach((client) => client.release());
    }
    const { rows } = await pool.query(`select count(*)::int as n from public.guesses where room_id = $1`, [roomId]);
    assert.equal(rows[0].n, 1);
  });

  it('primeiro palpite correto encerra a palavra e dá o ponto a quem acertou', async () => {
    const { api, users, roomId, players } = await setupPlaying(pool, ['Ana', 'João']);
    await api.guess(users[1], roomId, 'Amor Colorido', 'correct', correct);
    const state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'correct');
    assert.equal(state.last_result.status, 'correct');
    assert.equal(state.last_result.result_song, 'Amor Colorido');
    assert.equal(state.last_result.result_artist, 'Luan Santana');
    assert.equal(state.current_word.winner_player_id, players[1]);
    assert.equal(state.players.find((p) => p.id === players[1]).score, 1);
    // Durante a comemoração ninguém mais consegue enviar.
    const late = await api.submitGuess(users[0], roomId, 'outro');
    assert.equal(late.accepted, false);
  });

  it('primeiro palpite incorreto: mostra incorreto e os jogadores podem tentar de novo', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    await api.guess(users[0], roomId, 'Qualquer coisa', 'incorrect', { reason: 'no_match' });
    let state = await api.state(users[1], roomId);
    assert.equal(state.room.status, 'incorrect');
    assert.equal(state.last_result.failure_reason, 'no_match');
    await api.tick(users[1], roomId); // incorrect → decision
    await api.vote(users[0], roomId, 'new_guess');
    await api.vote(users[1], roomId, 'new_guess');
    await api.tick(users[1], roomId); // decision → playing (mesma palavra)
    state = await api.state(users[1], roomId);
    assert.equal(state.room.status, 'playing');
    const again = await api.submitGuess(users[1], roomId, 'Nova tentativa');
    assert.equal(again.accepted, true);
  });

  it('usuário comum não consegue enviar palpite nem forjar resultado direto no banco', async () => {
    const { users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    await assert.rejects(
      callAs(pool, users[0], 'submit_guess', { p_user_id: users[0], p_room_id: roomId, p_text: 'x' }),
      /permission denied/,
    );
    await assert.rejects(
      callAs(pool, users[0], 'resolve_guess', { p_guess_id: newUser(), p_outcome: 'correct', p_details: '{}' }),
      /permission denied/,
    );
    await assert.rejects(selectAs(pool, users[0], `update public.players set score = 99 where room_id = $1`, [roomId]), /permission denied/);
  });

  it('jogador de fora da sala não pode palpitar', async () => {
    const { api, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    await rejects(api.submitGuess(newUser(), roomId, 'Intruso'), 'not_in_room');
  });
});

// -----------------------------------------------------------------------------
describe('contagem de rodadas', () => {
  it('palavra acertada conta como rodada', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    await api.guess(users[0], roomId, 'Amor Colorido', 'correct', correct);
    const state = await api.state(users[0], roomId);
    assert.equal(state.room.rounds_played, 1);
    assert.equal(state.current_word.round_number, 1);
  });

  it('palavra errada e nova tentativa: conta uma única vez', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    await api.guess(users[0], roomId, 'errado 1', 'incorrect');
    await api.tick(users[0], roomId);
    await api.vote(users[0], roomId, 'new_guess');
    await api.tick(users[0], roomId);
    await api.guess(users[1], roomId, 'errado 2', 'incorrect');
    await api.tick(users[0], roomId);
    await api.vote(users[1], roomId, 'new_guess');
    await api.tick(users[0], roomId);
    await api.guess(users[1], roomId, 'certo', 'correct', correct);
    const state = await api.state(users[0], roomId);
    assert.equal(state.room.rounds_played, 1);
    assert.equal(state.current_word.round_number, 1);
    assert.equal(state.players.find((p) => p.name === 'João').score, 1);
  });

  it('palavra errada e nova palavra: conta como rodada, sem ponto', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    const first = (await api.state(users[0], roomId)).current_word;
    await api.guess(users[0], roomId, 'errado', 'incorrect');
    await api.tick(users[0], roomId);
    await api.vote(users[0], roomId, 'new_word');
    await api.vote(users[1], roomId, 'new_word');
    await api.tick(users[0], roomId);
    const state = await api.state(users[0], roomId);
    assert.notEqual(state.current_word.id, first.id);
    assert.equal(state.room.rounds_played, 1);
    assert.equal(state.current_word.display_round, 2);
    assert.ok(state.players.every((p) => p.score === 0));
  });

  it('palavra pulada sem tentativa NÃO conta como rodada', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    await api.skip(users[0], roomId);
    await api.vote(users[1], roomId, 'new_word');
    await api.tick(users[0], roomId);
    const state = await api.state(users[0], roomId);
    assert.equal(state.room.rounds_played, 0);
    assert.equal(state.current_word.display_round, 1);
    assert.equal(state.current_word.sequence, 2);
  });

  it('falha da API musical não conta como rodada e libera novos palpites', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    await api.guess(users[0], roomId, 'Amor Colorido', 'error', { reason: 'provider_unavailable' });
    const state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'playing');
    assert.equal(state.room.rounds_played, 0);
    assert.equal(state.current_word.has_attempt, false);
    assert.equal(state.last_result.status, 'error');
    assert.equal((await api.submitGuess(users[1], roomId, 'de novo')).accepted, true);
  });

  it('verificação travada expira e o jogo continua sem contar rodada', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    const submitted = await api.submitGuess(users[0], roomId, 'Amor Colorido');
    await api.tick(users[1], roomId);
    let state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'playing');
    assert.equal(state.last_result.failure_reason, 'timeout');
    // Resultado atrasado é ignorado.
    const late = await api.resolve(submitted.guess_id, 'correct', correct);
    assert.equal(late.applied, false);
    state = await api.state(users[0], roomId);
    assert.equal(state.room.rounds_played, 0);
    assert.ok(state.players.every((p) => p.score === 0));
  });

  it('contador de rodadas e fim da partida ao completar as rodadas', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João'], 2);
    await api.guess(users[0], roomId, 'certo', 'correct', correct); // rodada 1
    await api.tick(users[0], roomId); // correct → countdown
    let state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'countdown');
    await api.tick(users[0], roomId); // countdown → nova palavra
    state = await api.state(users[0], roomId);
    assert.equal(state.current_word.display_round, 2);
    assert.equal(state.room.is_last_round, true);
    await api.skip(users[0], roomId); // pulada sem tentativa: não conta
    await api.tick(users[0], roomId);
    state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'playing');
    assert.equal(state.current_word.display_round, 2);
    await api.guess(users[1], roomId, 'certo', 'correct', correct); // rodada 2
    await api.tick(users[0], roomId); // correct → fim
    state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'finished');
    assert.equal(state.room.end_reason, 'rounds_completed');
    assert.equal(state.room.rounds_played, 2);
  });

  it('última palavra errada e descartada encerra a partida', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João'], 1);
    await api.guess(users[0], roomId, 'errado', 'incorrect');
    await api.tick(users[0], roomId);
    await api.tick(users[0], roomId); // ninguém votou → nova palavra → mas rodadas acabaram
    const state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'finished');
    assert.equal(state.room.rounds_played, 1);
  });
});

// -----------------------------------------------------------------------------
describe('votação Novo palpite × Nova palavra', () => {
  async function toDecision(names) {
    const room = await setupPlaying(pool, names);
    await room.api.guess(room.users[0], room.roomId, 'errado', 'incorrect');
    await room.api.tick(room.users[0], room.roomId);
    const state = await room.api.state(room.users[0], room.roomId);
    assert.equal(state.room.status, 'decision');
    return { ...room, wordId: state.current_word.id };
  }

  it('maioria em Novo palpite mantém a palavra', async () => {
    const { api, users, roomId, wordId } = await toDecision(['A', 'B', 'C', 'D', 'E', 'F']);
    for (const user of users.slice(0, 4)) await api.vote(user, roomId, 'new_guess');
    for (const user of users.slice(4)) await api.vote(user, roomId, 'new_word');
    const counts = (await api.state(users[0], roomId)).votes;
    assert.deepEqual([counts.new_guess, counts.new_word], [4, 2]);
    await api.tick(users[0], roomId);
    const state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'playing');
    assert.equal(state.current_word.id, wordId);
  });

  it('maioria em Nova palavra troca a palavra', async () => {
    const { api, users, roomId, wordId } = await toDecision(['A', 'B', 'C', 'D', 'E', 'F']);
    for (const user of users.slice(0, 4)) await api.vote(user, roomId, 'new_word');
    for (const user of users.slice(4)) await api.vote(user, roomId, 'new_guess');
    await api.tick(users[0], roomId);
    assert.notEqual((await api.state(users[0], roomId)).current_word.id, wordId);
  });

  it('empate sorteia nova palavra', async () => {
    const { api, users, roomId, wordId } = await toDecision(['A', 'B']);
    await api.vote(users[0], roomId, 'new_word');
    await api.vote(users[1], roomId, 'new_guess');
    await api.tick(users[0], roomId);
    assert.notEqual((await api.state(users[0], roomId)).current_word.id, wordId);
  });

  it('ninguém escolhe: sorteia nova palavra', async () => {
    const { api, users, roomId, wordId } = await toDecision(['A', 'B', 'C']);
    await api.tick(users[0], roomId);
    const state = await api.state(users[0], roomId);
    assert.equal(state.room.status, 'playing');
    assert.notEqual(state.current_word.id, wordId);
  });

  it('é possível mudar o voto, mas não votar depois do prazo', async () => {
    const { api, users, roomId } = await toDecision(['A', 'B']);
    await api.vote(users[0], roomId, 'new_word');
    await api.vote(users[0], roomId, 'new_guess');
    const votes = (await api.state(users[0], roomId)).votes;
    assert.deepEqual([votes.new_guess, votes.new_word, votes.my_choice], [1, 0, 'new_guess']);
    await api.expire(roomId);
    await rejects(api.vote(users[1], roomId, 'new_word'), 'vote_closed');
  });
});

// -----------------------------------------------------------------------------
describe('finalizar jogo (pedido coletivo)', () => {
  it('maioria de 5 jogadores (3) encerra para todos', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['A', 'B', 'C', 'D', 'E']);
    await api.finish(users[1], roomId);
    let state = await api.state(users[4], roomId);
    assert.deepEqual([state.finish.count, state.finish.needed], [1, 3]);
    assert.deepEqual(state.finish.requested_by, ['B']);
    await api.finish(users[2], roomId);
    assert.equal((await api.state(users[4], roomId)).room.status, 'playing');
    const result = await api.finish(users[3], roomId);
    assert.equal(result.finished, true);
    state = await api.state(users[4], roomId); // quem não clicou também é encerrado
    assert.equal(state.room.status, 'finished');
    assert.equal(state.room.end_reason, 'majority_finish');
  });

  it('jogador ignorando o pedido não impede e cliques repetidos não contam duas vezes', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['A', 'B', 'C']);
    await api.finish(users[0], roomId);
    await api.finish(users[0], roomId);
    assert.equal((await api.state(users[2], roomId)).finish.count, 1);
    await api.finish(users[1], roomId);
    assert.equal((await api.state(users[2], roomId)).room.status, 'finished');
  });

  it('número par: 2 de 4 não é maioria, 3 de 4 é', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['A', 'B', 'C', 'D']);
    await api.finish(users[0], roomId);
    await api.finish(users[1], roomId);
    assert.equal((await api.state(users[0], roomId)).room.status, 'playing');
    await api.finish(users[2], roomId);
    assert.equal((await api.state(users[0], roomId)).room.status, 'finished');
  });

  it('host pedindo finalização conta como um pedido comum', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Host', 'B', 'C']);
    await api.finish(users[0], roomId);
    assert.equal((await api.state(users[0], roomId)).room.status, 'playing');
    await api.finish(users[1], roomId);
    assert.equal((await api.state(users[0], roomId)).room.status, 'finished');
  });

  it('a maioria considera apenas jogadores ativos', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['A', 'B', 'C', 'D']);
    await api.finish(users[0], roomId); // 1 de 4
    await api.leave(users[2], roomId);
    await api.leave(users[3], roomId); // agora 1 de 2: ainda não é maioria (> 50%)
    assert.equal((await api.state(users[0], roomId)).room.status, 'playing');
    await api.finish(users[1], roomId);
    assert.equal((await api.state(users[0], roomId)).room.status, 'finished');
  });
});

// -----------------------------------------------------------------------------
describe('host', () => {
  it('host sai → próximo na ordem de entrada; novo host sai → o seguinte', async () => {
    const { api, users, roomId, players } = await setupPlaying(pool, ['Ana', 'João', 'Maria', 'Pedro']);
    await api.leave(users[0], roomId);
    let state = await api.state(users[3], roomId);
    assert.equal(state.room.host_player_id, players[1]);
    await api.leave(users[1], roomId);
    state = await api.state(users[3], roomId);
    assert.equal(state.room.host_player_id, players[2]);
    assert.equal((await api.state(users[2], roomId)).me.is_host, true);
  });

  it('só o host expulsa; expulso não volta e não lê a sala', async () => {
    const { api, users, roomId, players, code } = await setupPlaying(pool, ['Ana', 'João', 'Maria']);
    await rejects(api.kick(users[1], roomId, players[2]), 'not_host');
    await rejects(api.kick(users[0], roomId, players[0]), 'cannot_kick_self');
    await api.kick(users[0], roomId, players[2]);
    const state = await api.state(users[0], roomId);
    assert.deepEqual(state.players.map((p) => p.name), ['Ana', 'João']);
    assert.equal((await api.state(users[2], roomId)).kicked, true);
    await rejects(api.joinRoom(users[2], code, 'Maria'), 'kicked');
    const visible = await selectAs(pool, users[2], 'select id from public.rooms where id = $1', [roomId]);
    assert.equal(visible.length, 0);
  });

  it('jogador entrando durante a partida recebe o estado atual e aparece na lista', async () => {
    const { api, users, roomId, code } = await setupPlaying(pool, ['Ana', 'João']);
    await api.guess(users[0], roomId, 'certo', 'correct', correct);
    const late = newUser();
    await api.joinRoom(late, code, 'Pedro');
    const state = await api.state(late, roomId);
    assert.equal(state.room.status, 'correct');
    assert.equal(state.players.length, 3);
    assert.equal(state.players[2].score, 0);
    assert.equal(state.me.is_host, false);
  });

  it('host responde NÃO ao aviso de última rodada / SIM adiciona rodadas', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João'], 2);
    let state = await api.state(users[0], roomId);
    assert.equal(state.room.final_round_prompt, false); // rodada 1 de 2 ainda não contou
    await api.guess(users[1], roomId, 'certo', 'correct', correct); // rodada 1 contabilizada
    state = await api.state(users[0], roomId);
    assert.equal(state.room.final_round_prompt, true); // a próxima rodada é a última → avisar o host
    await rejects(api.respondFinal(users[1], roomId, 0), 'not_host');
    await api.respondFinal(users[0], roomId, 0);
    state = await api.state(users[0], roomId);
    assert.equal(state.room.final_round_prompt, false);
    await api.respondFinal(users[0], roomId, 5);
    state = await api.state(users[0], roomId);
    assert.equal(state.room.configured_rounds, 7);
    await api.extend(users[0], roomId, 63);
    assert.equal((await api.state(users[0], roomId)).room.configured_rounds, 70);
  });

  it('host encerra a sala para todos', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
    await rejects(api.endGame(users[1], roomId), 'not_host');
    await api.endGame(users[0], roomId);
    assert.equal((await api.state(users[1], roomId)).room.end_reason, 'host_ended');
  });

  it('jogar novamente reinicia a mesma sala zerando pontos e palavras', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João'], 1);
    await api.guess(users[0], roomId, 'certo', 'correct', correct);
    await api.tick(users[0], roomId);
    assert.equal((await api.state(users[0], roomId)).room.status, 'finished');
    await rejects(api.restart(users[1], roomId), 'not_host');
    await api.restart(users[0], roomId, 5);
    const state = await api.state(users[1], roomId);
    assert.equal(state.room.status, 'waiting');
    assert.equal(state.room.configured_rounds, 5);
    assert.equal(state.room.rounds_played, 0);
    assert.ok(state.players.every((p) => p.score === 0));
    assert.equal(state.current_word, null);
  });
});

// -----------------------------------------------------------------------------
describe('conexão', () => {
  it('jogador desconecta (sem sinal) → inativo, mas mantém pontos; reconecta sem duplicar', async () => {
    const { api, users, roomId, code } = await setupPlaying(pool, ['Ana', 'João', 'Maria']);
    await api.guess(users[1], roomId, 'certo', 'correct', correct);
    await api.goSilent(roomId, users[1]);
    await api.heartbeat(users[0], roomId);
    let state = await api.state(users[0], roomId);
    const joao = state.players.find((p) => p.name === 'João');
    assert.equal(joao.is_active, false);
    assert.equal(joao.score, 1);

    await api.heartbeat(users[1], roomId); // voltou
    state = await api.state(users[0], roomId);
    assert.equal(state.players.find((p) => p.name === 'João').is_active, true);
    assert.equal(state.players.length, 3);
    await api.joinRoom(users[1], code, 'João');
    assert.equal((await api.state(users[0], roomId)).players.length, 3);
  });

  it('host desconecta → cargo transferido; ao voltar, não retoma o cargo', async () => {
    const { api, users, roomId, players } = await setupPlaying(pool, ['Ana', 'João', 'Maria']);
    await api.goSilent(roomId, users[0]);
    await api.heartbeat(users[2], roomId);
    assert.equal((await api.state(users[2], roomId)).room.host_player_id, players[1]);
    await api.heartbeat(users[0], roomId);
    const state = await api.state(users[0], roomId);
    assert.equal(state.me.is_active, true);
    assert.equal(state.room.host_player_id, players[1]);
  });

  it('vários jogadores desconectam ao mesmo tempo', async () => {
    const { api, users, roomId, players } = await setupPlaying(pool, ['A', 'B', 'C', 'D', 'E']);
    await api.finish(users[3], roomId); // 1 de 5
    for (const user of users.slice(0, 3)) await api.goSilent(roomId, user);
    await api.heartbeat(users[4], roomId);
    const state = await api.state(users[4], roomId);
    assert.equal(state.active_players, 2);
    assert.equal(state.room.host_player_id, players[3]);
    // 1 pedido de 2 ativos não é maioria (> 50%).
    assert.equal(state.room.status, 'playing');
  });

  it('se todos saem, a sala é encerrada', async () => {
    const { api, users, roomId } = await setupPlaying(pool, ['A', 'B']);
    await api.leave(users[0], roomId);
    await api.leave(users[1], roomId);
    const { rows } = await pool.query('select status, end_reason from public.rooms where id = $1', [roomId]);
    assert.deepEqual(rows[0], { status: 'finished', end_reason: 'abandoned' });
  });

  it('quem saiu e volta entra no fim da fila de host', async () => {
    const { api, users, roomId, code, players } = await setupRoom(pool, ['Ana', 'João', 'Maria']);
    await api.leave(users[0], roomId); // host → João
    await api.joinRoom(users[0], code, 'Ana');
    await api.leave(users[1], roomId); // host → Maria (Ana agora é a última da fila)
    assert.equal((await api.state(users[2], roomId)).room.host_player_id, players[2]);
  });
});

// -----------------------------------------------------------------------------
describe('segurança', () => {
  it('RLS: quem não está na sala não lê nada dela', async () => {
    const { roomId } = await setupPlaying(pool, ['Ana', 'João']);
    const stranger = newUser();
    for (const table of ['rooms', 'players', 'rounds', 'guesses', 'round_votes', 'finish_requests', 'used_words']) {
      const column = table === 'rooms' ? 'id' : 'room_id';
      const rows = await selectAs(pool, stranger, `select 1 from public.${table} where ${column} = $1`, [roomId]);
      assert.equal(rows.length, 0, table);
    }
    await rejects(gameApi(pool).state(stranger, roomId), 'not_in_room');
  });

  it('o banco de palavras não é legível pelo app', async () => {
    const rows = await selectAs(pool, newUser(), 'select word from public.words limit 1');
    assert.equal(rows.length, 0);
  });

  it('usuário anônimo sem sessão não chama RPCs', async () => {
    await assert.rejects(callAs(pool, 'anon', 'create_room', { p_player_name: 'X', p_rounds: 5 }), /permission denied/);
  });

  it('funções internas não são acessíveis ao app', async () => {
    const { roomId, users } = await setupPlaying(pool, ['Ana', 'João']);
    await assert.rejects(
      selectAs(pool, users[0], `select app_private.finish_room($1, 'host_ended')`, [roomId]),
      /permission denied/,
    );
  });
});

// -----------------------------------------------------------------------------
describe('banco de palavras esgotado', () => {
  it('encerra a partida quando não há mais palavras', async () => {
    const client = new pg.Client({ connectionString: (await pool.query('select 1')) && pool.options.connectionString });
    await client.connect();
    try {
      await client.query('update public.words set active = false where id > (select min(id) + 1 from public.words)');
      const { api, users, roomId } = await setupPlaying(pool, ['Ana', 'João']);
      await api.skip(users[0], roomId);
      await api.tick(users[0], roomId); // 2ª palavra
      await api.skip(users[0], roomId);
      await api.tick(users[0], roomId); // acabou
      const state = await api.state(users[0], roomId);
      assert.equal(state.room.status, 'finished');
      assert.equal(state.room.end_reason, 'words_exhausted');
    } finally {
      await client.query('update public.words set active = true');
      await client.end();
    }
  });
});
