import type { JoinResult, RoomStateResponse, SubmitGuessResult, VoteChoice } from '@/types/online';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

export type HeartbeatResult = { kicked: boolean; state_version: number; status: string; server_time: string };

/**
 * Onde a partida online acontece. O app fala sempre com esta interface:
 * - `supabase`: servidor próprio (Postgres + Edge Function), para o app publicado nas lojas;
 * - `claude`: documento compartilhado do artefato no Claude, com as músicas verificadas pelo Claude.
 * O identificador da sala (`roomId`) é opaco para as telas.
 */
export interface OnlineBackend {
  readonly kind: 'supabase' | 'claude';
  createRoom(name: string, rounds: number): Promise<JoinResult>;
  joinRoom(code: string, name: string): Promise<JoinResult>;
  getState(roomId: string): Promise<RoomStateResponse>;
  startGame(roomId: string): Promise<void>;
  updateSettings(roomId: string, rounds: number): Promise<void>;
  vote(roomId: string, choice: VoteChoice): Promise<void>;
  requestNewWord(roomId: string): Promise<void>;
  requestFinish(roomId: string): Promise<{ finished: boolean }>;
  kickPlayer(roomId: string, playerId: string): Promise<void>;
  endGame(roomId: string): Promise<void>;
  extendRounds(roomId: string, extra: number): Promise<void>;
  respondFinalRound(roomId: string, extra: number): Promise<void>;
  restart(roomId: string, rounds?: number): Promise<void>;
  leave(roomId: string): Promise<void>;
  heartbeat(roomId: string): Promise<HeartbeatResult>;
  advance(roomId: string): Promise<{ state_version: number; status: string }>;
  submitGuess(roomId: string, text: string): Promise<SubmitGuessResult>;
  /** Avisa quando o estado da sala muda (o app então chama `getState`). */
  subscribe(roomId: string, onChange: () => void, onStatus?: (status: RealtimeStatus) => void): () => void;
}
