import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { friendlyMessage, onlineApi, OnlineError, subscribeToRoom } from '@/services/onlineApi';
import { storage } from '@/services/storage';
import type { RoomSnapshot, VoteChoice } from '@/types/online';

/** Intervalo do sinal de vida. O servidor considera desconectado após 30 s sem sinal. */
const HEARTBEAT_MS = 5000;

export type RoomPhase = 'needs_name' | 'connecting' | 'ready' | 'error' | 'kicked';
export type ConnectionState = 'online' | 'reconnecting';

/**
 * Estado da sala online sincronizado com o servidor:
 * - entra (ou reconecta) na sala pelo código, sem duplicar o jogador;
 * - recarrega o estado a cada mudança recebida pelo Realtime;
 * - envia sinal de vida e se recupera sozinho após quedas de conexão;
 * - avisa o servidor quando um prazo (3 s etc.) vence — quem decide é o servidor.
 */
export function useOnlineRoom(code: string) {
  const [phase, setPhase] = useState<RoomPhase>('connecting');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('online');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const versionRef = useRef(-1);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const pendingRef = useRef(false);

  // 1. Entrar na sala (também serve para reconectar).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase('connecting');
      setError(null);
      const name = await storage.loadProfileName();
      if (cancelled) return;
      if (!name) {
        setPhase('needs_name');
        return;
      }
      try {
        const joined = await onlineApi.joinRoom(code, name);
        if (cancelled) return;
        versionRef.current = -1;
        setRoomId(joined.room_id);
        void storage.saveLastRoom(joined.code);
      } catch (caught) {
        if (cancelled) return;
        const errorCode = caught instanceof OnlineError ? caught.code : 'unknown';
        if (['room_not_found', 'room_finished', 'kicked'].includes(errorCode)) void storage.saveLastRoom(null);
        if (errorCode === 'kicked') {
          setPhase('kicked');
          return;
        }
        setError(friendlyMessage(caught));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, attempt]);

  // 2. Recarregar o estado oficial (sem sobrepor uma versão mais nova com uma antiga).
  const refresh = useCallback(async () => {
    if (!roomId) return;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return inFlightRef.current;
    }
    const run = (async () => {
      do {
        pendingRef.current = false;
        const sentAt = Date.now();
        const state = await onlineApi.getState(roomId);
        const receivedAt = Date.now();
        const offset = Date.parse(state.server_time) - (sentAt + receivedAt) / 2;
        setOffsetMs((current) => (Math.abs(current - offset) > 60 ? offset : current));

        if (state.kicked) {
          setPhase('kicked');
          void storage.saveLastRoom(null);
          return;
        }
        if (state.room.state_version >= versionRef.current) {
          versionRef.current = state.room.state_version;
          setSnapshot(state);
          setPhase('ready');
        }
      } while (pendingRef.current);
    })();
    inFlightRef.current = run;
    try {
      await run;
      setConnection('online');
    } catch {
      setConnection('reconnecting');
    } finally {
      inFlightRef.current = null;
    }
  }, [roomId]);

  // 3. Realtime + sinal de vida + volta do segundo plano.
  useEffect(() => {
    if (!roomId) return;
    // O primeiro estado chega pelo sinal de vida abaixo (versão local -1 ≠ versão do servidor).
    const unsubscribe = subscribeToRoom(
      roomId,
      () => void refresh(),
      (status) => {
        // Ao (re)conectar o canal, busca o estado para não perder nada.
        if (status === 'live') void refresh();
      },
    );

    const beat = async () => {
      try {
        const result = await onlineApi.heartbeat(roomId);
        setConnection('online');
        if (result.kicked) {
          setPhase('kicked');
          void storage.saveLastRoom(null);
          return;
        }
        if (result.state_version !== versionRef.current) void refresh();
      } catch (caught) {
        if (caught instanceof OnlineError && caught.code === 'kicked') setPhase('kicked');
        else setConnection('reconnecting');
      }
    };
    void beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void beat();
    });

    return () => {
      unsubscribe();
      clearInterval(interval);
      appState.remove();
    };
  }, [roomId, refresh]);

  // 4. Prazos: quando a fase vence, pede ao servidor para avançar (idempotente).
  const deadline = snapshot?.room.phase_ends_at ? Date.parse(snapshot.room.phase_ends_at) : null;
  const status = snapshot?.room.status;
  useEffect(() => {
    if (!roomId || deadline === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = async () => {
      if (cancelled) return;
      try {
        await onlineApi.advance(roomId);
      } catch {
        // Sem conexão: tenta de novo logo abaixo.
      }
      await refresh();
      if (!cancelled) timer = setTimeout(fire, 1000);
    };
    const localDeadline = deadline - offsetMs;
    // Pequena folga aleatória para os aparelhos não chamarem todos no mesmo milissegundo.
    timer = setTimeout(fire, Math.max(0, localDeadline - Date.now()) + 120 + Math.random() * 250);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId, deadline, status, offsetMs, refresh]);

  const run = useCallback(
    async <T>(action: (id: string) => Promise<T>): Promise<T> => {
      if (!roomId) throw new OnlineError('not_in_room');
      try {
        return await action(roomId);
      } finally {
        void refresh();
      }
    },
    [roomId, refresh],
  );

  return {
    phase,
    error,
    snapshot,
    connection,
    roomId,
    /** Prazo da fase atual no relógio do aparelho (já corrigido pela diferença para o servidor). */
    deadlineLocal: deadline !== null ? deadline - offsetMs : null,
    retry: () => setAttempt((value) => value + 1),
    saveName: async (name: string) => {
      await storage.saveProfileName(name);
      setAttempt((value) => value + 1);
    },
    actions: {
      start: () => run((id) => onlineApi.startGame(id)),
      submitGuess: (text: string) => run((id) => onlineApi.submitGuess(id, text)),
      vote: (choice: VoteChoice) => run((id) => onlineApi.vote(id, choice)),
      requestNewWord: () => run((id) => onlineApi.requestNewWord(id)),
      requestFinish: () => run((id) => onlineApi.requestFinish(id)),
      kick: (playerId: string) => run((id) => onlineApi.kickPlayer(id, playerId)),
      endGame: () => run((id) => onlineApi.endGame(id)),
      extendRounds: (extra: number) => run((id) => onlineApi.extendRounds(id, extra)),
      respondFinalRound: (extra: number) => run((id) => onlineApi.respondFinalRound(id, extra)),
      restart: (rounds?: number) => run((id) => onlineApi.restart(id, rounds)),
      updateRounds: (rounds: number) => run((id) => onlineApi.updateSettings(id, rounds)),
      leave: async () => {
        if (roomId) await onlineApi.leave(roomId).catch(() => undefined);
        await storage.saveLastRoom(null);
      },
    },
  };
}

export type OnlineRoomApi = ReturnType<typeof useOnlineRoom>;
