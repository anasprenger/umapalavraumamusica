/**
 * Utilitários dos testes de banco: cria um banco temporário, aplica o "stub" do
 * Supabase e as migrações, e permite chamar as RPCs como diferentes usuários.
 *
 * Requer um Postgres acessível (padrão: postgres://postgres@127.0.0.1:54329/postgres).
 * Configure com TEST_DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const serverUrl = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';

export async function createTestDatabase() {
  const name = `upum_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 12 });

  const files = [
    path.join(here, 'supabase-stub.sql'),
    ...readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => path.join(migrationsDir, file)),
  ];
  for (const file of files) {
    await pool.query(readFileSync(file, 'utf8'));
  }

  return {
    pool,
    async drop() {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: serverUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}

/** Erro de RPC com o código estável levantado por app_private.fail(). */
export class RpcError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function callSql(fn, args) {
  const keys = Object.keys(args);
  const params = keys.map((key, index) => `${key} => $${index + 1}`).join(', ');
  return { text: `select public.${fn}(${params}) as result`, values: keys.map((key) => args[key]) };
}

/**
 * Executa uma RPC dentro de uma transação, como um papel do Supabase.
 * `as` pode ser um user id (authenticated), 'service' (service_role) ou 'anon'.
 */
export async function callAs(clientOrPool, as, fn, args = {}) {
  const isPool = clientOrPool instanceof pg.Pool;
  const client = isPool ? await clientOrPool.connect() : clientOrPool;
  const release = isPool ? () => client.release() : () => undefined;
  try {
    await client.query('begin');
    if (as === 'service') {
      await client.query('set local role service_role');
      await client.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    } else if (as === 'anon') {
      await client.query('set local role anon');
      await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    } else {
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: as, role: 'authenticated' }),
      ]);
    }
    const { text, values } = callSql(fn, args);
    const { rows } = await client.query(text, values);
    await client.query('commit');
    return rows[0]?.result ?? null;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (error?.code === 'P0001') throw new RpcError(error.message);
    throw error;
  } finally {
    release();
  }
}

/** Consulta como usuário autenticado (para testar RLS). */
export async function selectAs(pool, userId, sql, values = []) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    const { rows } = await client.query(sql, values);
    await client.query('commit');
    return rows;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function newUser() {
  return randomUUID();
}

/** Cria uma "mesa" de jogo: api de alto nível sobre as RPCs. */
export function gameApi(pool) {
  const api = {
    createRoom: (user, name, rounds = 10) => callAs(pool, user, 'create_room', { p_player_name: name, p_rounds: rounds }),
    joinRoom: (user, code, name) => callAs(pool, user, 'join_room', { p_code: code, p_player_name: name }),
    state: (user, roomId) => callAs(pool, user, 'get_room_state', { p_room_id: roomId }),
    start: (user, roomId) => callAs(pool, user, 'start_game', { p_room_id: roomId }),
    advance: (user, roomId) => callAs(pool, user, 'advance_room', { p_room_id: roomId }),
    heartbeat: (user, roomId) => callAs(pool, user, 'heartbeat', { p_room_id: roomId }),
    vote: (user, roomId, choice) => callAs(pool, user, 'vote_decision', { p_room_id: roomId, p_choice: choice }),
    skip: (user, roomId) => callAs(pool, user, 'request_new_word', { p_room_id: roomId }),
    finish: (user, roomId) => callAs(pool, user, 'request_finish', { p_room_id: roomId }),
    kick: (user, roomId, playerId) => callAs(pool, user, 'kick_player', { p_room_id: roomId, p_player_id: playerId }),
    leave: (user, roomId) => callAs(pool, user, 'leave_room', { p_room_id: roomId }),
    endGame: (user, roomId) => callAs(pool, user, 'end_game', { p_room_id: roomId }),
    extend: (user, roomId, extra) => callAs(pool, user, 'extend_rounds', { p_room_id: roomId, p_extra: extra }),
    respondFinal: (user, roomId, extra) => callAs(pool, user, 'respond_final_round', { p_room_id: roomId, p_extra: extra }),
    restart: (user, roomId, rounds = null) => callAs(pool, user, 'restart_room', { p_room_id: roomId, p_rounds: rounds }),
    // Chamadas do servidor (Edge Function com service_role)
    submitGuess: (user, roomId, text, client = pool) =>
      callAs(client, 'service', 'submit_guess', { p_user_id: user, p_room_id: roomId, p_text: text }),
    resolve: (guessId, outcome, details = {}) =>
      callAs(pool, 'service', 'resolve_guess', { p_guess_id: guessId, p_outcome: outcome, p_details: JSON.stringify(details) }),

    /** Faz o prazo da fase atual vencer (simula a passagem do tempo). */
    async expire(roomId) {
      await pool.query(`update public.rooms set phase_ends_at = now() - interval '1 second' where id = $1 and phase_ends_at is not null`, [roomId]);
    },
    /** Simula um jogador sem sinal há mais de 30 segundos. */
    async goSilent(roomId, userId) {
      await pool.query(`update public.players set last_seen_at = now() - interval '5 minutes' where room_id = $1 and user_id = $2`, [roomId, userId]);
    },
    /** Avança o tempo e processa a fase (como faria um aparelho). */
    async tick(user, roomId) {
      await api.expire(roomId);
      return api.advance(user, roomId);
    },
    /** Envia um palpite e aplica um resultado. */
    async guess(user, roomId, text, outcome, details = {}) {
      const submitted = await api.submitGuess(user, roomId, text);
      if (!submitted.accepted) return submitted;
      await api.resolve(submitted.guess_id, outcome, details);
      return submitted;
    },
  };
  return api;
}

/** Monta uma sala com N jogadores; retorna ids e a api. */
export async function setupRoom(pool, names = ['Ana', 'João', 'Maria'], rounds = 10) {
  const api = gameApi(pool);
  const users = names.map(() => newUser());
  const created = await api.createRoom(users[0], names[0], rounds);
  const players = [created.player_id];
  for (let i = 1; i < names.length; i += 1) {
    const joined = await api.joinRoom(users[i], created.code, names[i]);
    players.push(joined.player_id);
  }
  return { api, users, players, roomId: created.room_id, code: created.code };
}

/** Sala já em jogo, com a primeira palavra na tela. */
export async function setupPlaying(pool, names, rounds = 10) {
  const room = await setupRoom(pool, names, rounds);
  await room.api.start(room.users[0], room.roomId);
  await room.api.tick(room.users[0], room.roomId);
  return room;
}
