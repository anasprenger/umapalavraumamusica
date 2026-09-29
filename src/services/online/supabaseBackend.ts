import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

import type { JoinResult, RoomStateResponse, SubmitGuessResult } from '@/types/online';

import { ensureSession } from '../supabase';
import { logTechnical, OnlineError } from './errors';
import type { HeartbeatResult, OnlineBackend, RealtimeStatus } from './types';

function toOnlineError(context: string, error: { code?: string; message?: string } | null | undefined): OnlineError {
  logTechnical(context, error);
  if (error?.code === 'P0001' && error.message) return new OnlineError(error.message, error);
  const message = error?.message ?? '';
  if (/fetch|network|timed? ?out|offline/i.test(message)) return new OnlineError('network', error);
  return new OnlineError('unknown', error);
}

/** Modo online com servidor próprio: regras em funções do Postgres, palpites pela Edge Function. */
export function createSupabaseBackend(db: SupabaseClient): OnlineBackend {
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
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

  return {
    kind: 'supabase',
    createRoom: (name, rounds) => rpc<JoinResult>('create_room', { p_player_name: name, p_rounds: rounds }),
    joinRoom: (code, name) => rpc<JoinResult>('join_room', { p_code: code, p_player_name: name }),
    getState: (roomId) => rpc<RoomStateResponse>('get_room_state', { p_room_id: roomId }),
    startGame: (roomId) => rpc<void>('start_game', { p_room_id: roomId }),
    updateSettings: (roomId, rounds) => rpc<void>('update_room_settings', { p_room_id: roomId, p_rounds: rounds }),
    vote: (roomId, choice) => rpc<void>('vote_decision', { p_room_id: roomId, p_choice: choice }),
    requestNewWord: (roomId) => rpc<void>('request_new_word', { p_room_id: roomId }),
    requestFinish: (roomId) => rpc<{ finished: boolean }>('request_finish', { p_room_id: roomId }),
    kickPlayer: (roomId, playerId) => rpc<void>('kick_player', { p_room_id: roomId, p_player_id: playerId }),
    endGame: (roomId) => rpc<void>('end_game', { p_room_id: roomId }),
    extendRounds: (roomId, extra) => rpc<void>('extend_rounds', { p_room_id: roomId, p_extra: extra }),
    respondFinalRound: (roomId, extra) => rpc<void>('respond_final_round', { p_room_id: roomId, p_extra: extra }),
    restart: (roomId, rounds) => rpc<void>('restart_room', { p_room_id: roomId, p_rounds: rounds ?? null }),
    leave: (roomId) => rpc<void>('leave_room', { p_room_id: roomId }),
    heartbeat: (roomId) => rpc<HeartbeatResult>('heartbeat', { p_room_id: roomId }),
    advance: (roomId) => rpc<{ state_version: number; status: string }>('advance_room', { p_room_id: roomId }),

    /** Palpites passam pela Edge Function, que valida a ordem e verifica a música no servidor. */
    async submitGuess(roomId, text) {
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

    /**
     * Assina as mudanças da sala. Toda alteração de estado no servidor incrementa
     * `rooms.state_version`, então basta ouvir a sala (e os jogadores) e recarregar.
     */
    subscribe(roomId, onChange, onStatus?: (status: RealtimeStatus) => void) {
      onStatus?.('connecting');
      const channel = db
        .channel(`room:${roomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, onChange)
        // O canal fica "SUBSCRIBED" um instante antes de o Postgres começar a enviar mudanças;
        // este aviso do servidor marca o momento em que as mudanças passam a chegar.
        .on('system', {}, (payload: { extension?: string; status?: string }) => {
          if (payload?.extension === 'postgres_changes' && payload?.status === 'ok') onStatus?.('live');
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onStatus?.('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus?.('offline');
        });

      return () => {
        void db.removeChannel(channel);
      };
    },
  };
}
