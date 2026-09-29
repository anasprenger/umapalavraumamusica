/**
 * Regras do modo online em TypeScript puro — a mesma máquina de estados de
 * `supabase/migrations/*_game_functions.sql`, usada quando a partida roda dentro
 * do Claude (documento compartilhado do artefato, sem servidor próprio).
 *
 * Cada função recebe o documento da sala, devolve uma CÓPIA alterada e lança
 * `RuleError(código)` quando a ação não é permitida. Quem chama garante que
 * apenas um aparelho altera a sala por vez (trava curta no documento).
 */
import { pickRandomWord } from '@/data/words';
import type { CurrentWord, EndReason, GuessResult, RoomSnapshot, RoomStatus, VoteChoice } from '@/types/online';
import { tidyName } from '@/utils/normalize';

export const PHASE_MS = {
  starting: 3000, // "Preparem-se" antes da 1ª palavra
  correct: 3000, // animação de acerto
  countdown: 3000, // "Próxima palavra em 3, 2, 1"
  incorrect: 2000, // "Música incorreta"
  decision: 3000, // votação Novo palpite × Nova palavra
  /** Segurança caso a verificação trave (o Claude pode levar alguns segundos para pensar). */
  verifyTimeout: 120_000,
  /** Sem presença por 30 s = desconectado. */
  playerTimeout: 30_000,
} as const;

export const MAX_PLAYERS = 10;
export const MIN_PLAYERS = 2;
export const MAX_ROUNDS = 9999;
export const MAX_NAME = 24;
export const MAX_GUESS = 200;

export class RuleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RuleError';
  }
}

function fail(code: string): never {
  throw new RuleError(code);
}

export type LeftReason = 'left' | 'timeout' | 'kicked';

export type PlayerDoc = {
  id: string;
  name: string;
  score: number;
  joinOrder: number;
  isActive: boolean;
  leftReason: LeftReason | null;
  joinedAt: number;
  /** `false`: o aparelho não informa presença, então o jogador nunca é marcado como desconectado. */
  tracked: boolean;
};

export type WordDoc = {
  sequence: number;
  word: string;
  status: 'active' | 'won' | 'discarded';
  hasAttempt: boolean;
  roundNumber: number | null;
  winnerPlayerId: string | null;
};

export type GuessDoc = {
  id: string;
  playerId: string;
  text: string;
  wordSequence: number;
  submittedAt: number;
  status: 'verifying' | 'correct' | 'incorrect' | 'error';
  resultSong: string | null;
  resultArtist: string | null;
  matchedExcerpt: string | null;
  matchedWord: string | null;
  failureReason: string | null;
  verifiedAt: number | null;
};

export type FinishRequest = { playerId: string; at: number };

export type RoomDoc = {
  v: 1;
  code: string;
  status: RoomStatus;
  /** Horários em milissegundos no relógio compartilhado (estimativa do horário do servidor). */
  phaseEndsAt: number | null;
  configuredRounds: number;
  roundsPlayed: number;
  hostPlayerId: string | null;
  decisionOrigin: 'incorrect_guess' | 'skip_request' | null;
  decisionNumber: number;
  finalPromptAnsweredFor: number | null;
  endReason: EndReason | null;
  stateVersion: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
  /** Aumenta a cada "Jogar novamente": separa votos de partidas diferentes. */
  match: number;
  nextJoinOrder: number;
  players: PlayerDoc[];
  word: WordDoc | null;
  usedWords: string[];
  activeGuess: GuessDoc | null;
  lastResult: GuessDoc | null;
  finishRequests: FinishRequest[];
};

/** Voto de um jogador (cada um grava o próprio documento, sem disputar a trava da sala). */
export type VoteDoc = { playerId: string; key: string; choice: VoteChoice; at: number };

export type GuessOutcome = 'correct' | 'incorrect' | 'error';

export type GuessDetails = {
  title?: string | null;
  artist?: string | null;
  excerpt?: string | null;
  matchedWord?: string | null;
  reason?: string | null;
};

// -----------------------------------------------------------------------------
// Utilitários
// -----------------------------------------------------------------------------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I

export function randomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function cleanName(name: string): string {
  const value = tidyName(name ?? '');
  if (!value) fail('invalid_name');
  return [...value].slice(0, MAX_NAME).join('');
}

function validRounds(rounds: number | null | undefined): rounds is number {
  return typeof rounds === 'number' && Number.isInteger(rounds) && rounds >= 1 && rounds <= MAX_ROUNDS;
}

/** Chave da votação atual: votos de outra palavra, decisão ou partida não contam. */
export function voteKey(doc: RoomDoc): string | null {
  return doc.word ? `${doc.match}:${doc.word.sequence}:${doc.decisionNumber}` : null;
}

function clone(doc: RoomDoc): RoomDoc {
  return JSON.parse(JSON.stringify(doc)) as RoomDoc;
}

function touch(doc: RoomDoc, now: number) {
  doc.stateVersion += 1;
  doc.updatedAt = now;
}

function activePlayers(doc: RoomDoc) {
  return doc.players.filter((player) => player.isActive);
}

function findPlayer(doc: RoomDoc, userId: string): PlayerDoc {
  const player = doc.players.find((item) => item.id === userId);
  if (!player) fail('not_in_room');
  if (player.leftReason === 'kicked') fail('kicked');
  return player;
}

/** Jogador ativo (reativa automaticamente quem tinha caído por falta de sinal). */
function activePlayer(doc: RoomDoc, userId: string): PlayerDoc {
  const player = findPlayer(doc, userId);
  if (!player.isActive) {
    if (player.leftReason === 'timeout' && doc.status !== 'finished' && activePlayers(doc).length < MAX_PLAYERS) {
      player.isActive = true;
      player.leftReason = null;
      ensureHost(doc);
    } else {
      fail('not_active');
    }
  }
  return player;
}

function requireHost(doc: RoomDoc, userId: string): PlayerDoc {
  const player = activePlayer(doc, userId);
  if (player.id !== doc.hostPlayerId) fail('not_host');
  return player;
}

/** Nome único dentro da sala ("Ana", "Ana 2"...). */
function uniqueName(doc: RoomDoc, name: string): string {
  const taken = (candidate: string) =>
    doc.players.some((p) => p.leftReason !== 'kicked' && p.name.toLowerCase() === candidate.toLowerCase());
  let candidate = name;
  let suffix = 2;
  while (taken(candidate)) {
    const room = MAX_NAME - String(suffix).length - 1;
    candidate = `${[...name].slice(0, room).join('')} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/** Se o host saiu, o cargo passa para o próximo ativo na ordem de entrada. */
function ensureHost(doc: RoomDoc): boolean {
  const current = doc.players.find((p) => p.id === doc.hostPlayerId);
  if (current?.isActive) return false;
  const next = [...activePlayers(doc)].sort((a, b) => a.joinOrder - b.joinOrder)[0]?.id ?? null;
  if (next !== doc.hostPlayerId) {
    doc.hostPlayerId = next;
    return true;
  }
  return false;
}

function finishRoom(doc: RoomDoc, reason: EndReason, now: number) {
  if (doc.status === 'finished') return;
  if (doc.activeGuess) {
    doc.lastResult = { ...doc.activeGuess, status: 'error', failureReason: 'cancelled', verifiedAt: now };
  }
  if (doc.word?.status === 'active') doc.word.status = 'discarded';
  doc.status = 'finished';
  doc.endReason = reason;
  doc.endedAt = now;
  doc.phaseEndsAt = null;
  doc.activeGuess = null;
  doc.decisionOrigin = null;
}

/** Sorteia uma palavra ainda não usada na partida. Sem palavras: encerra a partida. */
function drawWord(doc: RoomDoc, now: number, words: readonly string[] | undefined, random: () => number): boolean {
  const word = pickRandomWord(doc.usedWords, words, random);
  if (!word) {
    finishRoom(doc, 'words_exhausted', now);
    return false;
  }
  doc.usedWords.push(word);
  doc.word = {
    sequence: (doc.word?.sequence ?? 0) + 1,
    word,
    status: 'active',
    hasAttempt: false,
    roundNumber: null,
    winnerPlayerId: null,
  };
  doc.status = 'playing';
  doc.phaseEndsAt = null;
  doc.activeGuess = null;
  doc.lastResult = null;
  doc.decisionOrigin = null;
  return true;
}

/** Primeira tentativa verificada: a palavra passa a contar como rodada (uma única vez). */
function countAttempt(doc: RoomDoc) {
  if (!doc.word || doc.word.hasAttempt) return;
  doc.roundsPlayed += 1;
  doc.word.hasAttempt = true;
  doc.word.roundNumber = doc.roundsPlayed;
}

function roundsCompleted(doc: RoomDoc) {
  return doc.roundsPlayed >= doc.configuredRounds;
}

/** Finalização coletiva: mais de 50% dos jogadores ATIVOS pediram para finalizar. */
function checkFinishMajority(doc: RoomDoc, now: number): boolean {
  if (doc.status === 'waiting' || doc.status === 'finished') return false;
  const active = new Set(activePlayers(doc).map((p) => p.id));
  const requests = doc.finishRequests.filter((request) => active.has(request.playerId)).length;
  if (active.size > 0 && requests * 2 > active.size) {
    finishRoom(doc, 'majority_finish', now);
    return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Entrada, lobby e início
// -----------------------------------------------------------------------------
export function createRoom(
  code: string,
  userId: string,
  name: string,
  rounds: number,
  now: number,
  tracked = true,
): RoomDoc {
  const cleaned = cleanName(name);
  if (!validRounds(rounds)) fail('invalid_rounds');
  return {
    v: 1,
    code,
    status: 'waiting',
    phaseEndsAt: null,
    configuredRounds: rounds,
    roundsPlayed: 0,
    hostPlayerId: userId,
    decisionOrigin: null,
    decisionNumber: 0,
    finalPromptAnsweredFor: null,
    endReason: null,
    stateVersion: 1,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    updatedAt: now,
    match: 1,
    nextJoinOrder: 2,
    players: [
      { id: userId, name: cleaned, score: 0, joinOrder: 1, isActive: true, leftReason: null, joinedAt: now, tracked },
    ],
    word: null,
    usedWords: [],
    activeGuess: null,
    lastResult: null,
    finishRequests: [],
  };
}

/**
 * Entrar na sala (antes ou durante a partida). Também serve para reconectar:
 * o mesmo usuário recupera o mesmo jogador, com a mesma pontuação.
 */
export function joinRoom(
  input: RoomDoc,
  userId: string,
  name: string,
  now: number,
  tracked = true,
): { doc: RoomDoc; changed: boolean } {
  const doc = clone(input);
  let changed = false;
  const existing = doc.players.find((p) => p.id === userId);

  if (existing) {
    if (existing.leftReason === 'kicked') fail('kicked');
    if (existing.tracked !== tracked) {
      existing.tracked = tracked;
      changed = true;
    }
    if (!existing.isActive && doc.status !== 'finished') {
      if (activePlayers(doc).length >= MAX_PLAYERS) fail('room_full');
      // Quem saiu por conta própria volta no fim da fila de host; quem só caiu mantém a posição.
      if (existing.leftReason === 'left') {
        existing.joinOrder = doc.nextJoinOrder;
        doc.nextJoinOrder += 1;
      }
      existing.isActive = true;
      existing.leftReason = null;
      changed = true;
    }
  } else {
    if (doc.status === 'finished') fail('room_finished');
    if (activePlayers(doc).length >= MAX_PLAYERS) fail('room_full');
    doc.players.push({
      id: userId,
      name: uniqueName(doc, cleanName(name)),
      score: 0,
      joinOrder: doc.nextJoinOrder,
      isActive: true,
      leftReason: null,
      joinedAt: now,
      tracked,
    });
    doc.nextJoinOrder += 1;
    changed = true;
  }

  if (ensureHost(doc)) changed = true;
  if (changed) touch(doc, now);
  return { doc, changed };
}

export function startGame(input: RoomDoc, userId: string, now: number): RoomDoc {
  const doc = clone(input);
  requireHost(doc, userId);
  if (doc.status !== 'waiting') fail('already_started');
  if (activePlayers(doc).length < MIN_PLAYERS) fail('not_enough_players');
  doc.status = 'starting';
  doc.startedAt = now;
  doc.phaseEndsAt = now + PHASE_MS.starting;
  touch(doc, now);
  return doc;
}

export function updateSettings(input: RoomDoc, userId: string, rounds: number, now: number): RoomDoc {
  const doc = clone(input);
  requireHost(doc, userId);
  if (doc.status !== 'waiting') fail('already_started');
  if (!validRounds(rounds)) fail('invalid_rounds');
  doc.configuredRounds = rounds;
  touch(doc, now);
  return doc;
}

// -----------------------------------------------------------------------------
// Palpites
// -----------------------------------------------------------------------------
export type SubmitResult =
  | { accepted: true; guess: GuessDoc; word: string; playerName: string }
  | { accepted: false; reason: 'busy' | 'not_accepting' };

/** Reserva a verificação para o PRIMEIRO palpite. Os demais são descartados. */
export function submitGuess(
  input: RoomDoc,
  userId: string,
  rawText: string,
  guessId: string,
  now: number,
): { doc: RoomDoc; result: SubmitResult } {
  const doc = clone(input);
  const player = activePlayer(doc, userId);
  const text = tidyName(rawText ?? '');
  if (text.length === 0 || text.length > MAX_GUESS) fail('invalid_guess');

  if (doc.status !== 'playing' || !doc.word) {
    return { doc: input, result: { accepted: false, reason: doc.status === 'verifying' ? 'busy' : 'not_accepting' } };
  }

  const guess: GuessDoc = {
    id: guessId,
    playerId: player.id,
    text,
    wordSequence: doc.word.sequence,
    submittedAt: now,
    status: 'verifying',
    resultSong: null,
    resultArtist: null,
    matchedExcerpt: null,
    matchedWord: null,
    failureReason: null,
    verifiedAt: null,
  };
  doc.status = 'verifying';
  doc.activeGuess = guess;
  doc.phaseEndsAt = now + PHASE_MS.verifyTimeout;
  touch(doc, now);
  return { doc, result: { accepted: true, guess, word: doc.word.word, playerName: player.name } };
}

const clip = (value: string | null | undefined, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/**
 * Aplica o resultado da verificação musical.
 *   correct   → +1 ponto, palavra contabilizada, animação e contagem para a próxima
 *   incorrect → palavra contabilizada, "Música incorreta" e votação
 *   error     → a verificação falhou: o palpite não conta e o jogo volta a aceitar palpites
 */
export function resolveGuess(
  input: RoomDoc,
  guessId: string,
  outcome: GuessOutcome,
  details: GuessDetails,
  now: number,
): { doc: RoomDoc; applied: boolean } {
  if (isStaleGuess(input, guessId)) return { doc: input, applied: false };
  const doc = clone(input);
  const guess = doc.activeGuess!;
  const resolved: GuessDoc = {
    ...guess,
    status: outcome,
    verifiedAt: now,
    resultSong: clip(details.title, 300),
    resultArtist: clip(details.artist, 300),
    matchedExcerpt: clip(details.excerpt, 600),
    matchedWord: clip(details.matchedWord, 80),
    failureReason:
      outcome === 'correct' ? null : (clip(details.reason, 80) ?? (outcome === 'error' ? 'provider_unavailable' : 'no_match')),
  };
  doc.lastResult = resolved;
  doc.activeGuess = null;

  if (outcome === 'correct' || outcome === 'incorrect') countAttempt(doc);

  if (outcome === 'correct') {
    if (doc.word) {
      doc.word.status = 'won';
      doc.word.winnerPlayerId = guess.playerId;
    }
    const winner = doc.players.find((p) => p.id === guess.playerId);
    if (winner) winner.score += 1;
    doc.status = 'correct';
    doc.phaseEndsAt = now + PHASE_MS.correct;
  } else if (outcome === 'incorrect') {
    doc.status = 'incorrect';
    doc.phaseEndsAt = now + PHASE_MS.incorrect;
  } else {
    doc.status = 'playing';
    doc.phaseEndsAt = null;
  }
  touch(doc, now);
  return { doc, applied: true };
}

/** Chegou tarde (tempo esgotado, partida encerrada ou outro palpite): não altera a partida. */
function isStaleGuess(doc: RoomDoc, guessId: string) {
  return doc.status !== 'verifying' || doc.activeGuess?.id !== guessId;
}

// -----------------------------------------------------------------------------
// Decisões coletivas
// -----------------------------------------------------------------------------

/** Confere se ainda dá para votar (o voto em si fica no documento do próprio jogador). */
export function checkVote(doc: RoomDoc, userId: string, now: number): string {
  const player = findPlayer(doc, userId);
  if (!player.isActive) fail('not_active');
  if (doc.status !== 'decision' || doc.phaseEndsAt === null || doc.phaseEndsAt <= now) fail('vote_closed');
  return voteKey(doc)!;
}

/** "Pular palavra": abre a votação de 3 segundos (o pedido já conta como voto em Nova palavra). */
export function requestNewWord(input: RoomDoc, userId: string, now: number): { doc: RoomDoc; voteKey: string } {
  const doc = clone(input);
  activePlayer(doc, userId);
  if (doc.status !== 'playing') fail('not_playing');
  doc.status = 'decision';
  doc.decisionOrigin = 'skip_request';
  doc.decisionNumber += 1;
  doc.phaseEndsAt = now + PHASE_MS.decision;
  touch(doc, now);
  return { doc, voteKey: voteKey(doc)! };
}

/** "Finalizar jogo": pedido coletivo, sem opção "Não". Maioria (> 50% dos ativos) encerra. */
export function requestFinish(input: RoomDoc, userId: string, now: number): { doc: RoomDoc; finished: boolean } {
  const doc = clone(input);
  const player = activePlayer(doc, userId);
  if (doc.status === 'waiting' || doc.status === 'finished') fail('not_in_game');
  if (!doc.finishRequests.some((request) => request.playerId === player.id)) {
    doc.finishRequests.push({ playerId: player.id, at: now });
  }
  const finished = checkFinishMajority(doc, now);
  touch(doc, now);
  return { doc, finished };
}

/**
 * Votação "Novo palpite" × "Nova palavra":
 *   maioria em Novo palpite → continua a mesma palavra
 *   maioria em Nova palavra, empate ou ninguém votou → nova palavra
 */
function resolveDecision(doc: RoomDoc, votes: readonly VoteDoc[], now: number, words?: readonly string[], random = Math.random) {
  const key = voteKey(doc);
  let keep = 0;
  let replace = 0;
  for (const vote of votes) {
    if (vote.key !== key) continue;
    if (vote.choice === 'new_guess') keep += 1;
    else if (vote.choice === 'new_word') replace += 1;
  }
  if (keep > replace) {
    doc.status = 'playing';
    doc.phaseEndsAt = null;
    doc.decisionOrigin = null;
    return;
  }
  // A palavra é descartada. Ela já contou como rodada se teve palpite verificado.
  if (doc.word?.status === 'active') doc.word.status = 'discarded';
  if (roundsCompleted(doc)) finishRoom(doc, 'rounds_completed', now);
  else drawWord(doc, now, words, random);
}

/** Avança as fases cujo prazo venceu (idempotente). */
export function advancePhases(
  input: RoomDoc,
  now: number,
  votes: readonly VoteDoc[],
  words?: readonly string[],
  random: () => number = Math.random,
): { doc: RoomDoc; changed: boolean } {
  const doc = clone(input);
  let changed = false;
  for (let i = 0; i < 8; i += 1) {
    if (doc.phaseEndsAt === null || doc.phaseEndsAt > now) break;
    switch (doc.status) {
      case 'starting':
      case 'countdown':
        drawWord(doc, now, words, random);
        break;
      case 'verifying':
        // A verificação não respondeu a tempo: o palpite não conta e o jogo segue.
        cancelActiveGuess(doc, now, 'timeout');
        break;
      case 'correct':
        if (roundsCompleted(doc)) finishRoom(doc, 'rounds_completed', now);
        else {
          doc.status = 'countdown';
          doc.phaseEndsAt = now + PHASE_MS.countdown;
        }
        break;
      case 'incorrect':
        doc.status = 'decision';
        doc.decisionOrigin = 'incorrect_guess';
        doc.decisionNumber += 1;
        doc.phaseEndsAt = now + PHASE_MS.decision;
        break;
      case 'decision':
        resolveDecision(doc, votes, now, words, random);
        break;
      default:
        doc.phaseEndsAt = null;
    }
    changed = true;
  }
  if (changed) touch(doc, now);
  return { doc: changed ? doc : input, changed };
}

function cancelActiveGuess(doc: RoomDoc, now: number, reason: string) {
  if (doc.activeGuess) {
    doc.lastResult = { ...doc.activeGuess, status: 'error', failureReason: reason, verifiedAt: now };
  }
  doc.status = 'playing';
  doc.phaseEndsAt = null;
  doc.activeGuess = null;
}

// -----------------------------------------------------------------------------
// Funções do host
// -----------------------------------------------------------------------------
export function kickPlayer(input: RoomDoc, userId: string, targetId: string, now: number): RoomDoc {
  const doc = clone(input);
  const host = requireHost(doc, userId);
  if (targetId === host.id) fail('cannot_kick_self');
  const target = doc.players.find((p) => p.id === targetId && p.leftReason !== 'kicked');
  if (!target) fail('player_not_found');
  target.isActive = false;
  target.leftReason = 'kicked';
  doc.finishRequests = doc.finishRequests.filter((request) => request.playerId !== targetId);
  if (doc.status === 'verifying' && doc.activeGuess?.playerId === targetId) cancelActiveGuess(doc, now, 'cancelled');
  checkFinishMajority(doc, now);
  touch(doc, now);
  return doc;
}

export function endGame(input: RoomDoc, userId: string, now: number): { doc: RoomDoc; changed: boolean } {
  const doc = clone(input);
  requireHost(doc, userId);
  if (doc.status === 'finished') return { doc: input, changed: false };
  finishRoom(doc, 'host_ended', now);
  touch(doc, now);
  return { doc, changed: true };
}

export function extendRounds(input: RoomDoc, userId: string, extra: number, now: number): RoomDoc {
  const doc = clone(input);
  requireHost(doc, userId);
  if (doc.status === 'finished') fail('room_finished');
  if (!validRounds(extra)) fail('invalid_rounds');
  doc.configuredRounds = Math.min(MAX_ROUNDS, doc.configuredRounds + extra);
  touch(doc, now);
  return doc;
}

/**
 * Resposta do host ao aviso "O jogo está indo para a última rodada. Deseja adicionar mais?"
 *   extra > 0 → SIM, adiciona rodadas;  extra = 0 → NÃO, a próxima rodada é a última.
 */
export function respondFinalRound(input: RoomDoc, userId: string, extra: number, now: number): RoomDoc {
  const doc = clone(input);
  requireHost(doc, userId);
  if (doc.status === 'waiting' || doc.status === 'finished') fail('not_in_game');
  if ((extra ?? 0) > 0) {
    if (!validRounds(extra)) fail('invalid_rounds');
    doc.configuredRounds = Math.min(MAX_ROUNDS, doc.configuredRounds + extra);
  } else {
    doc.finalPromptAnsweredFor = doc.configuredRounds;
  }
  touch(doc, now);
  return doc;
}

/** "Jogar novamente": o host reinicia a mesma sala (mesmo código e jogadores). */
export function restartRoom(input: RoomDoc, userId: string, rounds: number | null | undefined, now: number): RoomDoc {
  const doc = clone(input);
  requireHost(doc, userId);
  if (doc.status !== 'finished') fail('not_finished');
  if (rounds !== null && rounds !== undefined && !validRounds(rounds)) fail('invalid_rounds');
  Object.assign(doc, {
    status: 'waiting',
    word: null,
    activeGuess: null,
    lastResult: null,
    roundsPlayed: 0,
    decisionOrigin: null,
    decisionNumber: 0,
    finalPromptAnsweredFor: null,
    endReason: null,
    startedAt: null,
    endedAt: null,
    phaseEndsAt: null,
    configuredRounds: rounds ?? doc.configuredRounds,
    usedWords: [],
    finishRequests: [],
    match: doc.match + 1,
  } satisfies Partial<RoomDoc>);
  for (const player of doc.players) player.score = 0;
  touch(doc, now);
  return doc;
}

// -----------------------------------------------------------------------------
// Conexão
// -----------------------------------------------------------------------------

/** Sair da sala. Se era o host, o cargo passa para o próximo na ordem de entrada. */
export function leaveRoom(input: RoomDoc, userId: string, now: number): { doc: RoomDoc; changed: boolean } {
  const doc = clone(input);
  const player = doc.players.find((p) => p.id === userId);
  if (!player || !player.isActive) return { doc: input, changed: false };
  player.isActive = false;
  player.leftReason = 'left';
  doc.finishRequests = doc.finishRequests.filter((request) => request.playerId !== userId);
  if (doc.status === 'verifying' && doc.activeGuess?.playerId === userId) cancelActiveGuess(doc, now, 'cancelled');
  ensureHost(doc);
  if (doc.status !== 'finished' && activePlayers(doc).length === 0) finishRoom(doc, 'abandoned', now);
  else checkFinishMajority(doc, now);
  touch(doc, now);
  return { doc, changed: true };
}

/** Quem estava "sem sinal" e voltou fica ativo de novo (mesmo jogador, mesma pontuação). */
export function reactivate(input: RoomDoc, userId: string, now: number): { doc: RoomDoc; changed: boolean } {
  const player = input.players.find((p) => p.id === userId);
  if (!player || player.isActive || player.leftReason !== 'timeout' || input.status === 'finished') {
    return { doc: input, changed: false };
  }
  if (activePlayers(input).length >= MAX_PLAYERS) return { doc: input, changed: false };
  const doc = clone(input);
  activePlayer(doc, userId);
  touch(doc, now);
  return { doc, changed: true };
}

/**
 * Jogadores sem presença há 30 s ficam inativos (sem perder pontos). Um palpite
 * cujo autor sumiu deixa de travar a partida. Quem chama informa quem sumiu.
 */
export function sweepPlayers(
  input: RoomDoc,
  goneIds: readonly string[],
  now: number,
  options: { guesserGone?: boolean } = {},
): { doc: RoomDoc; changed: boolean } {
  const doc = clone(input);
  let changed = false;
  const gone = new Set(goneIds);
  for (const player of doc.players) {
    if (player.isActive && gone.has(player.id)) {
      player.isActive = false;
      player.leftReason = 'timeout';
      changed = true;
    }
  }
  if (
    doc.status === 'verifying' &&
    doc.activeGuess &&
    (options.guesserGone || !doc.players.find((p) => p.id === doc.activeGuess!.playerId)?.isActive)
  ) {
    cancelActiveGuess(doc, now, 'timeout');
    changed = true;
  }
  if (ensureHost(doc)) changed = true;
  if (doc.status !== 'finished' && activePlayers(doc).length === 0) {
    finishRoom(doc, 'abandoned', now);
    changed = true;
  } else if (changed && checkFinishMajority(doc, now)) {
    changed = true;
  }
  if (changed) touch(doc, now);
  return { doc: changed ? doc : input, changed };
}

// -----------------------------------------------------------------------------
// Estado para a interface (mesmo formato de `get_room_state`)
// -----------------------------------------------------------------------------
const iso = (value: number | null) => (value === null ? null : new Date(value).toISOString());

function toResult(doc: RoomDoc, guess: GuessDoc): GuessResult {
  return {
    id: guess.id,
    player_id: guess.playerId,
    player_name: doc.players.find((p) => p.id === guess.playerId)?.name ?? '',
    text: guess.text,
    status: guess.status === 'verifying' ? 'error' : guess.status,
    result_song: guess.resultSong,
    result_artist: guess.resultArtist,
    matched_excerpt: guess.matchedExcerpt,
    matched_word: guess.matchedWord,
    failure_reason: guess.failureReason,
    verified_at: iso(guess.verifiedAt),
  };
}

export function buildSnapshot(
  doc: RoomDoc,
  userId: string,
  votes: readonly VoteDoc[],
  now: number,
): RoomSnapshot | { kicked: true; server_time: string; room: { id: string; code: string } } {
  const me = doc.players.find((p) => p.id === userId);
  if (!me) throw new RuleError('not_in_room');
  if (me.leftReason === 'kicked') {
    return { kicked: true, server_time: iso(now)!, room: { id: doc.code, code: doc.code } };
  }

  const active = activePlayers(doc);
  const activeIds = new Set(active.map((p) => p.id));
  const word = doc.word;
  const displayRound = word?.roundNumber ?? doc.roundsPlayed + 1;
  const inGame = doc.status !== 'waiting' && doc.status !== 'finished';
  const key = voteKey(doc);
  const currentVotes = key ? votes.filter((vote) => vote.key === key) : [];
  const finishRequests = [...doc.finishRequests]
    .filter((request) => activeIds.has(request.playerId))
    .sort((a, b) => a.at - b.at);

  const currentWord: CurrentWord | null = word
    ? {
        id: `${doc.match}-${word.sequence}`,
        sequence: word.sequence,
        word: word.word,
        status: word.status,
        has_attempt: word.hasAttempt,
        round_number: word.roundNumber,
        display_round: displayRound,
        winner_player_id: word.winnerPlayerId,
      }
    : null;

  const guess = doc.activeGuess;
  const lastResult = doc.lastResult && word && doc.lastResult.wordSequence === word.sequence ? doc.lastResult : null;

  return {
    kicked: false,
    server_time: iso(now)!,
    me: {
      player_id: me.id,
      is_host: me.id === doc.hostPlayerId,
      is_active: me.isActive,
      left_reason: me.leftReason,
    },
    room: {
      id: doc.code,
      code: doc.code,
      status: doc.status,
      phase_ends_at: iso(doc.phaseEndsAt),
      configured_rounds: doc.configuredRounds,
      rounds_played: doc.roundsPlayed,
      host_player_id: doc.hostPlayerId,
      decision_origin: doc.decisionOrigin,
      decision_number: doc.decisionNumber,
      end_reason: doc.endReason,
      state_version: doc.stateVersion,
      started_at: iso(doc.startedAt),
      ended_at: iso(doc.endedAt),
      is_last_round: inGame && displayRound >= doc.configuredRounds,
      final_round_prompt:
        inGame && doc.roundsPlayed >= doc.configuredRounds - 1 && doc.finalPromptAnsweredFor !== doc.configuredRounds,
    },
    players: [...doc.players]
      .filter((p) => p.leftReason !== 'kicked')
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        join_order: p.joinOrder,
        is_active: p.isActive,
        left_reason: p.leftReason === 'kicked' ? null : p.leftReason,
        is_host: p.id === doc.hostPlayerId,
      })),
    active_players: active.length,
    current_word: currentWord,
    active_guess: guess
      ? {
          id: guess.id,
          player_id: guess.playerId,
          player_name: doc.players.find((p) => p.id === guess.playerId)?.name ?? '',
          text: guess.text,
          submitted_at: iso(guess.submittedAt)!,
        }
      : null,
    last_result: lastResult ? toResult(doc, lastResult) : null,
    votes: {
      new_guess: currentVotes.filter((vote) => vote.choice === 'new_guess').length,
      new_word: currentVotes.filter((vote) => vote.choice === 'new_word').length,
      my_choice: currentVotes.find((vote) => vote.playerId === userId)?.choice ?? null,
    },
    finish: {
      count: finishRequests.length,
      needed: Math.floor(active.length / 2) + 1,
      i_requested: finishRequests.some((request) => request.playerId === userId),
      requested_by: finishRequests.map((request) => doc.players.find((p) => p.id === request.playerId)?.name ?? ''),
    },
  };
}

/** Confere se um valor lido do banco tem o formato de uma sala (dados compartilhados não são confiáveis). */
export function isRoomDoc(value: unknown): value is RoomDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<RoomDoc>;
  return (
    doc.v === 1 &&
    typeof doc.code === 'string' &&
    typeof doc.status === 'string' &&
    typeof doc.stateVersion === 'number' &&
    Array.isArray(doc.players) &&
    Array.isArray(doc.usedWords) &&
    Array.isArray(doc.finishRequests)
  );
}

export function isVoteDoc(value: unknown): value is VoteDoc {
  if (!value || typeof value !== 'object') return false;
  const vote = value as Partial<VoteDoc>;
  return (
    typeof vote.playerId === 'string' &&
    typeof vote.key === 'string' &&
    (vote.choice === 'new_guess' || vote.choice === 'new_word')
  );
}
