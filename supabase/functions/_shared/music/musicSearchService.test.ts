import { describe, expect, it } from 'vitest';

import { cleanTitle, normalizeText, wordForms } from './text.ts';
import { findExcerpt, lyricsScore, titleScore } from './matcher.ts';
import { MusicSearchService } from './musicSearchService.ts';
import { MockMusicProvider } from './providers/mock.ts';
import { tokenize } from './text.ts';
import { type Disambiguator, MusicProviderError } from './types.ts';

const quiet = { warn: () => undefined };

function service(options: ConstructorParameters<typeof MockMusicProvider>[0] = {}, disambiguator?: Disambiguator) {
  const provider = new MockMusicProvider(options);
  return { provider, music: new MusicSearchService(provider, { disambiguator, logger: quiet }) };
}

describe('verificação de palpites (spec §52 — Palpite)', () => {
  it('título correto', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'Amor Colorido', targetWord: 'AMOR' });
    expect(result).toMatchObject({ found: true, title: 'Amor Colorido', artist: 'Banda Aurora', matchedBy: 'title' });
  });

  it('título incorreto', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'Canção Que Não Existe', targetWord: 'AMOR' });
    expect(result).toEqual({ found: false, reason: 'no_match' });
  });

  it('trecho correto (exemplo da especificação: TRANSFORMAR)', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'pode transformar de uma vez o mundo', targetWord: 'TRANSFORMAR' });
    expect(result).toMatchObject({ found: true, title: 'Vejo Enfim a Luz Brilhar', matchedBy: 'lyrics' });
    if (result.found) expect(result.matchedExcerpt).toContain('transformar');
  });

  it('título que não contém a palavra, mas a letra contém: mostra o trecho', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'Vejo enfim a luz brilhar', targetWord: 'TRANSFORMAR' });
    expect(result).toMatchObject({ found: true, title: 'Vejo Enfim a Luz Brilhar', wordLocation: 'lyrics' });
    if (result.found) {
      expect(result.matchedExcerpt).toBe('e ela pode transformar de uma vez o mundo inteiro');
      expect(result.matchedWord).toBe('transformar');
    }
  });

  it('trecho incorreto', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'uma frase qualquer que ninguém canta', targetWord: 'AMOR' });
    expect(result.found).toBe(false);
  });

  it('título sem a palavra sorteada (nem na letra) é incorreto e informa a música', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'Estrada', targetWord: 'AMOR' });
    expect(result).toEqual({ found: false, reason: 'word_not_in_song', title: 'Estrada', artist: 'Os Viajantes' });
  });

  it('trecho que contém a palavra', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'as estrelas pedem pra dançar', targetWord: 'noite' });
    expect(result).toMatchObject({ found: true, title: 'Noite de Verão', artist: 'Lia Mar' });
  });

  it('acentuação diferente', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'coracao de papel', targetWord: 'CORAÇÃO' });
    expect(result).toMatchObject({ found: true, title: 'Coração de Papel' });
  });

  it('letras maiúsculas/minúsculas e pontuação', async () => {
    const { music } = service();
    const result = await music.verify({ guess: '  AMOR,  colorido!! ', targetWord: 'amor' });
    expect(result).toMatchObject({ found: true, title: 'Amor Colorido' });
  });

  it('vários resultados: usa a primeira correspondência VÁLIDA, não o primeiro resultado bruto', async () => {
    const { music } = service();
    // "Saudade" do Duo Maré aparece primeiro, mas não tem "mar"; a da Nina Ribeira tem.
    const result = await music.verify({ guess: 'Saudade', targetWord: 'mar' });
    expect(result).toMatchObject({ found: true, title: 'Saudade', artist: 'Nina Ribeira' });
    if (result.found) expect(result.matchedExcerpt).toContain('é onda que volta pro mar');
  });

  it('nenhum resultado', async () => {
    const { music } = service({ catalog: [] });
    expect(await music.verify({ guess: 'Amor Colorido', targetWord: 'amor' })).toEqual({ found: false, reason: 'no_match' });
  });

  it('nome da música + trecho', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'Casa Vazia na mesa ainda tem café', targetWord: 'saudade' });
    expect(result).toMatchObject({ found: true, title: 'Casa Vazia' });
    if (result.found) expect(result.matchedExcerpt).toContain('saudade');
  });

  it('plural simples da palavra conta (CORAÇÃO → corações)', async () => {
    const { music } = service();
    const result = await music.verify({ guess: 'corações também sabem voar', targetWord: 'coração' });
    expect(result).toMatchObject({ found: true, title: 'Coração de Papel' });
  });

  it('tolera pequeno erro de digitação no título', async () => {
    const { music } = service();
    expect((await music.verify({ guess: 'Amor Colorio', targetWord: 'amor' })).found).toBe(true);
  });

  it('título com complemento "(Ao Vivo)" é reconhecido', async () => {
    const { music } = service();
    expect(await music.verify({ guess: 'Tempestade', targetWord: 'trovão' })).toMatchObject({
      found: true,
      title: 'Tempestade (Ao Vivo)',
    });
  });

  it('palavra curta do título dentro de frase qualquer não basta', async () => {
    const { music } = service();
    // "Sol" é título de uma música, mas a frase não é trecho dela.
    const result = await music.verify({ guess: 'hoje fez sol lá em casa', targetWord: 'janela' });
    expect(result.found).toBe(false);
  });

  it('fonte indisponível lança erro técnico (o jogo trata como "tente de novo")', async () => {
    const { music } = service({ failWith: new MusicProviderError('down', 503) });
    await expect(music.verify({ guess: 'Amor Colorido', targetWord: 'amor' })).rejects.toBeInstanceOf(MusicProviderError);
  });
});

describe('letra incompleta (plano gratuito)', () => {
  it('confirma a palavra na letra completa pela própria fonte', async () => {
    const { music, provider } = service({ partialLyrics: true });
    const result = await music.verify({ guess: 'Vejo enfim a luz brilhar', targetWord: 'transformar' });
    expect(result).toMatchObject({ found: true, wordLocation: 'lyrics', matchedExcerpt: null });
    expect(provider.calls.some((call) => call.method === 'lyricsContain')).toBe(true);
  });
});

describe('IA como segunda camada (opcional)', () => {
  // Duas músicas contêm todas as palavras do trecho, mas a letra veio incompleta:
  // as regras ficam só com "possibilidades", sem uma correspondência clara.
  const ambiguousCatalog = [
    {
      id: 'a',
      title: 'Luz do Amanhecer',
      artist: 'Artista A',
      lyrics: 'primeira linha qualquer\nsegunda linha aqui\nterceira linha\nquando a luz do dia chega o amor acorda',
    },
    {
      id: 'b',
      title: 'Outra Canção',
      artist: 'Artista B',
      lyrics: 'abertura sem nada\nmais uma linha\noutra linha\no dia chega e a luz do amor',
    },
  ];
  const guess = { guess: 'a luz do dia chega', targetWord: 'amor' };

  it('sem IA, possibilidades parciais não viram acerto', async () => {
    const { music } = service({ catalog: ambiguousCatalog, partialLyrics: true });
    expect(await music.verify(guess)).toEqual({ found: false, reason: 'ambiguous' });
  });

  it('com IA, escolhe apenas entre os candidatos reais', async () => {
    let seen: string[] = [];
    const ai: Disambiguator = {
      async choose({ candidates }) {
        seen = candidates.map((candidate) => candidate.title);
        return candidates.findIndex((candidate) => candidate.title === 'Luz do Amanhecer');
      },
    };
    const { music } = service({ catalog: ambiguousCatalog, partialLyrics: true }, ai);
    const result = await music.verify(guess);
    expect(seen).toEqual(['Luz do Amanhecer', 'Outra Canção']);
    expect(result).toMatchObject({ found: true, title: 'Luz do Amanhecer', decidedBy: 'ai' });
  });

  it('IA respondendo "nenhum", índice inválido ou falhando é ignorada', async () => {
    const none: Disambiguator = { choose: async () => null };
    const bad: Disambiguator = { choose: async () => 99 };
    const broken: Disambiguator = {
      choose: async () => {
        throw new Error('timeout');
      },
    };
    for (const ai of [none, bad, broken]) {
      const { music } = service({ catalog: ambiguousCatalog, partialLyrics: true }, ai);
      expect((await music.verify(guess)).found).toBe(false);
    }
  });

  it('a IA não é chamada quando a correspondência já é clara', async () => {
    let called = false;
    const ai: Disambiguator = {
      choose: async () => {
        called = true;
        return null;
      },
    };
    const { music } = service({}, ai);
    await music.verify({ guess: 'Amor Colorido', targetWord: 'amor' });
    expect(called).toBe(false);
  });
});

describe('funções de texto', () => {
  it('normaliza sem alterar o significado', () => {
    expect(normalizeText('Coração!!  VAZIO')).toBe('coracao vazio');
    expect(cleanTitle('Tempestade (Ao Vivo) - Remastered')).toBe('Tempestade');
    expect(cleanTitle('Dança com Você')).toBe('Dança com Você');
    expect([...wordForms('coração')]).toEqual(expect.arrayContaining(['coracao', 'coracoes']));
  });

  it('pontua título e letra', () => {
    expect(titleScore(tokenize('amor colorido'), tokenize('Amor Colorido'))).toBe(1);
    expect(titleScore(tokenize('amor colorido luan'), tokenize('Amor Colorido'))).toBeGreaterThanOrEqual(0.8);
    expect(titleScore(tokenize('colorido'), tokenize('Amor Colorido'))).toBeLessThan(0.6);
    expect(lyricsScore(tokenize('vejo enfim a luz'), 'x\nvejo enfim a luz brilhar').score).toBe(1);
    expect(findExcerpt('um\ndois corações\ntrês', wordForms('coração'))?.excerpt).toBe('dois corações / três');
  });
});
