/**
 * MusicSearchService — verifica se um palpite identifica uma música real
 * que contém a palavra sorteada.
 *
 * Fluxo (a IA é opcional e só entra em caso de ambiguidade):
 *   palpite → fonte musical (candidatos reais) → regras de correspondência
 *     → correspondência clara? resultado
 *     → só possibilidades parciais? IA escolhe entre os candidatos reais (se habilitada)
 *
 * Regra da rodada: a palavra NÃO precisa estar no palpite; ela precisa estar
 * na música encontrada (título ou letra). Com vários resultados, vale a
 * primeira correspondência VÁLIDA, não o primeiro resultado bruto.
 */
import {
  CLEAR_MATCH,
  comboScore,
  findExcerpt,
  lyricsScore,
  MIN_LYRICS_TOKENS,
  PARTIAL_MATCH,
  titleScore,
} from './matcher.ts';
import { cleanTitle, findWord, normalizeText, tokenize, wordForms } from './text.ts';
import {
  type Disambiguator,
  type LyricsResult,
  type MatchedBy,
  type MusicProvider,
  MusicProviderError,
  type MusicVerificationFound,
  type MusicVerificationResult,
  type TrackCandidate,
  type VerifyInput,
  type WordLocation,
} from './types.ts';

type SearchSource = 'title' | 'lyrics' | 'any';

type RankedCandidate = TrackCandidate & { sources: Partial<Record<SearchSource, number>> };

type Evaluation = {
  candidate: RankedCandidate;
  guessScore: number;
  matchedBy: MatchedBy;
  wordLocation: WordLocation | null;
  matchedWord: string | null;
  excerpt: string | null;
};

export type MusicSearchOptions = {
  disambiguator?: Disambiguator | null;
  /** Quantos resultados de cada busca considerar. */
  searchLimit?: number;
  /** Quantos candidatos avaliar no máximo (limita chamadas à API). */
  maxCandidates?: number;
  logger?: Pick<Console, 'warn'>;
};

export class MusicSearchService {
  private readonly disambiguator: Disambiguator | null;
  private readonly searchLimit: number;
  private readonly maxCandidates: number;
  private readonly logger: Pick<Console, 'warn'>;

  constructor(
    private readonly provider: MusicProvider,
    options: MusicSearchOptions = {},
  ) {
    this.disambiguator = options.disambiguator ?? null;
    this.searchLimit = options.searchLimit ?? 8;
    this.maxCandidates = options.maxCandidates ?? 8;
    this.logger = options.logger ?? console;
  }

  async verify({ guess, targetWord }: VerifyInput): Promise<MusicVerificationResult> {
    const guessTokens = tokenize(guess);
    const forms = wordForms(targetWord);
    if (!guessTokens.length || !forms.size) return { found: false, reason: 'no_match' };

    const candidates = await this.searchCandidates(guess, guessTokens.length);
    if (!candidates.length) return { found: false, reason: 'no_match' };

    const partials: Evaluation[] = [];
    let withoutWord: Evaluation | null = null;

    for (const candidate of candidates.slice(0, this.maxCandidates)) {
      const evaluation = await this.evaluate(candidate, guessTokens, targetWord, forms);
      if (!evaluation) continue;
      if (evaluation.guessScore >= CLEAR_MATCH) {
        if (evaluation.wordLocation) return this.toFound(evaluation, 'rules');
        withoutWord ??= evaluation;
      } else if (evaluation.guessScore >= PARTIAL_MATCH && evaluation.wordLocation) {
        partials.push(evaluation);
      }
    }

    if (partials.length && this.disambiguator) {
      const chosen = await this.askDisambiguator(guess, targetWord, partials);
      if (chosen) return this.toFound(chosen, 'ai');
    }

    if (withoutWord) {
      return {
        found: false,
        reason: 'word_not_in_song',
        title: withoutWord.candidate.title,
        artist: withoutWord.candidate.artist,
      };
    }
    return { found: false, reason: partials.length ? 'ambiguous' : 'no_match' };
  }

  /** Busca por título, por letra e geral; junta os resultados sem repetir músicas. */
  private async searchCandidates(guess: string, tokenCount: number): Promise<RankedCandidate[]> {
    const limit = this.searchLimit;
    const searches: [SearchSource, Promise<TrackCandidate[]>][] = [
      ['title', this.provider.searchTracks({ title: guess, limit })],
      ['any', this.provider.searchTracks({ any: guess, limit })],
    ];
    if (tokenCount >= MIN_LYRICS_TOKENS) {
      searches.splice(1, 0, ['lyrics', this.provider.searchTracks({ lyrics: guess, limit })]);
    }

    const settled = await Promise.allSettled(searches.map(([, promise]) => promise));
    if (settled.every((result) => result.status === 'rejected')) {
      const reason = (settled[0] as PromiseRejectedResult).reason;
      throw reason instanceof MusicProviderError ? reason : new MusicProviderError(String(reason));
    }

    const byKey = new Map<string, RankedCandidate>();
    const ordered: RankedCandidate[] = [];
    settled.forEach((result, index) => {
      if (result.status !== 'fulfilled') {
        this.logger.warn('[music] busca parcial falhou', searches[index][0], result.reason);
        return;
      }
      const source = searches[index][0];
      result.value.forEach((track, rank) => {
        const key = `${normalizeText(cleanTitle(track.title))}|${normalizeText(track.artist)}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.sources[source] ??= rank;
          return;
        }
        const ranked: RankedCandidate = { ...track, sources: { [source]: rank } };
        byKey.set(key, ranked);
        ordered.push(ranked);
      });
    });
    return ordered;
  }

  private async evaluate(
    candidate: RankedCandidate,
    guess: string[],
    targetWord: string,
    forms: Set<string>,
  ): Promise<Evaluation | null> {
    const fullTitle = tokenize(candidate.title);
    const shortTitle = tokenize(cleanTitle(candidate.title));
    const byTitle = Math.max(titleScore(guess, fullTitle), titleScore(guess, shortTitle));
    const wordInTitle = findWord(fullTitle, forms);

    // Sem semelhança com o título e curto demais para ser um trecho: descarta sem gastar API.
    const couldBeExcerpt = guess.length >= MIN_LYRICS_TOKENS;
    if (byTitle < PARTIAL_MATCH && !couldBeExcerpt) return null;

    // A letra serve para achar o trecho do palpite e o trecho com a palavra sorteada.
    const lyrics: LyricsResult | null = await this.provider.getLyrics(candidate.id);

    let byLyrics = { score: 0, lineIndex: -1 };
    let byCombo = { score: 0, lineIndex: -1 };
    if (lyrics) {
      byLyrics = lyricsScore(guess, lyrics.text);
      byCombo = comboScore(guess, shortTitle, lyrics.text);
      // Letra parcial (ex.: plano gratuito): se a própria fonte encontrou a música pela
      // letra, o trecho pode estar na parte que não veio. Vira possibilidade, não certeza.
      const lyricsRank = candidate.sources.lyrics;
      if (lyrics.partial && byLyrics.score < CLEAR_MATCH && lyricsRank !== undefined && guess.length >= 4) {
        byLyrics = { score: Math.max(byLyrics.score, 0.72 - 0.03 * lyricsRank), lineIndex: byLyrics.lineIndex };
      }
    }

    let guessScore = byTitle;
    let matchedBy: MatchedBy = 'title';
    let nearLine = -1;
    if (byCombo.score > guessScore) {
      guessScore = byCombo.score;
      matchedBy = 'title_and_lyrics';
      nearLine = byCombo.lineIndex;
    }
    if (byLyrics.score > guessScore) {
      guessScore = byLyrics.score;
      matchedBy = 'lyrics';
      nearLine = byLyrics.lineIndex;
    }
    if (guessScore < PARTIAL_MATCH) return null;

    const excerpt = lyrics ? findExcerpt(lyrics.text, forms, nearLine) : null;
    let wordLocation: WordLocation | null = null;
    if (wordInTitle && excerpt) wordLocation = 'title_and_lyrics';
    else if (wordInTitle) wordLocation = 'title';
    else if (excerpt) wordLocation = 'lyrics';
    else if (lyrics?.partial && this.provider.lyricsContain) {
      // A letra veio incompleta: confirma na fonte se a letra completa tem a palavra.
      if (await this.provider.lyricsContain(candidate, targetWord)) wordLocation = 'lyrics';
    }

    return {
      candidate,
      guessScore,
      matchedBy,
      wordLocation,
      matchedWord: wordInTitle ?? excerpt?.word ?? (wordLocation ? normalizeText(targetWord) : null),
      excerpt: excerpt?.excerpt ?? null,
    };
  }

  private async askDisambiguator(guess: string, targetWord: string, partials: Evaluation[]): Promise<Evaluation | null> {
    try {
      const index = await this.disambiguator!.choose({
        guess,
        targetWord,
        candidates: partials.map((item) => ({
          title: item.candidate.title,
          artist: item.candidate.artist,
          excerpt: item.excerpt,
        })),
      });
      // A IA só pode escolher entre os candidatos reais recebidos.
      if (index === null || !Number.isInteger(index) || index < 0 || index >= partials.length) return null;
      return partials[index];
    } catch (error) {
      this.logger.warn('[music] desambiguação por IA indisponível', error);
      return null;
    }
  }

  private toFound(evaluation: Evaluation, decidedBy: 'rules' | 'ai'): MusicVerificationFound {
    const { candidate } = evaluation;
    return {
      found: true,
      title: candidate.title,
      artist: candidate.artist,
      trackId: candidate.id,
      provider: this.provider.name,
      matchedExcerpt: evaluation.excerpt,
      matchedWord: evaluation.matchedWord ?? '',
      matchedBy: evaluation.matchedBy,
      wordLocation: evaluation.wordLocation ?? 'lyrics',
      confidence: Math.round(Math.min(1, evaluation.guessScore) * 1000) / 1000,
      decidedBy,
    };
  }
}
