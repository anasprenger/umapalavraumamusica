/**
 * Pontuação de correspondência entre o palpite e uma música (0 a 1).
 * Funções puras: fáceis de testar e independentes da fonte musical.
 */
import { findWord, lyricsLines, tokenize, tokensMatch } from './text.ts';

/** A partir daqui a correspondência é considerada clara. */
export const CLEAR_MATCH = 0.8;
/** Correspondência possível, porém ambígua (pode ir para a IA, se habilitada). */
export const PARTIAL_MATCH = 0.6;
/** Trechos de letra com menos palavras que isso não identificam uma música com segurança. */
export const MIN_LYRICS_TOKENS = 3;

/** Posição de `needle` como sequência contínua dentro de `haystack` (com tolerância), ou -1. */
export function findSequence(haystack: readonly string[], needle: readonly string[]): number {
  if (!needle.length || needle.length > haystack.length) return -1;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, offset) => tokensMatch(token, haystack[start + offset]))) return start;
  }
  return -1;
}

/** Maior subsequência comum (em ordem), com tolerância a pequenos erros. */
function fuzzyLcs(a: readonly string[], b: readonly string[]): number {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i][j] = tokensMatch(a[i - 1], b[j - 1])
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table[a.length][b.length];
}

/** Quanto o palpite corresponde ao título da música. */
export function titleScore(guess: readonly string[], title: readonly string[]): number {
  if (!guess.length || !title.length) return 0;
  if (guess.length === title.length && guess.every((token, i) => tokensMatch(token, title[i]))) return 1;

  // Título de uma palavra curta ("Sol") dentro de uma frase longa é pouco conclusivo.
  const distinctiveTitle = title.length >= 2 || title[0].length >= 5;

  // Palpite = título + outras palavras (artista, trecho da letra...).
  if (guess.length > title.length && findSequence(guess, title) >= 0) {
    return distinctiveTitle ? 0.85 : 0.6;
  }

  // Palpite = parte do título.
  if (title.length > guess.length && findSequence(title, guess) >= 0) {
    const coverage = guess.length / title.length;
    if (guess.length >= 2 && coverage >= 0.5) return 0.7 + 0.2 * coverage;
    return 0.2 + 0.5 * coverage;
  }

  const common = fuzzyLcs(guess, title);
  return (0.9 * (2 * common)) / (guess.length + title.length);
}

export type LyricsMatch = { score: number; lineIndex: number };

function alignInLyrics(guess: readonly string[], lines: readonly string[]): LyricsMatch {
  const tokens: string[] = [];
  const lineOf: number[] = [];
  lines.forEach((line, index) => {
    for (const token of tokenize(line)) {
      tokens.push(token);
      lineOf.push(index);
    }
  });

  let best: LyricsMatch = { score: 0, lineIndex: -1 };
  for (let start = 0; start < tokens.length; start += 1) {
    const firstMatches = tokensMatch(tokens[start], guess[0]);
    if (!firstMatches && !(guess.length > 2 && tokensMatch(tokens[start], guess[1]))) continue;

    // Alinhamento guloso: tolera uma palavra a mais/a menos entre palpite e letra.
    let g = firstMatches ? 0 : 1;
    let k = start;
    let matched = 0;
    const limit = start + guess.length + 3;
    while (g < guess.length && k < tokens.length && k < limit) {
      if (tokensMatch(guess[g], tokens[k])) {
        matched += 1;
        g += 1;
        k += 1;
      } else if (g + 1 < guess.length && tokensMatch(guess[g + 1], tokens[k])) {
        g += 1;
      } else {
        k += 1;
      }
    }
    const score = matched / guess.length;
    if (score > best.score) best = { score, lineIndex: lineOf[start] };
    if (score === 1) break;
  }
  return best;
}

/** Quanto o palpite corresponde a um trecho da letra. */
export function lyricsScore(guess: readonly string[], lyrics: string): LyricsMatch {
  if (guess.length < MIN_LYRICS_TOKENS) return { score: 0, lineIndex: -1 };
  return alignInLyrics(guess, lyricsLines(lyrics));
}

/** Palpite no formato "título + trecho" (ou "trecho + título"). */
export function comboScore(guess: readonly string[], title: readonly string[], lyrics: string): LyricsMatch {
  const none = { score: 0, lineIndex: -1 };
  if (!title.length || guess.length < title.length + 2) return none;
  const lines = lyricsLines(lyrics);
  const tryRest = (rest: readonly string[]) => {
    const match = alignInLyrics(rest, lines);
    return match.score >= 0.75 ? { score: 0.95, lineIndex: match.lineIndex } : none;
  };
  if (title.every((token, i) => tokensMatch(token, guess[i]))) {
    const result = tryRest(guess.slice(title.length));
    if (result.score) return result;
  }
  const offset = guess.length - title.length;
  if (title.every((token, i) => tokensMatch(token, guess[offset + i]))) {
    return tryRest(guess.slice(0, offset));
  }
  return none;
}

export type Excerpt = { excerpt: string; word: string };

/**
 * Linha da letra que contém a palavra sorteada. Se o palpite foi um trecho,
 * prefere a ocorrência mais próxima dele.
 */
export function findExcerpt(lyrics: string, forms: Set<string>, nearLine = -1): Excerpt | null {
  const lines = lyricsLines(lyrics);
  const hits: { index: number; word: string }[] = [];
  lines.forEach((line, index) => {
    const word = findWord(tokenize(line), forms);
    if (word) hits.push({ index, word });
  });
  if (!hits.length) return null;

  let hit = hits[0];
  if (nearLine >= 0) {
    hit = hits.reduce((closest, current) =>
      Math.abs(current.index - nearLine) < Math.abs(closest.index - nearLine) ? current : closest,
    );
  }
  let excerpt = lines[hit.index];
  const next = lines[hit.index + 1];
  if (excerpt.length < 28 && next) excerpt = `${excerpt} / ${next}`;
  if (excerpt.length > 160) excerpt = `${excerpt.slice(0, 157).trimEnd()}…`;
  return { excerpt, word: hit.word };
}
