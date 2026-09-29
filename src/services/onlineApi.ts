import { Platform } from 'react-native';

import type { VoteChoice } from '@/types/online';

import { createArtifactBackend } from './online/artifactBackend';
import { loadArtifactRuntime } from './online/artifactRuntime';
import { OnlineError } from './online/errors';
import { createSupabaseBackend } from './online/supabaseBackend';
import type { AiAccess, OnlineBackend, RealtimeStatus } from './online/types';
import { supabase } from './supabase';

export { friendlyMessage, OnlineError } from './online/errors';
export type { AiAccess, RealtimeStatus } from './online/types';

export type OnlineAvailability =
  | { status: 'available'; kind: OnlineBackend['kind'] }
  | { status: 'unavailable'; reason: string; message: string };

type Resolved = { backend: OnlineBackend } | { backend: null; reason: string };

let resolving: Promise<Resolved> | null = null;

/**
 * Escolhe onde a partida online acontece:
 * 1. aberto como artefato no Claude → sala no documento compartilhado do Claude;
 * 2. app com Supabase configurado → servidor próprio;
 * 3. nenhum dos dois → modo online indisponível (o modo local continua funcionando).
 */
async function resolveBackend(): Promise<Resolved> {
  if (Platform.OS === 'web') {
    const probe = await loadArtifactRuntime();
    if (probe) {
      if ('runtime' in probe) return { backend: createArtifactBackend(probe.runtime) };
      return { backend: null, reason: probe.unavailable };
    }
  }
  if (supabase) return { backend: createSupabaseBackend(supabase) };
  return { backend: null, reason: 'online_not_configured' };
}

function backend(): Promise<Resolved> {
  resolving ??= resolveBackend();
  return resolving;
}

export async function onlineAvailability(): Promise<OnlineAvailability> {
  const resolved = await backend();
  if (resolved.backend) return { status: 'available', kind: resolved.backend.kind };
  return { status: 'unavailable', reason: resolved.reason, message: new OnlineError(resolved.reason).message };
}

async function withBackend<T>(action: (online: OnlineBackend) => Promise<T>): Promise<T> {
  const resolved = await backend();
  if (!resolved.backend) throw new OnlineError(resolved.reason);
  return action(resolved.backend);
}

export const onlineApi = {
  createRoom: (name: string, rounds: number) => withBackend((b) => b.createRoom(name, rounds)),
  joinRoom: (code: string, name: string) => withBackend((b) => b.joinRoom(code, name)),
  getState: (roomId: string) => withBackend((b) => b.getState(roomId)),
  startGame: (roomId: string) => withBackend((b) => b.startGame(roomId)),
  updateSettings: (roomId: string, rounds: number) => withBackend((b) => b.updateSettings(roomId, rounds)),
  vote: (roomId: string, choice: VoteChoice) => withBackend((b) => b.vote(roomId, choice)),
  requestNewWord: (roomId: string) => withBackend((b) => b.requestNewWord(roomId)),
  requestFinish: (roomId: string) => withBackend((b) => b.requestFinish(roomId)),
  kickPlayer: (roomId: string, playerId: string) => withBackend((b) => b.kickPlayer(roomId, playerId)),
  endGame: (roomId: string) => withBackend((b) => b.endGame(roomId)),
  extendRounds: (roomId: string, extra: number) => withBackend((b) => b.extendRounds(roomId, extra)),
  respondFinalRound: (roomId: string, extra: number) => withBackend((b) => b.respondFinalRound(roomId, extra)),
  restart: (roomId: string, rounds?: number) => withBackend((b) => b.restart(roomId, rounds)),
  leave: (roomId: string) => withBackend((b) => b.leave(roomId)),
  heartbeat: (roomId: string) => withBackend((b) => b.heartbeat(roomId)),
  advance: (roomId: string) => withBackend((b) => b.advance(roomId)),
  submitGuess: (roomId: string, text: string) => withBackend((b) => b.submitGuess(roomId, text)),
  /** Permissão da verificação pelo Claude (`granted` quando o servidor verifica sozinho). */
  aiAccess: () => withBackend<AiAccess>((b) => b.aiAccess?.() ?? Promise.resolve('granted')),
  requestAiAccess: () => withBackend<AiAccess>((b) => b.requestAiAccess?.() ?? Promise.resolve('granted')),
};

/** Avisa quando o estado da sala muda; o app então recarrega o estado oficial. */
export function subscribeToRoom(
  roomId: string,
  onChange: () => void,
  onStatus?: (status: RealtimeStatus) => void,
): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  onStatus?.('connecting');
  void backend().then((resolved) => {
    if (cancelled || !resolved.backend) return;
    unsubscribe = resolved.backend.subscribe(roomId, onChange, onStatus);
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
