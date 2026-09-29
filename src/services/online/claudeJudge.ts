/**
 * Verificação musical feita pelo Claude (modo online dentro do Claude).
 * O pedido roda na conta de quem enviou o palpite; aqui ficam o texto enviado
 * e a interpretação da resposta, que nunca é tratada como confiável sem conferência.
 */
import type { GuessDetails, GuessOutcome } from '@/game/online/rules';
import { highlightWord } from '@/utils/highlight';

/** Abaixo disso a identificação é incerta demais para dar ponto. */
const MIN_CONFIDENCE = 0.6;

export function buildJudgePrompt(word: string, guess: string): string {
  return [
    'Você é o juiz do jogo musical brasileiro "Uma Palavra, Uma Música".',
    'Os jogadores recebem uma palavra sorteada e precisam citar uma música que contenha essa palavra.',
    '',
    `Palavra sorteada: ${JSON.stringify(word)}`,
    `Palpite do jogador: ${JSON.stringify(guess)}`,
    '',
    'O palpite pode ser o nome da música, nome + artista, ou um trecho da letra. Tolere erros de digitação,',
    'falta de acentos e pequenas diferenças no trecho. Considere músicas reais e publicadas de qualquer país e época.',
    '',
    'Decida:',
    '1. songFound: o palpite identifica com clareza uma música real? Se houver várias, escolha a mais conhecida',
    '   que combine com o palpite (prefira uma que contenha a palavra).',
    '2. wordInSong: a palavra sorteada aparece na LETRA ou no TÍTULO dessa música? Aceite a mesma palavra com ou',
    '   sem acento, em maiúsculas ou minúsculas e no plural simples (ex.: coração/corações). NÃO aceite sinônimos,',
    '   traduções, outras palavras parecidas nem palavras que apenas contenham a sorteada ("mar" não vale por "amar").',
    '3. Seja honesto: se não tiver certeza de que a palavra está na música, use wordInSong false e confiança baixa.',
    '',
    'Responda somente com um objeto JSON neste formato:',
    '{"songFound": true, "title": "nome oficial", "artist": "artista principal", "wordInSong": true,',
    ' "excerpt": "um verso curto (no máximo 12 palavras) da música que contenha a palavra, ou null",',
    ' "confidence": 0.9}',
  ].join('\n');
}

type Verdict = {
  songFound?: unknown;
  title?: unknown;
  artist?: unknown;
  wordInSong?: unknown;
  excerpt?: unknown;
  confidence?: unknown;
};

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'null' ? value.trim().slice(0, max) : null;

/** Converte a resposta do Claude no resultado do palpite (com as mesmas razões usadas pelo servidor). */
export function interpretVerdict(raw: unknown, word: string): { outcome: GuessOutcome; details: GuessDetails } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { outcome: 'error', details: { reason: 'invalid_answer' } };
  }
  const verdict = raw as Verdict;
  const title = text(verdict.title, 300);
  const artist = text(verdict.artist, 300);
  const confidence = typeof verdict.confidence === 'number' ? verdict.confidence : Number(verdict.confidence ?? 0);

  if (verdict.songFound !== true || !title) return { outcome: 'incorrect', details: { reason: 'no_match' } };
  if (!(confidence >= MIN_CONFIDENCE)) return { outcome: 'incorrect', details: { title, artist, reason: 'ambiguous' } };
  if (verdict.wordInSong !== true) {
    return { outcome: 'incorrect', details: { title, artist, reason: 'word_not_in_song' } };
  }

  // O trecho só aparece se realmente mostrar a palavra (senão fica só o nome da música).
  const excerpt = text(verdict.excerpt, 200);
  const showsWord = excerpt ? highlightWord(excerpt, word).some((segment) => segment.highlight) : false;
  return {
    outcome: 'correct',
    details: { title, artist, excerpt: showsWord ? excerpt : null, matchedWord: word },
  };
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
