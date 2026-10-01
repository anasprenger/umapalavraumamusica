/**
 * Contratos da camada de busca musical.
 *
 * A aplicação conversa apenas com `MusicSearchService`; a fonte dos dados
 * (Musixmatch hoje, outra amanhã) fica atrás de `MusicProvider`.
 */

/** Uma música candidata devolvida pela fonte musical. */
export type TrackCandidate = {
  id: string;
  title: string;
  artist: string;
  album?: string;
};

export type LyricsResult = {
  /** Letra (ou parte dela) já limpa de avisos da fonte. */
  text: string;
  /** `true` quando a fonte devolve só um trecho da letra (ex.: plano gratuito do Musixmatch). */
  partial: boolean;
};

export type TrackQuery = {
  /** Busca pelo título. */
  title?: string;
  /** Busca por palavras da letra. */
  lyrics?: string;
  /** Busca geral (título, artista e letra). */
  any?: string;
  limit?: number;
};

export interface MusicProvider {
  readonly name: string;
  searchTracks(query: TrackQuery): Promise<TrackCandidate[]>;
  /** Letra da música, ou `null` se não houver. */
  getLyrics(trackId: string): Promise<LyricsResult | null>;
  /**
   * Opcional: confirma na fonte se a letra COMPLETA contém a palavra
   * (útil quando `getLyrics` devolve apenas um trecho).
   */
  lyricsContain?(track: TrackCandidate, word: string): Promise<boolean>;
}

/** Erro técnico da fonte (indisponível, chave inválida, limite...). Nunca é mostrado ao jogador. */
export class MusicProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MusicProviderError';
  }
}

export type VerifyInput = {
  guess: string;
  targetWord: string;
};

export type MatchedBy = 'title' | 'lyrics' | 'title_and_lyrics';
export type WordLocation = 'title' | 'lyrics' | 'title_and_lyrics';

export type MusicVerificationFound = {
  found: true;
  title: string;
  artist: string;
  trackId: string;
  provider: string;
  /** Trecho da letra que comprova a palavra (quando disponível). */
  matchedExcerpt: string | null;
  /** Forma da palavra encontrada na música (ex.: "amores" para AMOR). */
  matchedWord: string;
  matchedBy: MatchedBy;
  wordLocation: WordLocation;
  /** 0 a 1. */
  confidence: number;
  decidedBy: 'rules' | 'ai';
};

export type MusicVerificationNotFound = {
  found: false;
  /**
   * no_match: nenhuma música corresponde ao palpite;
   * word_not_in_song: a música existe, mas não tem a palavra sorteada;
   * ambiguous: havia possibilidades, mas nenhuma clara o bastante.
   */
  reason: 'no_match' | 'word_not_in_song' | 'ambiguous';
  /** Música encontrada quando o motivo é `word_not_in_song`. */
  title?: string;
  artist?: string;
};

export type MusicVerificationResult = MusicVerificationFound | MusicVerificationNotFound;

/** Candidato apresentado à IA na segunda camada (sempre músicas reais da fonte). */
export type DisambiguationCandidate = {
  title: string;
  artist: string;
  excerpt: string | null;
};

export interface Disambiguator {
  /**
   * Escolhe qual candidato corresponde ao palpite. Retorna o índice
   * do candidato ou `null` se nenhum corresponder. Nunca inventa músicas.
   */
  choose(input: {
    guess: string;
    targetWord: string;
    candidates: DisambiguationCandidate[];
  }): Promise<number | null>;
}
