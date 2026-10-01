/**
 * Modo online dentro do Claude: a sala é um documento compartilhado do artefato.
 *
 * - Toda alteração da sala segue as regras de `src/game/online/rules.ts` e acontece
 *   com uma trava curta no documento (`acquire`): um aparelho por vez lê, decide e grava.
 *   Assim, dois palpites simultâneos viram uma fila e só o primeiro é aceito.
 * - Os horários (prazos de 3 s etc.) usam um relógio compartilhado, estimado a partir
 *   do horário do servidor devolvido pela trava.
 * - Cada voto fica no documento do próprio jogador (sem disputar a trava da sala).
 * - Quem está conectado vem da presença da sala; o jogador mais antigo presente
 *   (normalmente o host) faz o papel de juiz: avança prazos e marca quem caiu.
 * - A música é verificada pelo Claude na conta de quem enviou o palpite.
 */
import { WORD_BANK } from '@/data/words';
import {
  advancePhases,
  buildSnapshot,
  checkVote,
  createRoom,
  endGame,
  extendRounds,
  isRoomDoc,
  isVoteDoc,
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
  type GuessDetails,
  type GuessDoc,
  type GuessOutcome,
  type RoomDoc,
  RuleError,
  startGame,
  submitGuess,
  sweepPlayers,
  updateSettings,
  type VoteDoc,
} from '@/game/online/rules';
import type { VoteChoice } from '@/types/online';

import type { ArtifactRuntime, DbFailure, DocRef, DocSnapshot, NamedRoom } from './artifactRuntime';
import {
  buildConfirmPrompt,
  buildJudgePrompt,
  interpretConfirmation,
  parseJsonAnswer,
  planJudgement,
  sampleFailureReason,
} from './claudeJudge';
import { logTechnical, OnlineError } from './errors';
import type { AiAccess, OnlineBackend, RealtimeStatus } from './types';

/** Duração da trava da sala (o mínimo aceito é 1 s; ela expira sozinha). */
const LEASE_MS = 1500;
const LOCK_ATTEMPTS = 16;
/** Os demais aparelhos só avançam um prazo se o juiz não o fizer neste intervalo. */
const REFEREE_GRACE_MS = 1500;
/** Folga para os últimos votos chegarem antes de apurar a votação. */
const VOTE_SETTLE_MS = 400;
/** Palpite de alguém que sumiu da sala deixa de travar a partida depois disso. */
const GUESSER_GONE_MS = 10_000;
/** Tempo mínimo de "Verificando…" (respostas repetidas do Claude chegam na hora). */
const MIN_VERIFY_MS = 1500;
/** A presença precisa estar conectada há este tempo antes de alguém ser marcado como desconectado. */
const PRESENCE_WARMUP_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const iso = (ms: number) => new Date(ms).toISOString();

function randomId(): string {
  const crypto = globalThis.crypto as Crypto | undefined;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Segmento de caminho válido para o banco do artefato. */
function segment(id: string): string {
  return id.replace(/[^A-Za-z0-9_\-~:@]/g, (char) => `+${char.charCodeAt(0).toString(16)}`);
}

const roomPath = (code: string) => `rooms/${code}`;
const votesPath = (code: string) => `rooms/${code}/votes`;

/**
 * Relógio compartilhado: `expiresAt` da trava vem do relógio do servidor. Cada trava
 * concedida limita a diferença entre o relógio local e o do servidor; os limites se
 * acumulam e o meio do intervalo é a estimativa usada nos prazos.
 */
export class SharedClock {
  private lo = -Infinity;
  private hi = Infinity;
  offset = 0;

  sample(expiresAt: string | undefined, ttlMs: number, sentAt: number, receivedAt: number) {
    const parsed = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(parsed)) return;
    const granted = parsed - ttlMs;
    const precision = /\.\d{2,}/.test(expiresAt ?? '') ? 1 : 1000;
    const lo = granted - precision - receivedAt;
    const hi = granted + precision - sentAt;
    let nextLo = Math.max(this.lo, lo);
    let nextHi = Math.min(this.hi, hi);
    // Intervalos incompatíveis: o relógio do aparelho mudou. Recomeça a estimativa.
    if (nextLo > nextHi) {
      nextLo = lo;
      nextHi = hi;
    }
    this.lo = nextLo;
    this.hi = nextHi;
    this.offset = (nextLo + nextHi) / 2;
  }

  now() {
    return Date.now() + this.offset;
  }
}

function toOnlineError(error: unknown): OnlineError {
  if (error instanceof OnlineError) return error;
  if (error instanceof RuleError) return new OnlineError(error.code, error);
  const code = (error as DbFailure | null)?.code;
  logTechnical(`db ${code ?? ''}`, error);
  switch (code) {
    case 'invalid_argument':
      return new OnlineError('no_write_access', error);
    case 'quota_exceeded':
      return new OnlineError('storage_full', error);
    case 'resource_exhausted':
      return new OnlineError('try_again', error);
    case 'revoked':
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return new OnlineError('claude_unavailable', error);
    default:
      return new OnlineError('network', error);
  }
}

/** Chamada ao banco: falha passageira (`unavailable`) tenta de novo uma vez. */
async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if ((error as DbFailure | null)?.code === 'unavailable') {
      await sleep(300 + Math.random() * 500);
      try {
        return await operation();
      } catch (retryError) {
        throw toOnlineError(retryError);
      }
    }
    throw toOnlineError(error);
  }
}

function readVotes(docs: readonly DocSnapshot[]): VoteDoc[] {
  const votes: VoteDoc[] = [];
  for (const doc of docs) {
    const data = doc.exists ? doc.data() : undefined;
    // Cada jogador grava apenas o próprio voto (o documento tem o id do jogador).
    if (isVoteDoc(data) && segment(data.playerId) === doc.id) votes.push(data);
  }
  return votes;
}

type Listener = { onChange: () => void; onStatus?: (status: RealtimeStatus) => void };

/** Sala aberta neste aparelho: documento ao vivo, votos e presença. */
class RoomSession {
  doc: RoomDoc | null = null;
  votes: VoteDoc[] = [];
  private listeners = new Set<Listener>();
  private stops: (() => void)[] = [];
  private named: NamedRoom | null = null;
  private joining = false;
  private presenceFailures = 0;
  private lastSeen = new Map<string, number>();
  private connectedSince: number | null = null;
  private live = false;
  private started = false;
  private closed = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly runtime: ArtifactRuntime,
    readonly code: string,
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
      if (this.listeners.size === 0 && !this.closed) {
        // Uma pequena folga evita sair e voltar da sala a cada nova renderização.
        this.closeTimer = setTimeout(() => this.close(), 3000);
      }
    };
  }

  applyDoc(doc: RoomDoc) {
    if (this.doc && doc.stateVersion < this.doc.stateVersion) return;
    this.doc = doc;
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
    if (this.started) return;
    this.started = true;
    this.watchRoom();
    this.watchVotes();
    void this.joinPresence();
  }

  private watchRoom() {
    const stop = this.runtime.db.doc(roomPath(this.code)).onSnapshot(
      (snap) => {
        const data = snap.exists ? snap.data() : undefined;
        if (isRoomDoc(data)) this.applyDoc(data);
        if (!this.live) this.setStatus('live');
      },
      (error) => this.recover(error, () => this.watchRoom()),
    );
    this.stops.push(stop);
  }

  private watchVotes() {
    const stop = this.runtime.db.collection(votesPath(this.code)).onSnapshot(
      (snap) => {
        this.votes = readVotes(snap.docs);
        this.emit();
      },
      (error) => this.recover(error, () => this.watchVotes()),
    );
    this.stops.push(stop);
  }

  /** Assinatura encerrada pelo Claude: tenta de novo quando é passageiro. */
  private recover(error: DbFailure, resubscribe: () => void) {
    logTechnical('onSnapshot', error);
    this.setStatus('offline');
    if (error?.code === 'unavailable' || error?.code === 'resource_exhausted') {
      setTimeout(() => {
        if (!this.closed) resubscribe();
      }, 3000);
    }
  }

  private async joinPresence() {
    const room = this.runtime.room;
    if (!room || this.named || this.joining || this.closed || this.presenceFailures >= 3) return;
    this.joining = true;
    try {
      const named = await room.join(`upum-${this.code.toLowerCase()}`);
      if (this.closed) {
        void named.leave().catch(() => undefined);
        return;
      }
      this.named = named;
      void named.presence({ player: this.runtime.userId }).catch(() => undefined);
      const lost = () => {
        this.named = null;
        this.connectedSince = null;
      };
      this.stops.push(named.onPeers(() => this.markSeen(), lost));
      this.stops.push(
        named.onConnection((connected) => {
          this.connectedSince = connected ? (this.connectedSince ?? Date.now()) : null;
        }, lost),
      );
    } catch (error) {
      this.presenceFailures += 1;
      logTechnical('presence', error);
    } finally {
      this.joining = false;
    }
  }

  private peerIds(): Set<string> {
    const ids = new Set<string>();
    for (const peer of this.named?.peers() ?? []) {
      const id = peer.by ?? (typeof peer.presence?.player === 'string' ? peer.presence.player : null);
      if (id) ids.add(id);
    }
    return ids;
  }

  /** Chamado a cada sinal de vida: registra quem está na sala e reconecta a presença se preciso. */
  markSeen() {
    const now = Date.now();
    for (const id of this.peerIds()) this.lastSeen.set(id, now);
    if (!this.named) void this.joinPresence();
  }

  private presenceReady(): boolean {
    return (
      this.named !== null &&
      this.named.connected() &&
      this.connectedSince !== null &&
      Date.now() - this.connectedSince >= PRESENCE_WARMUP_MS
    );
  }

  /** Sem dados de presença confiáveis, todos contam como presentes (ninguém é removido por engano). */
  isPresent(id: string, withinMs: number): boolean {
    if (id === this.runtime.userId || !this.presenceReady()) return true;
    if (this.peerIds().has(id)) return true;
    const since = Math.max(this.lastSeen.get(id) ?? 0, this.connectedSince ?? 0);
    return Date.now() - since < withinMs;
  }

  /** Jogadores ativos sem presença há 30 s. */
  goneIds(doc: RoomDoc): string[] {
    if (!this.presenceReady()) return [];
    return doc.players
      .filter(
        (player) => player.isActive && player.tracked !== false && !this.isPresent(player.id, PHASE_MS.playerTimeout),
      )
      .map((player) => player.id);
  }

  guesserGone(doc: RoomDoc): boolean {
    const guesser = doc.status === 'verifying' ? doc.activeGuess?.playerId : undefined;
    return Boolean(guesser && this.presenceReady() && !this.isPresent(guesser, GUESSER_GONE_MS));
  }

  /** O juiz é o jogador ativo mais antigo que está presente (normalmente o host). */
  isReferee(doc: RoomDoc): boolean {
    const active = doc.players.filter((player) => player.isActive).sort((a, b) => a.joinOrder - b.joinOrder);
    for (const player of active) {
      if (player.id === this.runtime.userId) return true;
      if (this.isPresent(player.id, 8000)) return false;
    }
    return false;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.stops) stop();
    this.stops = [];
    void this.named?.leave().catch(() => undefined);
    this.named = null;
    this.listeners.clear();
    this.onClose();
  }
}

type Change<T> = { doc: RoomDoc; changed: boolean; value: T };

export function createArtifactBackend(runtime: ArtifactRuntime): OnlineBackend {
  const { db, userId } = runtime;
  const holder = `${segment(userId)}:${randomId()}`;
  const clock = new SharedClock();
  const sessions = new Map<string, RoomSession>();
  const verifying = new Set<string>();
  /** Sem presença (recurso de sala indisponível), este jogador nunca é marcado como desconectado. */
  const tracked = runtime.room !== null;
  let queue: Promise<unknown> = Promise.resolve();

  function session(code: string): RoomSession {
    let current = sessions.get(code);
    if (!current) {
      current = new RoomSession(runtime, code, () => sessions.delete(code));
      sessions.set(code, current);
    }
    return current;
  }

  /** Uma alteração por vez neste aparelho (a trava coordena os demais). */
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  /** Trava curta na sala. Devolve o horário local em que a trava começou a valer. */
  async function lock(ref: DocRef): Promise<number> {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
      const sentAt = Date.now();
      const result = await call(() => ref.acquire({ holder, ttlMs: LEASE_MS }));
      const receivedAt = Date.now();
      if (result.acquired) {
        clock.sample(result.expiresAt, LEASE_MS, sentAt, receivedAt);
        return sentAt;
      }
      const busyFor = result.expiresAt ? Date.parse(result.expiresAt) - clock.now() : LEASE_MS;
      await sleep(Math.min(LEASE_MS, Math.max(60, Number.isFinite(busyFor) ? busyFor : LEASE_MS)) + Math.random() * 120);
    }
    throw new OnlineError('try_again');
  }

  async function fetchDoc(code: string): Promise<RoomDoc> {
    const snap = await call(() => db.doc(roomPath(code)).get());
    const data = snap.exists ? snap.data() : undefined;
    if (!isRoomDoc(data)) throw new OnlineError('room_not_found');
    return data;
  }

  async function currentDoc(code: string): Promise<RoomDoc> {
    const cached = sessions.get(code)?.doc;
    if (cached) return cached;
    const doc = await fetchDoc(code);
    sessions.get(code)?.applyDoc(doc);
    return doc;
  }

  async function fetchVotes(code: string): Promise<VoteDoc[]> {
    const snap = await call(() => db.collection(votesPath(code)).get());
    return readVotes(snap.docs);
  }

  /** Lê a sala com a trava, aplica a regra e grava o resultado (se algo mudou). */
  function mutate<T>(
    code: string,
    change: (doc: RoomDoc, now: number, votes: VoteDoc[]) => Change<T>,
    options: { withVotes?: boolean } = {},
  ): Promise<T> {
    return serialize(async () => {
      // Confere que a sala existe antes de travar (a trava criaria um documento vazio).
      if (!sessions.get(code)?.doc) await fetchDoc(code);
      const ref = db.doc(roomPath(code));
      const lockedAt = await lock(ref);
      const snap = await call(() => ref.get());
      const data = snap.exists ? snap.data() : undefined;
      if (!isRoomDoc(data)) throw new OnlineError('room_not_found');
      const votes = options.withVotes ? await fetchVotes(code) : [];

      let result: Change<T>;
      try {
        result = change(data, clock.now(), votes);
      } catch (error) {
        throw toOnlineError(error);
      }
      if (result.changed) {
        // Renova a trava se a leitura demorou, para ninguém gravar por cima.
        if (Date.now() - lockedAt > LEASE_MS * 0.5) await lock(ref);
        await call(() => ref.set(result.doc as unknown as Record<string, unknown>));
        sessions.get(code)?.applyDoc(result.doc);
      }
      return result.value;
    });
  }

  const apply =
    (rule: (doc: RoomDoc, now: number) => RoomDoc) =>
    (doc: RoomDoc, now: number): Change<void> => ({ doc: rule(doc, now), changed: true, value: undefined });

  async function writeVote(code: string, key: string, choice: VoteChoice) {
    const vote: VoteDoc = { playerId: userId, key, choice, at: clock.now() };
    await call(() => db.doc(`${votesPath(code)}/${segment(userId)}`).set(vote));
  }

  /** Pede a resposta em JSON; apps do Claude sem `sample.json` recebem texto e o jogo lê o JSON. */
  async function askClaude(prompt: string): Promise<unknown> {
    const sample = runtime.sample;
    if (!sample) throw { code: 'capability_disabled' };
    // O modelo mais capaz reconhece bem mais títulos e trechos (principalmente de música brasileira).
    const options = { modelTier: 'complex' as const };
    if (typeof sample.json === 'function') {
      try {
        return await sample.json(prompt, options);
      } catch (error) {
        if ((error as { code?: string } | null)?.code !== 'capability_removed') throw error;
      }
    }
    const { text } = await sample(prompt, options);
    return parseJsonAnswer(text);
  }

  async function aiAccess(): Promise<AiAccess> {
    if (!runtime.sample) return 'unavailable';
    if (!runtime.permissions) return 'granted'; // sem o recurso de permissões: o pedido pergunta sozinho
    try {
      return await runtime.permissions.state('sample');
    } catch {
      return 'granted';
    }
  }

  /** Pergunta ao Claude de qual música é o palpite, confere essa música e aplica o resultado na sala. */
  async function verifyGuess(code: string, guess: GuessDoc, word: string) {
    if (verifying.has(guess.id)) return;
    verifying.add(guess.id);
    const startedAt = Date.now();
    let outcome: GuessOutcome;
    let details: GuessDetails;
    try {
      // 1ª etapa: de qual música é o palpite? 2ª etapa: conferência separada dessa música.
      const plan = planJudgement(await askClaude(buildJudgePrompt(word, guess.text)), word, guess.text);
      if ('result' in plan) {
        ({ outcome, details } = plan.result);
      } else {
        const answer = await askClaude(buildConfirmPrompt(word, guess.text, plan.confirm));
        ({ outcome, details } = interpretConfirmation(answer, word, plan.confirm, plan.lyrics));
      }
    } catch (error) {
      logTechnical('sample', error);
      outcome = 'error';
      details = { reason: sampleFailureReason(error) };
    }
    const wait = MIN_VERIFY_MS - (Date.now() - startedAt);
    if (wait > 0) await sleep(wait);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await mutate(code, (doc, now) => {
          const result = resolveGuess(doc, guess.id, outcome, details, now);
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
    const doc = await currentDoc(code);
    const done = { state_version: doc.stateVersion, status: doc.status };
    if (doc.phaseEndsAt === null) return done;
    const current = sessions.get(code);
    const referee = current ? current.isReferee(doc) : doc.hostPlayerId === userId;
    const due =
      doc.phaseEndsAt + (referee ? 0 : REFEREE_GRACE_MS) + (doc.status === 'decision' ? VOTE_SETTLE_MS : 0);
    const early = due - clock.now();
    if (early > 0) {
      if (!referee || early > 1000) return done;
      await sleep(early);
    }
    await mutate(
      code,
      (fresh, now, votes) => ({ ...advancePhases(fresh, now, votes, WORD_BANK), value: undefined }),
      { withVotes: doc.status === 'decision' },
    );
    const after = await currentDoc(code);
    return { state_version: after.stateVersion, status: after.status };
  }

  return {
    kind: 'claude',

    aiAccess,

    async requestAiAccess() {
      if (!runtime.sample) return 'unavailable';
      if (!runtime.permissions) return 'granted';
      try {
        const states = await runtime.permissions.request(['sample']);
        return states.sample ?? (await aiAccess());
      } catch {
        return aiAccess();
      }
    },

    async createRoom(name, rounds) {
      createRoom('AAAAAA', userId, name, rounds, 0); // valida nome e rodadas antes de tudo
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = randomCode();
        const ref = db.doc(roomPath(code));
        const before = await call(() => ref.get());
        if (before.exists && isRoomDoc(before.data())) continue;
        const created = await serialize(async () => {
          await lock(ref);
          const snap = await call(() => ref.get());
          if (snap.exists && isRoomDoc(snap.data())) return null;
          const doc = createRoom(code, userId, name, rounds, clock.now(), tracked);
          await call(() => ref.set(doc as unknown as Record<string, unknown>));
          return doc;
        });
        if (created) return { room_id: code, code, player_id: userId };
      }
      throw new OnlineError('try_again');
    },

    async joinRoom(rawCode, name) {
      const code = normalizeCode(rawCode);
      if (code.length !== 6) throw new OnlineError('room_not_found');
      await mutate(code, (doc, now) => ({ ...joinRoom(doc, userId, name, now, tracked), value: undefined }));
      return { room_id: code, code, player_id: userId };
    },

    async getState(code) {
      const doc = await currentDoc(code);
      try {
        return buildSnapshot(doc, userId, sessions.get(code)?.votes ?? [], clock.now());
      } catch (error) {
        throw toOnlineError(error);
      }
    },

    startGame: (code) => mutate(code, apply((doc, now) => startGame(doc, userId, now))),
    updateSettings: (code, rounds) => mutate(code, apply((doc, now) => updateSettings(doc, userId, rounds, now))),

    async vote(code, choice) {
      const doc = await currentDoc(code);
      let key: string;
      try {
        key = checkVote(doc, userId, clock.now());
      } catch (error) {
        throw toOnlineError(error);
      }
      await writeVote(code, key, choice);
    },

    async requestNewWord(code) {
      const key = await mutate(code, (doc, now) => {
        const result = requestNewWord(doc, userId, now);
        return { doc: result.doc, changed: true, value: result.voteKey };
      });
      // O pedido já conta como voto em "Nova palavra".
      await writeVote(code, key, 'new_word').catch((error) => logTechnical('vote', error));
    },

    requestFinish: (code) =>
      mutate(code, (doc, now) => {
        const result = requestFinish(doc, userId, now);
        return { doc: result.doc, changed: true, value: { finished: result.finished } };
      }),

    kickPlayer: (code, playerId) => mutate(code, apply((doc, now) => kickPlayer(doc, userId, playerId, now))),
    endGame: (code) => mutate(code, (doc, now) => ({ ...endGame(doc, userId, now), value: undefined })),
    extendRounds: (code, extra) => mutate(code, apply((doc, now) => extendRounds(doc, userId, extra, now))),
    respondFinalRound: (code, extra) =>
      mutate(code, apply((doc, now) => respondFinalRound(doc, userId, extra, now))),
    restart: (code, rounds) => mutate(code, apply((doc, now) => restartRoom(doc, userId, rounds, now))),

    async leave(code) {
      try {
        await mutate(code, (doc, now) => ({ ...leaveRoom(doc, userId, now), value: undefined }));
      } finally {
        sessions.get(code)?.close();
      }
    },

    /** Sinal de vida: reconecta quem tinha caído e, se este aparelho é o juiz, marca quem sumiu. */
    async heartbeat(code) {
      const current = sessions.get(code);
      current?.markSeen();
      let doc = await currentDoc(code);
      const me = doc.players.find((player) => player.id === userId);
      if (!me) throw new OnlineError('not_in_room');
      const beat = () => ({
        kicked: false,
        state_version: doc.stateVersion,
        status: doc.status,
        server_time: iso(clock.now()),
      });
      if (me.leftReason === 'kicked') return { ...beat(), kicked: true };

      if (!me.isActive && me.leftReason === 'timeout' && doc.status !== 'finished') {
        await mutate(code, (fresh, now) => ({ ...reactivate(fresh, userId, now), value: undefined }));
        doc = await currentDoc(code);
      }

      // Palpite meu que ficou sem verificação (ex.: a página recarregou no meio): verifica de novo.
      const guess = doc.activeGuess;
      if (doc.status === 'verifying' && guess?.playerId === userId && !verifying.has(guess.id)) {
        const word = doc.word?.word;
        if (word && clock.now() - guess.submittedAt > 5000) void verifyGuess(code, guess, word);
      }

      if (current && current.isReferee(doc) && (current.goneIds(doc).length > 0 || current.guesserGone(doc))) {
        await mutate(code, (fresh, now) => ({
          ...sweepPlayers(fresh, current.goneIds(fresh), now, { guesserGone: current.guesserGone(fresh) }),
          value: undefined,
        }));
        doc = await currentDoc(code);
      }

      if (doc.phaseEndsAt !== null && doc.phaseEndsAt <= clock.now()) {
        await advance(code).catch((error) => logTechnical('advance', error));
        doc = await currentDoc(code);
      }
      return beat();
    },

    advance,

    async submitGuess(code, text) {
      // Sem o Claude para verificar, nem trava a partida.
      if (!runtime.sample) throw new OnlineError('ai_unavailable');
      const guessId = randomId();
      const result = await mutate(code, (doc, now) => {
        const submitted = submitGuess(doc, userId, text, guessId, now);
        return { doc: submitted.doc, changed: submitted.result.accepted, value: submitted.result };
      });
      if (!result.accepted) return { accepted: false, reason: result.reason };
      void verifyGuess(code, result.guess, result.word);
      return { accepted: true, guessId };
    },

    subscribe(code, onChange, onStatus) {
      return session(code).addListener({ onChange, onStatus });
    },
  };
}
