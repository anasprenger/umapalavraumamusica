/**
 * Verificação musical com o Gemini (Firebase AI Logic) e BUSCA NO GOOGLE.
 *
 * Diferente da versão dentro do Claude (que só tem a memória do modelo), aqui o Gemini
 * pesquisa na web para descobrir de qual música é o palpite e conferir a letra. Regra do
 * jogo: só vale se a música for identificada (título e artista) e confirmada por páginas
 * encontradas na busca — assim ninguém inventa música.
 */
import type { GuessDetails, GuessOutcome, GuessSource } from '@/game/online/rules';
import { highlightWord } from '@/utils/highlight';

import { lyricsFromGuess, parseJsonAnswer, sameName } from './claudeJudge';

/** Certeza mínima para dar o ponto. */
const MIN_CONFIDENCE = 0.7;
const MAX_SOURCES = 3;

export function buildGeminiPrompt(word: string, guess: string): string {
  return [
    'Você é o juiz do jogo musical brasileiro "Uma Palavra, Uma Música". A cada rodada sai uma palavra e os',
    'jogadores citam uma música que tenha essa palavra na letra ou no título. Só vale música que existe de verdade.',
    '',
    `Palavra sorteada: ${JSON.stringify(word)}`,
    `Palpite do jogador: ${JSON.stringify(guess)}`,
    '',
    'O palpite pode ser o nome da música, nome + artista, um trecho da letra, ou trecho + nome/artista. Trechos',
    'costumam vir de memória, com pequenas diferenças, erros de digitação, sem acentos ou do jeito que se canta.',
    '',
    'Use a busca do Google para descobrir de qual música real o palpite é:',
    '- pesquise o trecho da letra (entre aspas e sem aspas) e o nome/artista citados;',
    '- confirme em sites de letras (por exemplo Letras.mus.br, Vagalume, Musixmatch, Genius) que a música existe,',
    '  que o trecho é dela e se a palavra sorteada aparece na letra ou no título;',
    '- se o jogador disse o nome ou o artista, confira se o trecho é mesmo dessa música/desse artista;',
    '- nunca invente: se a busca não confirmar, responda found false.',
    'A palavra vale com ou sem acento, maiúsculas ou minúsculas e no plural simples (coração/corações). Sinônimos,',
    'traduções e palavras que apenas contenham a sorteada ("mar" não vale por "amar") não valem.',
    '',
    'No fim, responda com um bloco JSON (sem reproduzir a letra) neste formato:',
    '```json',
    '{"found": true, "title": "nome oficial", "artist": "artista principal", "matchesGuess": true, "hasWord": true,',
    ' "lyricsPart": "parte do palpite que é letra, copiada do palpite, ou null", "claimedTitle": null,',
    ' "claimedArtist": null, "confidence": 0.9}',
    '```',
    '"matchesGuess" diz se o palpite é mesmo dessa música; "claimedTitle"/"claimedArtist" são o nome e o artista',
    'que o jogador escreveu (null se não escreveu).',
  ].join('\n');
}

/** O que a resposta do Gemini traz além do texto: as páginas usadas na busca. */
export type Grounding = { sources: GuessSource[]; searchHtml: string | null };

type GroundingMetadataLike = {
  groundingChunks?: { web?: { uri?: string; title?: string } }[];
  searchEntryPoint?: { renderedContent?: string };
};

/** Extrai as páginas e as sugestões de busca do Google de uma resposta com busca. */
export function readGrounding(metadata: GroundingMetadataLike | null | undefined): Grounding {
  const sources: GuessSource[] = [];
  for (const chunk of metadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri;
    if (!uri || sources.some((source) => source.uri === uri)) continue;
    sources.push({ uri, title: (chunk.web?.title || uri).slice(0, 120) });
    if (sources.length >= MAX_SOURCES) break;
  }
  return { sources, searchHtml: metadata?.searchEntryPoint?.renderedContent ?? null };
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'null' ? value.trim().slice(0, max) : null;

/**
 * Decide o palpite a partir da resposta do Gemini. Só dá o ponto quando a música foi
 * identificada, confirmada pela busca (há páginas na resposta), o palpite é dela, bate com o
 * nome/artista que o jogador disse e a música tem a palavra.
 */
export function interpretGemini(
  answerText: string,
  word: string,
  guess: string,
  grounding: Grounding,
): { outcome: GuessOutcome; details: GuessDetails } {
  const raw = parseJsonAnswer(answerText);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { outcome: 'error', details: { reason: 'invalid_answer' } };
  }
  const answer = raw as Record<string, unknown>;
  const title = text(answer.title, 300);
  const artist = text(answer.artist, 300);
  const confidence = Number(answer.confidence ?? 0);
  const claimedTitle = text(answer.claimedTitle, 300);
  const claimedArtist = text(answer.claimedArtist, 300);
  const evidence = { sources: grounding.sources, searchHtml: grounding.searchHtml };
  const incorrect = (reason: string, song?: { title: string | null; artist: string | null }) => ({
    outcome: 'incorrect' as const,
    details: { reason, title: song?.title ?? null, artist: song?.artist ?? null, ...evidence },
  });

  if (answer.found !== true || !title) {
    return incorrect('no_match', claimedTitle ? { title: claimedTitle, artist: claimedArtist } : undefined);
  }
  // Sem páginas da busca, a resposta veio só da memória do modelo: não dá para confirmar.
  if (grounding.sources.length === 0) return { outcome: 'error', details: { reason: 'not_verified' } };

  const song = { title, artist };
  if ((claimedTitle && !sameName(title, claimedTitle)) || (claimedArtist && !sameName(artist, claimedArtist))) {
    return incorrect('song_mismatch', { title: claimedTitle ?? title, artist: claimedArtist ?? artist });
  }
  if (answer.matchesGuess !== true) return incorrect('song_mismatch', song);
  if (!(confidence >= MIN_CONFIDENCE)) return incorrect('ambiguous');

  const lyrics = lyricsFromGuess(answer.lyricsPart, guess);
  const lyricsWithWord = lyrics && highlightWord(lyrics, word).some((segment) => segment.highlight) ? lyrics : null;
  if (answer.hasWord !== true && !lyricsWithWord) return incorrect('word_not_in_song', song);

  return {
    outcome: 'correct',
    details: { title, artist, excerpt: lyricsWithWord, matchedWord: word, ...evidence },
  };
}

/** Motivo amigável para uma falha ao chamar o Gemini (o palpite não conta e o jogo segue). */
export function geminiFailureReason(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = String((error as { message?: string } | null)?.message ?? '');
  if (/429|quota|RESOURCE_EXHAUSTED|rate/i.test(message)) return 'ai_rate_limited';
  if (code === 'AI/api-not-enabled' || code.endsWith('api-not-enabled') || /not.?enabled|PERMISSION_DENIED/i.test(message)) {
    return 'ai_service_unavailable';
  }
  if (code.endsWith('fetch-error')) return 'provider_unavailable';
  return 'provider_unavailable';
}
