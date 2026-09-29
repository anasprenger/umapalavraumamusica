/**
 * Verificação musical feita pelo Claude (modo online dentro do Claude).
 * O pedido roda na conta de quem enviou o palpite; aqui ficam o texto enviado
 * e a interpretação da resposta, que nunca é tratada como confiável sem conferência.
 */
import type { GuessDetails, GuessOutcome } from '@/game/online/rules';
import { highlightWord } from '@/utils/highlight';

/** Abaixo disso a identificação é incerta demais para dar ponto. */
const MIN_CONFIDENCE = 0.5;
const MAX_CANDIDATES = 3;

/**
 * O pedido não pede trechos de letra de volta (o Claude costuma evitar reproduzir letras e,
 * quando tenta de memória, pode inventar). Em vez disso ele lista as músicas que o palpite
 * pode estar citando, e o app decide. O trecho mostrado na tela é o que o próprio jogador digitou.
 */
export function buildJudgePrompt(word: string, guess: string): string {
  return [
    'Você é o juiz do jogo musical brasileiro "Uma Palavra, Uma Música". A cada rodada sai uma palavra e os',
    'jogadores citam uma música que tenha essa palavra na letra ou no título.',
    '',
    `Palavra sorteada: ${JSON.stringify(word)}`,
    `Palpite do jogador: ${JSON.stringify(guess)}`,
    '',
    'Como ler o palpite: pode ser o nome da música, nome + artista, um trecho da letra ou trecho + artista.',
    'Trechos costumam vir de memória: aceite palavras trocadas, faltando ou fora de ordem, erros de digitação,',
    'falta de acentos e grafias do jeito que se canta ("cê", "tô", "pra", "tá"). Considere músicas reais e',
    'publicadas de qualquer época e país, com atenção especial à música brasileira (MPB, sertanejo, pagode,',
    'samba, funk, forró, axé, piseiro, rock nacional, gospel e músicas infantis).',
    '',
    'Tarefa:',
    `1. Liste até ${MAX_CANDIDATES} músicas reais que o palpite pode estar citando, da mais provável para a menos provável.`,
    '   Pense no título, no refrão e nos versos mais conhecidos. Se o palpite citar um artista, considere só músicas',
    '   gravadas por ele (incluindo regravações famosas). Nunca invente músicas: se não reconhecer, deixe a lista vazia.',
    '2. Para cada música, diga se a palavra sorteada aparece na letra ou no título. Aceite a mesma palavra com ou sem',
    '   acento, maiúsculas ou minúsculas e no plural simples (coração/corações). Não aceite sinônimos, traduções nem',
    '   palavras diferentes que apenas contenham a sorteada ("mar" não vale por "amar").',
    '3. Dê a confiança (0 a 1) de que o palpite realmente se refere àquela música.',
    '',
    'Responda somente com JSON, sem reproduzir a letra, neste formato:',
    '{"kind": "title" | "lyrics" | "unclear", "songs": [{"title": "nome oficial", "artist": "artista principal",',
    ' "confidence": 0.9, "hasWord": true}]}',
    '"kind" diz se o palpite é principalmente um título (com ou sem artista) ou um trecho da letra.',
  ].join('\n');
}

type Candidate = { title: string; artist: string | null; confidence: number; hasWord: boolean };

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'null' ? value.trim().slice(0, max) : null;

function readCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: Candidate[] = [];
  for (const item of value.slice(0, MAX_CANDIDATES)) {
    if (!item || typeof item !== 'object') continue;
    const song = item as Record<string, unknown>;
    const title = text(song.title, 300);
    if (!title) continue;
    const confidence = typeof song.confidence === 'number' ? song.confidence : Number(song.confidence ?? 0);
    candidates.push({
      title,
      artist: text(song.artist, 300),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      hasWord: song.hasWord === true,
    });
  }
  return candidates;
}

/**
 * Converte a resposta do Claude no resultado do palpite (com as mesmas razões usadas pelo servidor):
 * - acerto: alguma música reconhecida com confiança tem a palavra (ou o trecho digitado, que o
 *   Claude reconheceu como daquela música, já contém a palavra);
 * - erro: a música reconhecida não tem a palavra, a identificação ficou incerta ou nada foi reconhecido.
 */
export function interpretVerdict(
  raw: unknown,
  word: string,
  guess: string,
): { outcome: GuessOutcome; details: GuessDetails } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { outcome: 'error', details: { reason: 'invalid_answer' } };
  }
  const verdict = raw as { kind?: unknown; songs?: unknown };
  const songs = readCandidates(verdict.songs).sort((a, b) => b.confidence - a.confidence);
  const recognized = songs.filter((song) => song.confidence >= MIN_CONFIDENCE);
  const lyricsGuess = verdict.kind === 'lyrics';
  const guessHasWord = highlightWord(guess, word).some((segment) => segment.highlight);

  const winner = recognized.find((song) => song.hasWord || (lyricsGuess && guessHasWord));
  if (winner) {
    return {
      outcome: 'correct',
      details: {
        title: winner.title,
        artist: winner.artist,
        // O trecho exibido é o que o jogador digitou, quando ele mostra a palavra.
        excerpt: lyricsGuess && guessHasWord ? guess : null,
        matchedWord: word,
      },
    };
  }
  const best = recognized[0];
  if (best) return { outcome: 'incorrect', details: { title: best.title, artist: best.artist, reason: 'word_not_in_song' } };
  if (songs.length > 0) return { outcome: 'incorrect', details: { reason: 'ambiguous' } };
  return { outcome: 'incorrect', details: { reason: 'no_match' } };
}

/**
 * Lê o JSON de uma resposta em texto (para apps do Claude sem `sample.json`): a resposta
 * inteira, o conteúdo de um bloco ```json``` ou o trecho do primeiro `{` ao último `}`.
 */
export function parseJsonAnswer(text: string): unknown {
  const candidates = [text, /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1]];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // tenta o próximo formato
    }
  }
  return null;
}

/** Motivo amigável para uma falha do pedido ao Claude (o palpite não conta e o jogo segue). */
export function sampleFailureReason(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case 'not_granted':
      return 'ai_not_allowed';
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return 'ai_unavailable';
    case 'rate_limited':
      return 'ai_rate_limited';
    case 'session_expired':
      return 'ai_session_expired';
    case 'invalid_json':
    case 'empty_completion':
    case 'refused':
      return 'invalid_answer';
    default:
      return 'provider_unavailable';
  }
}
