import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import type { JoinResult, RoomStateResponse, SubmitGuessResult, VoteChoice } from '@/types/online';

import { ensureSession, supabase } from './supabase';

/** Mensagens amigáveis para os códigos de erro do servidor. Nada técnico chega ao jogador. */
const FRIENDLY: Record<string, string> = {
  online_not_configured: 'O modo online ainda não foi configurado neste app.',
  auth_failed: 'Não foi possível conectar. Verifique a internet e tente de novo.',
  network: 'Sem conexão no momento. Tentando reconectar…',
  room_not_found: 'Sala não encontrada. Confira o código.',
  room_full: 'A sala está cheia (máximo de 10 jogadores).',
  room_finished: 'Esta partida já terminou.',
  kicked: 'Você foi removido desta sala pelo host.',
  not_in_room: 'Você não está nesta sala.',
  not_active: 'Você não está ativo nesta sala. Entre novamente.',
  not_host: 'Apenas o host pode fazer isso.',
  not_enough_players: 'São necessários pelo menos 2 jogadores para começar.',
  already_started: 'A partida já começou.',
  invalid_name: 'Digite seu nome.',
  invalid_rounds: 'Escolha uma quantidade de rodadas válida.',
  invalid_guess: 'Digite um palpite de até 200 caracteres.',
  vote_closed: 'A votação já terminou.',
  not_playing: 'Aguarde a próxima palavra.',
  not_in_game: 'A partida não está em andamento.',
  not_finished: 'A partida ainda não terminou.',
  cannot_kick_self: 'Você não pode remover a si mesmo.',
  player_not_found: 'Jogador não encontrado.',
  not_authenticated: 'Sua sessão expirou. Abra a sala novamente.',
};

export class OnlineError extends Error {
  constructor(
    readonly code: string,
    readonly technical?: unknown,
  ) {
    super(FRIENDLY[code] ?? 'Algo deu errado. Tente novamente.');
    this.name = 'OnlineError';
  }
}

export function friendlyMessage(error: unknown): string {
  return error instanceof OnlineError ? error.message : 'Algo deu errado. Tente novamente.';
}

function logTechnical(context: string, error: unknown) {
  if (__DEV__) console.warn(`[online] ${context}`, error);
}

function client() {
  if (!supabase) throw new OnlineError('online_not_configured');
  return supabase;
}

function toOnlineError(context: string, error: { code?: string; message?: string } | null | undefined): OnlineError {
  logTechnical(context, error);
  if (error?.code === 'P0001' && error.message) return new OnlineError(error.message, error);
  const message = error?.message ?? '';
  if (/fetch|network|timed? ?out|offline/i.test(message)) return new OnlineError('network', error);
  return new OnlineError('unknown', error);
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const db = client();
  try {
    await ensureSession();
  } catch (error) {
    logTechnical('ensureSession', error);
    throw new OnlineError(error instanceof Error && error.message === 'online_not_configured' ? error.message : 'auth_failed');
  }
  const { data, error } = await db.rpc(fn, args);
  if (error) throw toOnlineError(fn, error);
  return data as T;
}

export const onlineApi = {
  createRoom: (name: string, rounds: number) =>
    rpc<JoinResult>('create_room', { p_player_name: name, p_rounds: rounds }),
  joinRoom: (code: string, name: string) => rpc<JoinResult>('join_room', { p_code: code, p_player_name: name }),
  getState: (roomId: string) => rpc<RoomStateResponse>('get_room_state', { p_room_id: roomId }),
  startGame: (roomId: string) => rpc<void>('start_game', { p_room_id: roomId }),
  updateSettings: (roomId: string, rounds: number) =>
    rpc<void>('update_room_settings', { p_room_id: roomId, p_rounds: rounds }),
  vote: (roomId: string, choice: VoteChoice) => rpc<void>('vote_decision', { p_room_id: roomId, p_choice: choice }),
  requestNewWord: (roomId: string) => rpc<void>('request_new_word', { p_room_id: roomId }),
  requestFinish: (roomId: string) => rpc<{ finished: boolean }>('request_finish', { p_room_id: roomId }),
  kickPlayer: (roomId: string, playerId: string) =>
    rpc<void>('kick_player', { p_room_id: roomId, p_player_id: playerId }),
  endGame: (roomId: string) => rpc<void>('end_game', { p_room_id: roomId }),
  extendRounds: (roomId: string, extra: number) => rpc<void>('extend_rounds', { p_room_id: roomId, p_extra: extra }),
  respondFinalRound: (roomId: string, extra: number) =>
    rpc<void>('respond_final_round', { p_room_id: roomId, p_extra: extra }),
  restart: (roomId: string, rounds?: number) =>
    rpc<void>('restart_room', { p_room_id: roomId, p_rounds: rounds ?? null }),
  leave: (roomId: string) => rpc<void>('leave_room', { p_room_id: roomId }),
  heartbeat: (roomId: string) =>
    rpc<{ kicked: boolean; state_version: number; status: string; server_time: string }>('heartbeat', {
      p_room_id: roomId,
    }),
  advance: (roomId: string) => rpc<{ state_version: number; status: string }>('advance_room', { p_room_id: roomId }),

  /** Palpites passam pela Edge Function, que valida a ordem e verifica a música no servidor. */
  async submitGuess(roomId: string, text: string): Promise<SubmitGuessResult> {
    const db = client();
    await ensureSession().catch((error) => {
      logTechnical('ensureSession', error);
      throw new OnlineError('auth_failed');
    });
    const { data, error } = await db.functions.invoke<SubmitGuessResult>('submit-guess', { body: { roomId, text } });
    if (!error && data) return data;

    if (error instanceof FunctionsHttpError) {
      let code = 'unknown';
      try {
        const payload = (await (error.context as Response).json()) as { error?: string };
        code = payload.error ?? code;
      } catch {
        // resposta sem JSON
      }
      logTechnical('submit-guess', error);
      throw new OnlineError(code, error);
    }
    if (error instanceof FunctionsFetchError) throw new OnlineError('network', error);
    throw toOnlineError('submit-guess', error as { message?: string });
  },
};
