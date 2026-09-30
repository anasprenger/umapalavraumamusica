/**
 * Verificação musical feita pelo Claude (modo online dentro do Claude).
 * O pedido roda na conta de quem enviou o palpite; aqui ficam o texto enviado
 * e a interpretação da resposta, que nunca é tratada como confiável sem conferência.
 */
import type { GuessDetails, GuessOutcome } from '@/game/online/rules';
import { highlightWord } from '@/utils/highlight';
import { normalizeText } from '@/utils/normalize';

/** Certeza mínima para uma música candidata ser conferida. */
const MIN_CANDIDATE = 0.6;
/** Certeza mínima da segunda conferência para dar o ponto. */
const MIN_CONFIRMED = 0.7;
const MAX_CANDIDATES = 3;

/**
 * Regra do jogo: só vale se o jogo souber DE QUAL MÚSICA é o palpite (título e artista), para
 * ninguém inventar música. O Claude responde de memória (no artefato não há internet), então
 * a verificação tem duas etapas:
 * 1. identificar: quais músicas reais o palpite cita (e o que o jogador disse ser título/artista);
 * 2. conferir: uma pergunta separada, só sobre a música escolhida — ela existe, o palpite é dela
 *    e ela tem a palavra? Só com as duas respostas positivas o palpite vale.
 * O Claude nunca devolve letra: o trecho exibido é copiado do palpite.
 */
export function buildJudgePrompt(word: string, guess: string): string {
  return [
    'Você é o juiz do jogo musical brasileiro "Uma Palavra, Uma Música". A cada rodada sai uma palavra e os',
    'jogadores citam uma música que tenha essa palavra na letra ou no título. Só vale música que existe de verdade.',
    '',
    `Palavra sorteada: ${JSON.stringify(word)}`,
    `Palpite do jogador: ${JSON.stringify(guess)}`,
    '',
    'Como ler o palpite: pode ser o nome da música, nome + artista, um trecho da letra, ou trecho + nome/artista.',
    'Trechos costumam vir de memória: aceite palavras trocadas, faltando ou fora de ordem, erros de digitação,',
    'falta de acentos e grafias do jeito que se canta ("cê", "tô", "pra", "tá"). Considere músicas reais e',
    'publicadas de qualquer época e país, com atenção especial à música brasileira (MPB, sertanejo, pagode,',
    'samba, funk, forró, axé, piseiro, rock nacional, gospel e músicas infantis).',
    '',
    'Tarefa:',
    '1. Separe o palpite: "lyricsPart" é a parte que é letra (copie exatamente do palpite, sem completar);',
    '   "claimedTitle" e "claimedArtist" são o nome da música e o artista que o jogador escreveu (null se não escreveu).',
    `2. "songs": até ${MAX_CANDIDATES} músicas reais de onde o palpite pode ser, da mais provável para a menos provável.`,
    '   Se o palpite é um trecho, diga de qual música o trecho é. Se o jogador escreveu nome ou artista, confira essa',
    '   música primeiro. Só liste músicas que você tem certeza de que existem, com título e artista corretos; é',
    '   melhor deixar a lista vazia do que chutar. Cuidado: um título formado com palavras do próprio trecho (ex.:',
    '   chamar de "Aliança de Prata" uma música só porque o trecho fala de aliança de prata) quase sempre é invenção.',
    '3. Para cada música, "hasWord" diz se a palavra sorteada aparece na letra ou no título, e "confidence" (0 a 1)',
    '   a certeza de que o palpite é dessa música. Aceite a palavra com ou sem acento, maiúsculas ou minúsculas e no',
    '   plural simples (coração/corações). Não aceite sinônimos, traduções nem palavras que apenas contenham a',
    '   sorteada ("mar" não vale por "amar").',
    '',
    'Responda somente com JSON, sem reproduzir a letra, neste formato:',
    '{"kind": "title" | "lyrics" | "unclear", "lyricsPart": null, "claimedTitle": null, "claimedArtist": null,',
    ' "songs": [{"title": "nome oficial", "artist": "artista principal", "confidence": 0.9, "hasWord": true}]}',
  ].join('\n');
}

/** Segunda etapa: uma pergunta direta sobre a música escolhida. */
export function buildConfirmPrompt(word: string, guess: string, song: Song): string {
  const artist = song.artist ? ` de ${JSON.stringify(song.artist)}` : ' (artista não informado)';
  return [
    'Você confere respostas do jogo musical "Uma Palavra, Uma Música". Seja rigoroso: na dúvida, responda false.',
    '',
    `Música: ${JSON.stringify(song.title)}${artist}`,
    `Palpite do jogador: ${JSON.stringify(guess)}`,
    `Palavra sorteada: ${JSON.stringify(word)}`,
    '',
    'Responda:',
    '- "exists": essa música existe de verdade, gravada e publicada por esse artista (ou, sem artista informado, por',
    '  algum artista)? Não confunda com músicas de nome parecido nem com outro artista.',
    '- "artist": o artista principal que gravou essa música (null se ela não existe).',
    '- "matches": o palpite é dessa música? Vale o título dela, ou um trecho da letra dela escrito de memória',
    '  (pequenas diferenças são aceitas). Um trecho de OUTRA música não vale.',
    '- "hasWord": a palavra sorteada aparece na letra ou no título dessa música (com ou sem acento, ou no plural',
    '  simples)? Sinônimos e palavras que apenas contenham a sorteada não valem.',
    '- "confidence": de 0 a 1, a sua certeza nas respostas acima.',
    '',
    'Responda somente com JSON, sem reproduzir a letra:',
    '{"exists": true, "artist": "artista", "matches": true, "hasWord": true, "confidence": 0.9}',
  ].join('\n');
}

type Candidate = { title: string; artist: string | null; confidence: number; hasWord: boolean };
export type Song = { title: string; artist: string | null };
type Result = { outcome: GuessOutcome; details: GuessDetails };

/** O que fazer depois da primeira etapa: já há um resultado, ou falta conferir uma música. */
export type JudgePlan = { result: Result } | { confirm: Song; lyrics: string | null };

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'null' ? value.trim().slice(0, max) : null;

const numberOf = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function readCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: Candidate[] = [];
  for (const item of value.slice(0, MAX_CANDIDATES)) {
    if (!item || typeof item !== 'object') continue;
    const song = item as Record<string, unknown>;
    const title = text(song.title, 300);
    if (!title) continue;
    candidates.push({
      title,
      artist: text(song.artist, 300),
      confidence: numberOf(song.confidence),
      hasWord: song.hasWord === true,
    });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

const FILLER = new Set(['e', 'and', 'feat', 'ft', 'part', 'com', 'the', 'de', 'da', 'do', 'a', 'o']);

/** Nomes parecidos ("Zé Neto & Cristiano" × "ze neto e cristiano"), ignorando acentos e conectivos. */
export function sameName(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const tokens = (value: string) => normalizeText(value).split(' ').filter((token) => token && !FILLER.has(token));
  const [short, long] = [tokens(a), tokens(b)].sort((x, y) => x.length - y.length);
  if (short.length === 0) return false;
  const found = short.filter((token) => long.includes(token)).length;
  return found / short.length >= 0.6;
}

/** O trecho só vale se foi mesmo copiado do palpite (o Claude não pode acrescentar letra). */
function lyricsFromGuess(value: unknown, guess: string): string | null {
  const part = text(value, 200);
  if (!part) return null;
  return normalizeText(guess).includes(normalizeText(part)) ? part : null;
}

const incorrect = (reason: string, song?: Partial<Song> | null): Result => ({
  outcome: 'incorrect',
  details: { reason, title: song?.title ?? null, artist: song?.artist ?? null },
});

/**
 * Primeira etapa: escolhe a música a conferir.
 * - O jogador disse o título: confere exatamente essa música (com o artista dito, ou o que o Claude reconheceu).
 * - Disse só o artista: confere a música desse artista que o Claude reconheceu.
 * - Não disse nada: confere a música mais provável que o Claude reconheceu com a palavra.
 * Sem música identificada, o palpite não vale.
 */
export function planJudgement(raw: unknown, word: string, guess: string): JudgePlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { result: { outcome: 'error', details: { reason: 'invalid_answer' } } };
  }
  const verdict = raw as Record<string, unknown>;
  const songs = readCandidates(verdict.songs);
  const likely = songs.filter((song) => song.confidence >= MIN_CANDIDATE);
  const claimedTitle = text(verdict.claimedTitle, 300);
  const claimedArtist = text(verdict.claimedArtist, 300);
  const lyrics = lyricsFromGuess(verdict.lyricsPart, guess) ?? (verdict.kind === 'lyrics' ? guess : null);

  if (claimedTitle) {
    const known = songs.find(
      (song) => sameName(song.title, claimedTitle) && (!claimedArtist || sameName(song.artist, claimedArtist)),
    );
    return { confirm: { title: known?.title ?? claimedTitle, artist: claimedArtist ?? known?.artist ?? null }, lyrics };
  }
  if (claimedArtist) {
    const byArtist = likely.filter((song) => sameName(song.artist, claimedArtist));
    const pick = byArtist.find((song) => song.hasWord) ?? byArtist[0];
    return pick ? { confirm: pick, lyrics } : { result: incorrect('no_match') };
  }
  const pick = likely.find((song) => song.hasWord);
  if (pick) return { confirm: pick, lyrics };
  if (likely[0]) return { result: incorrect('word_not_in_song', likely[0]) };
  return { result: incorrect(songs.length > 0 ? 'ambiguous' : 'no_match') };
}

/** Segunda etapa: só dá o ponto se a música existe, o palpite é dela e ela tem a palavra. */
export function interpretConfirmation(raw: unknown, word: string, song: Song, lyrics: string | null): Result {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { outcome: 'error', details: { reason: 'invalid_answer' } };
  }
  const answer = raw as Record<string, unknown>;
  const sure = numberOf(answer.confidence) >= MIN_CONFIRMED;
  const confirmed = { title: song.title, artist: song.artist ?? text(answer.artist, 300) };

  if (answer.exists !== true || !sure) return incorrect('song_not_found', confirmed);
  if (answer.matches !== true) return incorrect('song_mismatch', confirmed);
  const lyricsWithWord = lyrics && highlightWord(lyrics, word).some((segment) => segment.highlight) ? lyrics : null;
  if (answer.hasWord !== true && !lyricsWithWord) return incorrect('word_not_in_song', confirmed);
  return {
    outcome: 'correct',
    details: {
      title: confirmed.title,
      artist: confirmed.artist,
      // O trecho exibido é o que o jogador digitou, quando ele mostra a palavra.
      excerpt: lyricsWithWord,
      matchedWord: word,
    },
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
