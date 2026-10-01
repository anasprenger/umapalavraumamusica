/**
 * Fonte musical: Musixmatch (https://developer.musixmatch.com).
 *
 * A chave fica APENAS no servidor (variável de ambiente MUSIXMATCH_API_KEY da
 * Edge Function). O app nunca a recebe.
 *
 * Observação: no plano gratuito o Musixmatch devolve só parte da letra (~30%).
 * Por isso este provedor também implementa `lyricsContain`, que usa a busca
 * por letra do próprio Musixmatch (que considera a letra completa).
 */
import { normalizeText } from '../text.ts';
import {
  type LyricsResult,
  type MusicProvider,
  MusicProviderError,
  type TrackCandidate,
  type TrackQuery,
} from '../types.ts';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type MusixmatchTrack = {
  track_id: number;
  track_name: string;
  artist_name: string;
  album_name?: string;
  has_lyrics?: number;
};

type MusixmatchEnvelope<T> = {
  message?: {
    header?: { status_code?: number };
    body?: T | '' | [];
  };
};

const DISCLAIMER = /\*{3,}\s*This Lyrics is NOT for Commercial use\s*\*{3,}/i;

export type MusixmatchOptions = {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
};

export class MusixmatchProvider implements MusicProvider {
  readonly name = 'musixmatch';
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor({ apiKey, fetch: fetchImpl, baseUrl, timeoutMs }: MusixmatchOptions) {
    if (!apiKey) throw new MusicProviderError('MUSIXMATCH_API_KEY não configurada');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = baseUrl ?? 'https://api.musixmatch.com/ws/1.1/';
    this.timeoutMs = timeoutMs ?? 6000;
  }

  async searchTracks(query: TrackQuery): Promise<TrackCandidate[]> {
    const params: Record<string, string> = {
      f_has_lyrics: '1',
      s_track_rating: 'desc',
      page: '1',
      page_size: String(query.limit ?? 8),
    };
    if (query.title) params.q_track = query.title;
    if (query.lyrics) params.q_lyrics = query.lyrics;
    if (query.any) params.q = query.any;

    const body = await this.call<{ track_list?: { track: MusixmatchTrack }[] }>('track.search', params);
    return (body?.track_list ?? [])
      .map(({ track }) => track)
      .filter((track) => track && track.track_name && track.artist_name)
      .map((track) => ({
        id: String(track.track_id),
        title: track.track_name,
        artist: track.artist_name,
        album: track.album_name,
      }));
  }

  async getLyrics(trackId: string): Promise<LyricsResult | null> {
    const body = await this.call<{
      lyrics?: { lyrics_body?: string; pixel_tracking_url?: string };
    }>('track.lyrics.get', { track_id: trackId });
    const raw = body?.lyrics?.lyrics_body;
    if (!raw) return null;

    // Os termos do Musixmatch pedem o disparo do pixel de rastreamento ao usar a letra.
    const pixel = body?.lyrics?.pixel_tracking_url;
    if (pixel) this.fetchImpl(pixel).catch(() => undefined);

    const partial = DISCLAIMER.test(raw);
    const text = raw.replace(DISCLAIMER, '').replace(/\(\d{6,}\)\s*$/, '').replace(/\n?\.\.\.\s*$/, '').trim();
    return text ? { text, partial } : null;
  }

  async lyricsContain(track: TrackCandidate, word: string): Promise<boolean> {
    const body = await this.call<{ track_list?: { track: MusixmatchTrack }[] }>('track.search', {
      q_track: track.title,
      q_artist: track.artist,
      q_lyrics: word,
      page: '1',
      page_size: '10',
    });
    const title = normalizeText(track.title);
    const artist = normalizeText(track.artist);
    return (body?.track_list ?? []).some(
      ({ track: found }) =>
        String(found.track_id) === track.id ||
        (normalizeText(found.track_name) === title && normalizeText(found.artist_name) === artist),
    );
  }

  private async call<T>(method: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(method, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('format', 'json');
    url.searchParams.set('apikey', this.apiKey);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new MusicProviderError(`Musixmatch inacessível (${method}): ${String(error)}`);
    }
    if (!response.ok) {
      throw new MusicProviderError(`Musixmatch HTTP ${response.status} (${method})`, response.status);
    }

    let payload: MusixmatchEnvelope<T>;
    try {
      payload = (await response.json()) as MusixmatchEnvelope<T>;
    } catch {
      throw new MusicProviderError(`Musixmatch devolveu uma resposta inválida (${method})`);
    }

    const status = payload.message?.header?.status_code ?? 500;
    if (status === 404) return null; // música/letra não encontrada
    if (status !== 200) {
      // 401 chave inválida, 402 limite atingido, 403 sem permissão, 5xx instabilidade
      throw new MusicProviderError(`Musixmatch status ${status} (${method})`, status);
    }
    const body = payload.message?.body;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as T) : null;
  }
}
