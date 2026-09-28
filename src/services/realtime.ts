import { supabase } from './supabase';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/**
 * Assina as mudanças da sala. Toda alteração de estado no servidor incrementa
 * `rooms.state_version`, então basta ouvir a sala (e os jogadores) e recarregar.
 */
export function subscribeToRoom(
  roomId: string,
  onChange: () => void,
  onStatus?: (status: RealtimeStatus) => void,
): () => void {
  if (!supabase) return () => undefined;
  const db = supabase;
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
}
