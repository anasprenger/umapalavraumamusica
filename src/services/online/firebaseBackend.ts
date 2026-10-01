/**
 * Modo online com o Firebase (plano gratuito): a sala é um documento do Firestore.
 *
 * - As regras são as mesmas de `src/game/online/rules.ts`. Toda alteração roda numa
 *   TRANSAÇÃO do Firestore (lê, aplica a regra, grava; se alguém gravou antes, repete):
 *   dois palpites simultâneos viram fila e só o primeiro é aceito.
 * - Os prazos usam o relógio do servidor, estimado pelos horários gravados pelo Firestore.
 * - Cada jogador grava o próprio voto e o próprio sinal de presença (subcoleções da sala).
 * - O jogador ativo mais antigo que está presente (normalmente o host) é o juiz: avança
 *   prazos e marca quem sumiu; se ele cair, os outros assumem depois de alguns segundos.
 * - A música é verificada pelo Gemini com busca no Google (`geminiJudge.ts`), no aparelho de
 *   quem palpitou.
 */
import {
  collection,
  doc,
  type DocumentReference,
  type Firestore,
  FirestoreError,
  getDoc,
  getDocFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  type Transaction,
} from 'firebase/firestore';

import { WORD_BANK } from '@/data/words';
import {
  advancePhases,
  buildSnapshot,
  checkVote,
  createRoom,
  endGame,
  extendRounds,
  type GuessDetails,
  type GuessDoc,
  type GuessOutcome,
  isRoomDoc,
  isVoteDoc,
  joinRoom,
  kickPlayer,
  leaveRoom,
  normalizeCode,
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
  updateSettings,
  type VoteDoc,
} from '@/game/online/rules';
import type { VoteChoice } from '@/types/online';

import { ensureFirebaseUser, getFirebase } from '../firebase';
import { logTechnical, OnlineError } from './errors';
import { askGemini } from './geminiClient';
import { buildGeminiPrompt, geminiFailureReason, interpretGemini } from './geminiJudge';
import type { OnlineBackend, RealtimeStatus } from './types';

/** Intervalo mínimo entre dois sinais de presença gravados (o app chama o sinal de vida a cada 5 s). */
const PRESENCE_EVERY_MS = 10_000;
/**
 * Sem presença por este tempo = desconectado. Maior que no servidor próprio porque abas do
 * navegador em segundo plano podem atrasar os sinais (até ~1 min).
 */
const GONE_AFTER_MS = 75_000;
/** Palpite de quem sumiu deixa de travar a partida depois disso. */
const GUESSER_GONE_MS = 45_000;
/** Os demais aparelhos só avançam um prazo se o juiz não o fizer neste intervalo. */
const REFEREE_GRACE_MS = 1500;
/** Folga para os últimos votos chegarem antes de apurar a votação. */
const VOTE_SETTLE_MS = 400;
/** Tempo mínimo de "Verificando…" (respostas rápidas também mostram a animação). */
const MIN_VERIFY_MS = 1500;
/** Aguarda os primeiros sinais de presença antes de considerar alguém desconectado. */
const PRESENCE_WARMUP_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const iso = (ms: number) => new Date(ms).toISOString();

function randomId(): string {
  const crypto = globalThis.crypto as Crypto | undefined;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Relógio do servidor: cada sinal de presença gravado volta com o horário do servidor.
 * Como o horário foi marcado entre o envio e a confirmação, cada amostra limita a diferença
 * entre os relógios; o meio do intervalo acumulado é a estimativa.
 */
class ServerClock {
  private lo = -Infinity;
  private hi = Infinity;
  offset = 0;
  samples = 0;

  add(serverMs: number, sentAt: number, receivedAt: number) {
    let lo = Math.max(this.lo, serverMs - receivedAt);
    let hi = Math.min(this.hi, serverMs - sentAt);
    if (lo > hi) {
      lo = serverMs - receivedAt;
      hi = serverMs - sentAt;
    }
    this.lo = lo;
    this.hi = hi;
    this.offset = (lo + hi) / 2;
    this.samples += 1;
  }

  now() {
    return Date.now() + this.offset;
  }
}

/** A sala guarda também a lista de membros, usada pelas regras de segurança do Firestore. */
function stored(room: RoomDoc): Record<string, unknown> {
  const members = room.players.filter((player) => player.leftReason !== 'kicked').map((player) => player.id);
  return { ...room, members };
}

function toOnlineError(error: unknown): OnlineError {
  if (error instanceof OnlineError) return error;
  if (error instanceof RuleError) return new OnlineError(error.code, error);
  const code = error instanceof FirestoreError ? error.code : (error as { code?: string } | null)?.code;
  logTechnical(`firestore ${code ?? ''}`, error);
  switch (code) {
    case 'permission-denied':
      return new OnlineError('not_in_room', error);
    case 'resource-exhausted':
      return new OnlineError('quota_exceeded', error);
    case 'aborted':
    case 'failed-precondition':
      return new OnlineError('try_again', error);
    case 'unauthenticated':
      return new OnlineError('auth_failed', error);
    default:
      return new OnlineError('network', error);
  }
}

function readVote(data: unknown, id: string): VoteDoc | null {
  return isVoteDoc(data) && data.playerId === id ? data : null;
}

type Listener = { onChange: () => void; onStatus?: (status: RealtimeStatus) => void };

/** Sala aberta neste aparelho: documento ao vivo, votos e presença. */
class RoomSession {
  doc: RoomDoc | null = null;
  votes: VoteDoc[] = [];
  private presence = new Map<string, number>();
  private listeners = new Set<Listener>();
  private stops: (() => void)[] = [];
  private startedAt = 0;
  private live = false;
  private closed = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly db: Firestore,
    readonly code: string,
    private readonly userId: string,
    private readonly clock: ServerClock,
    private readonly onClose: () => void,
  ) {}

  addListener(listener: Listener): () => void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.start();
    this.listeners.add(listener);
    listener.onStatus?.(this.live ? 'live' : 'connecting');
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && !this.closed) this.closeTimer = setTimeout(() => this.close(), 3000);
    };
  }

  applyDoc(room: RoomDoc) {
    if (this.doc && room.stateVersion < this.doc.stateVersion) return;
    this.doc = room;
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener.onChange();
  }

  private setStatus(status: RealtimeStatus) {
    this.live = status === 'live';
    for (const listener of this.listeners) listener.onStatus?.(status);
  }

  private start() {
    if (this.startedAt) return;
    this.startedAt = Date.now();
    const room = doc(this.db, 'rooms', this.code);
    const failed = (error: FirestoreError) => {
      logTechnical('onSnapshot', error);
      this.setStatus('offline');
    };
    this.stops.push(
      onSnapshot(
        room,
        (snap) => {
          const data = snap.data();
          if (isRoomDoc(data)) this.applyDoc(data);
          if (!this.live) this.setStatus('live');
        },
        failed,
      ),
      onSnapshot(
        collection(room, 'votes'),
        (snap) => {
          this.votes = snap.docs.map((item) => readVote(item.data(), item.id)).filter((vote): vote is VoteDoc => !!vote);
          this.emit();
        },
        failed,
      ),
      onSnapshot(
        collection(room, 'presence'),
        (snap) => {
          for (const item of snap.docs) {
            const seen = item.data({ serverTimestamps: 'estimate' }).lastSeen;
            if (seen instanceof Timestamp) this.presence.set(item.id, seen.toMillis());
          }
        },
        failed,
      ),
    );
  }

  private presenceReady() {
    return this.live && Date.now() - this.startedAt >= PRESENCE_WARMUP_MS && this.clock.samples > 0;
  }

  /** Sem dados de presença confiáveis, todos contam como presentes (ninguém é removido por engano). */
  isPresent(id: string, withinMs: number): boolean {
    if (id === this.userId || !this.presenceReady()) return true;
    const joinedAt = this.doc?.players.find((player) => player.id === id)?.joinedAt ?? 0;
    const since = Math.max(this.presence.get(id) ?? 0, joinedAt, this.startedAt + this.clock.offset);
    return this.clock.now() - since < withinMs;
  }

  goneIds(room: RoomDoc): string[] {
    if (!this.presenceReady()) return [];
    return room.players
      .filter((player) => player.isActive && player.tracked !== false && !this.isPresent(player.id, GONE_AFTER_MS))
      .map((player) => player.id);
  }

  guesserGone(room: RoomDoc): boolean {
    const guesser = room.status === 'verifying' ? room.activeGuess?.playerId : undefined;
    return Boolean(guesser && this.presenceReady() && !this.isPresent(guesser, GUESSER_GONE_MS));
  }

  /** O juiz é o jogador ativo mais antigo que está presente (normalmente o host). */
  isReferee(room: RoomDoc): boolean {
    const active = room.players.filter((player) => player.isActive).sort((a, b) => a.joinOrder - b.joinOrder);
    for (const player of active) {
      if (player.id === this.userId) return true;
      if (this.isPresent(player.id, 25_000)) return false;
    }
    return false;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.stops) stop();
    this.stops = [];
    this.listeners.clear();
    this.onClose();
  }
}

type Change<T> = { doc: RoomDoc; changed: boolean; value: T };

export function createFirebaseBackend(): OnlineBackend {
  const clock = new ServerClock();
  const sessions = new Map<string, RoomSession>();
  const verifying = new Set<string>();
  const lastPresence = new Map<string, number>();

  const db = () => getFirebase().db;
  const roomRef = (code: string) => doc(db(), 'rooms', code);

  async function user(): Promise<string> {
    try {
      return await ensureFirebaseUser();
    } catch (error) {
      logTechnical('auth', error);
      throw new OnlineError('auth_failed', error);
    }
  }

  async function session(code: string): Promise<RoomSession> {
    const userId = await user();
    let current = sessions.get(code);
    if (!current) {
      current = new RoomSession(db(), code, userId, clock, () => sessions.delete(code));
      sessions.set(code, current);
    }
    return current;
  }

  async function currentDoc(code: string): Promise<RoomDoc> {
    const cached = sessions.get(code)?.doc;
    if (cached) return cached;
    try {
      const snap = await getDoc(roomRef(code));
      const data = snap.data();
      if (!isRoomDoc(data)) throw new OnlineError('room_not_found');
      sessions.get(code)?.applyDoc(data);
      return data;
    } catch (error) {
      throw toOnlineError(error);
    }
  }

  async function readVotesIn(tx: Transaction, code: string, room: RoomDoc): Promise<VoteDoc[]> {
    const votes: VoteDoc[] = [];
    for (const player of room.players) {
      const snap = await tx.get(doc(db(), 'rooms', code, 'votes', player.id));
      const vote = readVote(snap.data(), player.id);
      if (vote) votes.push(vote);
    }
    return votes;
  }

  /** Lê a sala numa transação, aplica a regra e grava o resultado (se algo mudou). */
  async function mutate<T>(
    code: string,
    change: (room: RoomDoc, now: number, votes: VoteDoc[], userId: string) => Change<T>,
    options: { withVotes?: boolean } = {},
  ): Promise<T> {
    const userId = await user();
    const saved: { room: RoomDoc | null } = { room: null };
    try {
      const value = await runTransaction(db(), async (tx) => {
        const snap = await tx.get(roomRef(code));
        const data = snap.data();
        if (!isRoomDoc(data)) throw new OnlineError('room_not_found');
        const votes = options.withVotes ? await readVotesIn(tx, code, data) : [];
        const result = change(data, clock.now(), votes, userId);
        saved.room = result.changed ? result.doc : null;
        if (result.changed) tx.set(roomRef(code), stored(result.doc));
        return result.value;
      });
      if (saved.room) sessions.get(code)?.applyDoc(saved.room);
      return value;
    } catch (error) {
      throw toOnlineError(error);
    }
  }

  const apply =
    (rule: (room: RoomDoc, userId: string, now: number) => RoomDoc) =>
    (room: RoomDoc, now: number, _votes: VoteDoc[], userId: string): Change<void> => ({
      doc: rule(room, userId, now),
      changed: true,
      value: undefined,
    });

  async function writeVote(code: string, userId: string, key: string, choice: VoteChoice) {
    const vote: VoteDoc = { playerId: userId, key, choice, at: clock.now() };
    try {
      await setDoc(doc(db(), 'rooms', code, 'votes', userId), vote);
    } catch (error) {
      throw toOnlineError(error);
    }
  }

  /** Grava o sinal de presença (no máximo a cada 10 s) e usa o horário do servidor para acertar o relógio. */
  async function beatPresence(code: string, userId: string) {
    const last = lastPresence.get(code) ?? 0;
    if (Date.now() - last < PRESENCE_EVERY_MS) return;
    lastPresence.set(code, Date.now());
    const ref: DocumentReference = doc(db(), 'rooms', code, 'presence', userId);
    const sentAt = Date.now();
    await setDoc(ref, { lastSeen: serverTimestamp() });
    const receivedAt = Date.now();
    // Nas primeiras vezes (e depois a cada ~minuto) lê o horário gravado para acertar o relógio.
    if (clock.samples < 3 || Math.random() < 0.15) {
      const snap = await getDocFromServer(ref);
      const seen = snap.data()?.lastSeen;
      if (seen instanceof Timestamp) clock.add(seen.toMillis(), sentAt, receivedAt);
    }
  }

  /** Pergunta ao Gemini (com busca no Google) de qual música é o palpite e aplica o resultado na sala. */
  async function verifyGuess(code: string, guess: GuessDoc, word: string) {
    if (verifying.has(guess.id)) return;
    verifying.add(guess.id);
    const startedAt = Date.now();
    let outcome: GuessOutcome;
    let details: GuessDetails;
    try {
      const answer = await askGemini(buildGeminiPrompt(word, guess.text));
      ({ outcome, details } = interpretGemini(answer.text, word, guess.text, answer.grounding));
    } catch (error) {
      logTechnical('gemini', error);
      outcome = 'error';
      details = { reason: geminiFailureReason(error) };
    }
    const wait = MIN_VERIFY_MS - (Date.now() - startedAt);
    if (wait > 0) await sleep(wait);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await mutate(code, (room, now) => {
          const result = resolveGuess(room, guess.id, outcome, details, now);
          return { doc: result.doc, changed: result.applied, value: undefined };
        });
        break;
      } catch (error) {
        logTechnical('resolveGuess', error);
        await sleep(800);
      }
    }
    verifying.delete(guess.id);
  }

  async function advance(code: string) {
    const room = await currentDoc(code);
    const done = { state_version: room.stateVersion, status: room.status };
    if (room.phaseEndsAt === null) return done;
    const current = sessions.get(code);
    const userId = await user();
    const referee = current ? current.isReferee(room) : room.hostPlayerId === userId;
    const due =
      room.phaseEndsAt + (referee ? 0 : REFEREE_GRACE_MS) + (room.status === 'decision' ? VOTE_SETTLE_MS : 0);
    const early = due - clock.now();
    if (early > 0) {
      if (!referee || early > 1000) return done;
      await sleep(early);
    }
    await mutate(
      code,
      (fresh, now, votes) => ({ ...advancePhases(fresh, now, votes, WORD_BANK), value: undefined }),
      { withVotes: room.status === 'decision' },
    );
    const after = await currentDoc(code);
    return { state_version: after.stateVersion, status: after.status };
  }

  return {
    kind: 'firebase',

    async createRoom(name, rounds) {
      const userId = await user();
      createRoom('AAAAAA', userId, name, rounds, 0); // valida nome e rodadas antes de tudo
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = randomCode();
        try {
          const created = await runTransaction(db(), async (tx) => {
            const snap = await tx.get(roomRef(code));
            if (snap.exists()) return false;
            tx.set(roomRef(code), stored(createRoom(code, userId, name, rounds, clock.now())));
            return true;
          });
          if (created) return { room_id: code, code, player_id: userId };
        } catch (error) {
          throw toOnlineError(error);
        }
      }
      throw new OnlineError('try_again');
    },

    async joinRoom(rawCode, name) {
      const code = normalizeCode(rawCode);
      if (code.length !== 6) throw new OnlineError('room_not_found');
      const userId = await user();
      await mutate(code, (room, now) => ({ ...joinRoom(room, userId, name, now), value: undefined }));
      return { room_id: code, code, player_id: userId };
    },

    async getState(code) {
      const userId = await user();
      const room = await currentDoc(code);
      try {
        return buildSnapshot(room, userId, sessions.get(code)?.votes ?? [], clock.now());
      } catch (error) {
        throw toOnlineError(error);
      }
    },

    startGame: (code) => mutate(code, apply((room, userId, now) => startGame(room, userId, now))),
    updateSettings: (code, rounds) =>
      mutate(code, apply((room, userId, now) => updateSettings(room, userId, rounds, now))),

    async vote(code, choice) {
      const userId = await user();
      const room = await currentDoc(code);
      let key: string;
      try {
        key = checkVote(room, userId, clock.now());
      } catch (error) {
        throw toOnlineError(error);
      }
      await writeVote(code, userId, key, choice);
    },

    async requestNewWord(code) {
      const userId = await user();
      const key = await mutate(code, (room, now) => {
        const result = requestNewWord(room, userId, now);
        return { doc: result.doc, changed: true, value: result.voteKey };
      });
      // O pedido já conta como voto em "Nova palavra".
      await writeVote(code, userId, key, 'new_word').catch((error) => logTechnical('vote', error));
    },

    requestFinish: (code) =>
      mutate(code, (room, now, _votes, userId) => {
        const result = requestFinish(room, userId, now);
        return { doc: result.doc, changed: true, value: { finished: result.finished } };
      }),

    kickPlayer: (code, playerId) =>
      mutate(code, apply((room, userId, now) => kickPlayer(room, userId, playerId, now))),
    endGame: (code) =>
      mutate(code, (room, now, _votes, userId) => ({ ...endGame(room, userId, now), value: undefined })),
    extendRounds: (code, extra) =>
      mutate(code, apply((room, userId, now) => extendRounds(room, userId, extra, now))),
    respondFinalRound: (code, extra) =>
      mutate(code, apply((room, userId, now) => respondFinalRound(room, userId, extra, now))),
    restart: (code, rounds) => mutate(code, apply((room, userId, now) => restartRoom(room, userId, rounds, now))),

    async leave(code) {
      try {
        await mutate(code, (room, now, _votes, userId) => ({ ...leaveRoom(room, userId, now), value: undefined }));
      } finally {
        sessions.get(code)?.close();
      }
    },

    /** Sinal de vida: presença, reconexão de quem tinha caído e, se este aparelho é o juiz, quem sumiu. */
    async heartbeat(code) {
      const userId = await user();
      await beatPresence(code, userId).catch((error) => logTechnical('presence', error));
      const current = sessions.get(code);
      let room = await currentDoc(code);
      const me = room.players.find((player) => player.id === userId);
      if (!me) throw new OnlineError('not_in_room');
      const beat = () => ({
        kicked: false,
        state_version: room.stateVersion,
        status: room.status,
        server_time: iso(clock.now()),
      });
      if (me.leftReason === 'kicked') return { ...beat(), kicked: true };

      if (!me.isActive && me.leftReason === 'timeout' && room.status !== 'finished') {
        await mutate(code, (fresh, now) => ({ ...reactivate(fresh, userId, now), value: undefined }));
        room = await currentDoc(code);
      }

      // Palpite meu que ficou sem verificação (ex.: a página recarregou no meio): verifica de novo.
      const guess = room.activeGuess;
      if (room.status === 'verifying' && guess?.playerId === userId && !verifying.has(guess.id)) {
        const word = room.word?.word;
        if (word && clock.now() - guess.submittedAt > 5000) void verifyGuess(code, guess, word);
      }

      if (current && current.isReferee(room) && (current.goneIds(room).length > 0 || current.guesserGone(room))) {
        await mutate(code, (fresh, now) => ({
          ...sweepPlayers(fresh, current.goneIds(fresh), now, { guesserGone: current.guesserGone(fresh) }),
          value: undefined,
        }));
        room = await currentDoc(code);
      }

      if (room.phaseEndsAt !== null && room.phaseEndsAt <= clock.now()) {
        await advance(code).catch((error) => logTechnical('advance', error));
        room = await currentDoc(code);
      }
      return beat();
    },

    advance,

    async submitGuess(code, text) {
      const userId = await user();
      const guessId = randomId();
      const result = await mutate(code, (room, now) => {
        const submitted = submitGuess(room, userId, text, guessId, now);
        return { doc: submitted.doc, changed: submitted.result.accepted, value: submitted.result };
      });
      if (!result.accepted) return { accepted: false, reason: result.reason };
      void verifyGuess(code, result.guess, result.word);
      return { accepted: true, guessId };
    },

    subscribe(code, onChange, onStatus) {
      let unsubscribe: (() => void) | null = null;
      let cancelled = false;
      onStatus?.('connecting');
      void session(code).then(
        (current) => {
          if (!cancelled) unsubscribe = current.addListener({ onChange, onStatus });
        },
        () => onStatus?.('offline'),
      );
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
  };
}
