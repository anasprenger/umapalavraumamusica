import { describe, expect, it } from 'vitest';

import { MusicSearchService } from '../musicSearchService.ts';
import { MusicProviderError } from '../types.ts';
import { MusixmatchProvider } from './musixmatch.ts';

type Route = (url: URL) => { status?: number; body: unknown };

function fakeFetch(route: Route) {
  const requests: URL[] = [];
  const impl = async (input: string) => {
    const url = new URL(input);
    requests.push(url);
    const { status = 200, body } = route(url);
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, requests };
}

const ok = (body: unknown) => ({ body: { message: { header: { status_code: 200 }, body } } });

const searchBody = {
  track_list: [
    { track: { track_id: 11, track_name: 'Amor Colorido', artist_name: 'Banda Aurora', has_lyrics: 1 } },
    { track: { track_id: 12, track_name: 'Amor Colorido (Ao Vivo)', artist_name: 'Banda Aurora', has_lyrics: 1 } },
  ],
};

describe('MusixmatchProvider', () => {
  it('monta a busca com a chave no servidor e converte os resultados', async () => {
    const { impl, requests } = fakeFetch(() => ok(searchBody));
    const provider = new MusixmatchProvider({ apiKey: 'segredo', fetch: impl });
    const tracks = await provider.searchTracks({ title: 'amor colorido', limit: 5 });
    expect(tracks).toEqual([
      { id: '11', title: 'Amor Colorido', artist: 'Banda Aurora', album: undefined },
      { id: '12', title: 'Amor Colorido (Ao Vivo)', artist: 'Banda Aurora', album: undefined },
    ]);
    const url = requests[0];
    expect(url.pathname).toBe('/ws/1.1/track.search');
    expect(url.searchParams.get('q_track')).toBe('amor colorido');
    expect(url.searchParams.get('apikey')).toBe('segredo');
    expect(url.searchParams.get('page_size')).toBe('5');
  });

  it('limpa o aviso de uso não comercial e marca a letra como parcial', async () => {
    const lyrics = 'Pintei o céu\né um amor colorido\n...\n\n******* This Lyrics is NOT for Commercial use *******\n(1409623758541)';
    const { impl } = fakeFetch(() => ok({ lyrics: { lyrics_body: lyrics } }));
    const provider = new MusixmatchProvider({ apiKey: 'k', fetch: impl });
    expect(await provider.getLyrics('11')).toEqual({ text: 'Pintei o céu\né um amor colorido', partial: true });
  });

  it('letra inexistente (404 do Musixmatch) vira null', async () => {
    const { impl } = fakeFetch(() => ({ body: { message: { header: { status_code: 404 }, body: [] } } }));
    const provider = new MusixmatchProvider({ apiKey: 'k', fetch: impl });
    expect(await provider.getLyrics('99')).toBeNull();
  });

  it('chave inválida, limite ou HTTP 500 viram MusicProviderError (nunca vão para o jogador)', async () => {
    for (const route of [
      () => ({ body: { message: { header: { status_code: 401 }, body: '' } } }),
      () => ({ body: { message: { header: { status_code: 402 }, body: '' } } }),
      () => ({ status: 500, body: {} }),
    ]) {
      const provider = new MusixmatchProvider({ apiKey: 'k', fetch: fakeFetch(route).impl });
      await expect(provider.searchTracks({ title: 'x' })).rejects.toBeInstanceOf(MusicProviderError);
    }
  });

  it('confirma palavra na letra completa pela busca q_lyrics', async () => {
    const { impl, requests } = fakeFetch(() => ok(searchBody));
    const provider = new MusixmatchProvider({ apiKey: 'k', fetch: impl });
    const has = await provider.lyricsContain({ id: '11', title: 'Amor Colorido', artist: 'Banda Aurora' }, 'amor');
    expect(has).toBe(true);
    expect(requests[0].searchParams.get('q_lyrics')).toBe('amor');
  });

  it('integra com o MusicSearchService de ponta a ponta', async () => {
    const { impl } = fakeFetch((url) => {
      if (url.pathname.endsWith('track.search')) return ok(searchBody);
      return ok({ lyrics: { lyrics_body: 'Pintei o céu com a tua cor\né um amor colorido' } });
    });
    const service = new MusicSearchService(new MusixmatchProvider({ apiKey: 'k', fetch: impl }));
    const result = await service.verify({ guess: 'amor colorido', targetWord: 'AMOR' });
    expect(result).toMatchObject({ found: true, title: 'Amor Colorido', artist: 'Banda Aurora', provider: 'musixmatch' });
  });
});
