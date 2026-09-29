/**
 * Verificação musical feita pelo Claude (modo online dentro do Claude).
 * O pedido roda na conta de quem enviou o palpite; aqui ficam o texto enviado
 * e a interpretação da resposta, que nunca é tratada como confiável sem conferência.
 */
import type { GuessDetails, GuessOutcome } from '@/game/online/rules';
import { highlightWord } from '@/utils/highlight';
import { normalizeText } from '@/utils/normalize';

/** Abaixo disso a identificação é incerta demais para dar ponto. */
const MIN_CONFIDENCE = 0.5;
/** Nome de música sugerido pelo Claude só aparece na tela com esta certeza (ou se bater com o que o jogador disse). */
const SHOW_TITLE_CONFIDENCE = 0.75;
const MAX_CANDIDATES = 3;

/**
 * O Claude responde de memória (dentro do artefato não há internet): reconhece bem trechos e
 * títulos, mas às vezes erra ou inventa o NOME da música a partir das palavras do trecho.
 * Por isso o pedido separa "o trecho é de uma música real?" de "qual é o nome dela?", e o app
 * prefere mostrar a música e o artista que o próprio jogador digitou. O Claude não devolve
 * trechos de letra: o trecho exibido é copiado do palpite.
 */
export function buildJudgePrompt(word: string, guess: string): string {
  return [
    'Você é o juiz do jogo musical brasileiro "Uma Palavra, Uma Música". A cada rodada sai uma palavra e os',
    'jogadores citam uma música que tenha essa palavra na letra ou no título.',
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
    '2. Se houver trecho: "lyricsRecognized" diz se você reconhece esse trecho como letra de uma música real, mesmo',
    '   sem ter certeza do nome dela, e "lyricsConfidence" (0 a 1) a certeza disso.',
    `3. "songs": até ${MAX_CANDIDATES} músicas reais que o palpite cita, da mais provável para a menos provável. Se o jogador`,
    '   escreveu nome ou artista, confira essa música primeiro. Só liste músicas que você tem certeza de que existem,',
    '   com título e artista corretos; é melhor deixar a lista vazia do que chutar. Cuidado: um título formado com',
    '   palavras do próprio trecho (ex.: chamar de "Aliança de Prata" uma música só porque o trecho fala de aliança de',
    '   prata) quase sempre é invenção.',
    '4. Para cada música, "hasWord" diz se a palavra sorteada aparece na letra ou no título, e "confidence" (0 a 1) a',
    '   certeza de que é a música citada. Aceite a palavra com ou sem acento, maiúsculas ou minúsculas e no plural',
    '   simples (coração/corações). Não aceite sinônimos, traduções nem palavras que apenas contenham a sorteada',
    '   ("mar" não vale por "amar").',
    '',
    'Responda somente com JSON, sem reproduzir a letra, neste formato:',
    '{"kind": "title" | "lyrics" | "unclear", "lyricsPart": null, "claimedTitle": null, "claimedArtist": null,',
    ' "lyricsRecognized": false, "lyricsConfidence": 0,',
    ' "songs": [{"title": "nome oficial", "artist": "artista principal", "confidence": 0.9, "hasWord": true}]}',
    '"kind" diz se o palpite é principalmente um título (com ou sem artista) ou um trecho da letra.',
  ].join('\n');
}

type Candidate = { title: string; artist: string | null; confidence: number; hasWord: boolean };
type Song = { title: string | null; artist: string | null };

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

/**
 * Qual música mostrar: a sugerida pelo Claude se bater com o que o jogador escreveu; senão, o que o
 * jogador escreveu; senão, a sugestão do Claude só quando ele tem bastante certeza. Nada inventado.
 */
function songToShow(candidates: Candidate[], claimed: Song, preferred?: Candidate): Song | null {
  const claimedSomething = Boolean(claimed.title || claimed.artist);
  const agrees = (song: Candidate) =>
    song.confidence >= MIN_CONFIDENCE && (sameName(song.title, claimed.title) || sameName(song.artist, claimed.artist));
  const agreeing = (preferred && agrees(preferred) ? preferred : undefined) ?? candidates.find(agrees);
  if (agreeing) return agreeing;
  if (claimedSomething) return claimed;
  const sure = preferred ?? candidates[0];
  return sure && sure.confidence >= SHOW_TITLE_CONFIDENCE ? sure : null;
}

/**
 * Converte a resposta do Claude no resultado do palpite (com as mesmas razões usadas pelo servidor):
 * - acerto: o trecho digitado tem a palavra e o Claude o reconhece como letra de uma música real,
 *   ou uma música reconhecida com confiança tem a palavra;
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
  const verdict = raw as Record<string, unknown>;
  const songs = readCandidates(verdict.songs);
  const recognized = songs.filter((song) => song.confidence >= MIN_CONFIDENCE);
  const claimed: Song = { title: text(verdict.claimedTitle, 300), artist: text(verdict.claimedArtist, 300) };
  const hasWord = (value: string) => highlightWord(value, word).some((segment) => segment.highlight);

  const lyrics = lyricsFromGuess(verdict.lyricsPart, guess) ?? (verdict.kind === 'lyrics' ? guess : null);
  const lyricsWithWord = lyrics && hasWord(lyrics) ? lyrics : null;
  const lyricsRecognized =
    (verdict.lyricsRecognized === true && numberOf(verdict.lyricsConfidence) >= MIN_CONFIDENCE) ||
    (verdict.kind === 'lyrics' && recognized.length > 0);

  const winner = recognized.find((song) => song.hasWord);
  if ((lyricsWithWord && lyricsRecognized) || winner) {
    const song = songToShow(songs, claimed, winner);
    return {
      outcome: 'correct',
      details: {
        title: song?.title ?? null,
        artist: song?.artist ?? null,
        // O trecho exibido é o que o jogador digitou, quando ele mostra a palavra.
        excerpt: lyricsWithWord,
        matchedWord: word,
      },
    };
  }
  const best = recognized[0];
  if (best) {
    const song = songToShow(songs, claimed, best);
    return { outcome: 'incorrect', details: { title: song?.title ?? null, artist: song?.artist ?? null, reason: 'word_not_in_song' } };
  }
  if (lyrics && !lyricsWithWord && lyricsRecognized) {
    return { outcome: 'incorrect', details: { reason: 'lyrics_without_word' } };
  }
  if (songs.length > 0 || verdict.lyricsRecognized === true) return { outcome: 'incorrect', details: { reason: 'ambiguous' } };
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
