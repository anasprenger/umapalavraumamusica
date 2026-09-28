/**
 * Fonte musical de demonstração, com um pequeno catálogo FICTÍCIO
 * (músicas, artistas e letras inventados para testes).
 *
 * Usada nos testes automatizados e em desenvolvimento, com MUSIC_PROVIDER=mock,
 * para jogar online sem uma chave do Musixmatch.
 */
import { normalizeText, tokenize } from '../text.ts';
import {
  type LyricsResult,
  type MusicProvider,
  MusicProviderError,
  type TrackCandidate,
  type TrackQuery,
} from '../types.ts';

export type MockTrack = TrackCandidate & { lyrics: string };

export const MOCK_CATALOG: MockTrack[] = [
  {
    id: 'mock-1',
    title: 'Amor Colorido',
    artist: 'Banda Aurora',
    lyrics: 'Pintei o céu com a tua cor\ncada manhã tem teu sabor\né um amor colorido\nque faz o dia ter sentido',
  },
  {
    id: 'mock-2',
    title: 'Vejo Enfim a Luz Brilhar',
    artist: 'Coral Encantado',
    lyrics:
      'Tantos anos a esperar\nlá fora o mundo a me chamar\nvejo enfim a luz brilhar\ne ela pode transformar de uma vez o mundo inteiro\nagora eu sei que é verdadeiro',
  },
  {
    id: 'mock-3',
    title: 'Noite de Verão',
    artist: 'Lia Mar',
    lyrics: 'A noite chega devagar\nestrelas pedem pra dançar\no vento quente do verão\ncarrega o som do violão',
  },
  {
    id: 'mock-4',
    title: 'Coração de Papel',
    artist: 'Trio Ventania',
    lyrics: 'Dobrei meu coração de papel\njoguei no rio sem fazer escarcéu\ncorações também sabem voar\nquando alguém ensina a amar',
  },
  {
    id: 'mock-5',
    title: 'Estrada',
    artist: 'Os Viajantes',
    lyrics: 'Poeira, pedra e chão\na curva longa do sertão\nsigo em frente sem parar\naté o dia clarear',
  },
  {
    id: 'mock-6',
    title: 'Saudade',
    artist: 'Duo Maré',
    lyrics: 'Saudade mora no portão\nespera o trem da estação\nninguém sabe onde ela vai',
  },
  {
    id: 'mock-7',
    title: 'Saudade',
    artist: 'Nina Ribeira',
    lyrics: 'Saudade tem gosto de sal\né onda que volta pro mar\no barco sumiu no final\ne eu fiquei a esperar',
  },
  {
    id: 'mock-8',
    title: 'Casa Vazia',
    artist: 'Banda Aurora',
    lyrics: 'A casa vazia sem você\no quarto escuro a entristecer\nna mesa ainda tem café\ne a saudade fica de pé',
  },
  {
    id: 'mock-9',
    title: 'Sol',
    artist: 'Pedro Luar',
    lyrics: 'O sol nasceu pra todos nós\ne canta alto a nossa voz\nabre a janela, vem ver',
  },
  {
    id: 'mock-10',
    title: 'Tempestade (Ao Vivo)',
    artist: 'Lia Mar',
    lyrics: 'Trovão lá fora a anunciar\na tempestade vai passar\nsegura firme a minha mão',
  },
];

export type MockProviderOptions = {
  catalog?: MockTrack[];
  /** Simula letras incompletas (como no plano gratuito do Musixmatch). */
  partialLyrics?: boolean;
  /** Simula a fonte fora do ar. */
  failWith?: MusicProviderError | null;
};

function overlap(query: string[], target: string[]): number {
  if (!query.length || !target.length) return 0;
  const set = new Set(target);
  const common = query.filter((token) => set.has(token)).length;
  return common / Math.max(query.length, target.length);
}

export class MockMusicProvider implements MusicProvider {
  readonly name = 'mock';
  readonly calls: { method: string; arg: unknown }[] = [];
  private readonly catalog: MockTrack[];
  private readonly partialLyrics: boolean;
  failWith: MusicProviderError | null;

  constructor(options: MockProviderOptions = {}) {
    this.catalog = options.catalog ?? MOCK_CATALOG;
    this.partialLyrics = options.partialLyrics ?? false;
    this.failWith = options.failWith ?? null;
  }

  async searchTracks(query: TrackQuery): Promise<TrackCandidate[]> {
    this.calls.push({ method: 'searchTracks', arg: query });
    if (this.failWith) throw this.failWith;
    const limit = query.limit ?? 8;

    const scored = this.catalog
      .map((track, index) => {
        const lyricsTokens = tokenize(track.lyrics);
        let score = 0;
        if (query.title) score = Math.max(score, overlap(tokenize(query.title), tokenize(track.title)));
        if (query.lyrics) {
          const wanted = tokenize(query.lyrics);
          const set = new Set(lyricsTokens);
          if (wanted.length && wanted.every((token) => set.has(token))) score = Math.max(score, 1);
        }
        if (query.any) {
          const wanted = tokenize(query.any);
          const everything = [...tokenize(track.title), ...tokenize(track.artist), ...lyricsTokens];
          const set = new Set(everything);
          const common = wanted.filter((token) => set.has(token)).length;
          if (wanted.length && common / wanted.length >= 0.6) score = Math.max(score, common / wanted.length);
        }
        return { track, index, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    return scored.slice(0, limit).map(({ track }) => ({ id: track.id, title: track.title, artist: track.artist }));
  }

  async getLyrics(trackId: string): Promise<LyricsResult | null> {
    this.calls.push({ method: 'getLyrics', arg: trackId });
    if (this.failWith) throw this.failWith;
    const track = this.catalog.find((item) => item.id === trackId);
    if (!track) return null;
    if (!this.partialLyrics) return { text: track.lyrics, partial: false };
    const lines = track.lyrics.split('\n');
    return { text: lines.slice(0, Math.max(1, Math.ceil(lines.length * 0.3))).join('\n'), partial: true };
  }

  async lyricsContain(track: TrackCandidate, word: string): Promise<boolean> {
    this.calls.push({ method: 'lyricsContain', arg: track.id });
    if (this.failWith) throw this.failWith;
    const found = this.catalog.find((item) => item.id === track.id);
    return Boolean(found && tokenize(found.lyrics).includes(normalizeText(word)));
  }
}
