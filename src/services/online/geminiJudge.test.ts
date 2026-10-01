import { describe, expect, it } from 'vitest';

import { buildGeminiPrompt, geminiFailureReason, interpretGemini, readGrounding } from './geminiJudge';

const GUESS = 'eu vim trocar, sua aliança de prata por essa de ouro de um ano de noivado - ze neto e cristiano';
const LYRICS = 'eu vim trocar, sua aliança de prata por essa de ouro';
const WEB = readGrounding({
  groundingChunks: [{ web: { uri: 'https://www.letras.mus.br/x', title: 'letras.mus.br' } }],
  searchEntryPoint: { renderedContent: '<div>Google</div>' },
});
const NO_WEB = readGrounding({});

const answer = (data: Record<string, unknown>) => `Pesquisei e encontrei.\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
const FOUND = {
  found: true,
  title: 'Um Ano de Noivado',
  artist: 'Zé Neto & Cristiano',
  matchesGuess: true,
  hasWord: true,
  lyricsPart: LYRICS,
  claimedTitle: 'um ano de noivado',
  claimedArtist: 'ze neto e cristiano',
  confidence: 0.9,
};

describe('verificação pelo Gemini com busca no Google', () => {
  it('o pedido manda pesquisar e leva a palavra e o palpite', () => {
    const prompt = buildGeminiPrompt('prata', GUESS);
    expect(prompt).toContain('"prata"');
    expect(prompt).toContain('busca do Google');
    expect(prompt).toContain('```json');
  });

  it('música encontrada e confirmada na web: ponto, com trecho, fontes e sugestões de busca', () => {
    expect(interpretGemini(answer(FOUND), 'prata', GUESS, WEB)).toEqual({
      outcome: 'correct',
      details: {
        title: 'Um Ano de Noivado',
        artist: 'Zé Neto & Cristiano',
        excerpt: LYRICS,
        matchedWord: 'prata',
        sources: [{ uri: 'https://www.letras.mus.br/x', title: 'letras.mus.br' }],
        searchHtml: '<div>Google</div>',
      },
    });
  });

  it('sem páginas da busca não dá para confirmar: o palpite não conta e o jogo segue', () => {
    expect(interpretGemini(answer(FOUND), 'prata', GUESS, NO_WEB)).toEqual({
      outcome: 'error',
      details: { reason: 'not_verified' },
    });
  });

  it('música de outro artista, que não bate com o palpite, sem a palavra ou não encontrada: não vale', () => {
    const other = { ...FOUND, title: 'Aliança de Prata', artist: 'Bruno & Marrone' };
    expect(interpretGemini(answer(other), 'prata', GUESS, WEB).details).toMatchObject({
      reason: 'song_mismatch',
      title: 'um ano de noivado',
    });
    expect(interpretGemini(answer({ ...FOUND, matchesGuess: false }), 'prata', GUESS, WEB).details.reason).toBe(
      'song_mismatch',
    );
    const noWord = { ...FOUND, hasWord: false, lyricsPart: null };
    expect(interpretGemini(answer(noWord), 'prata', GUESS, WEB).details.reason).toBe('word_not_in_song');
    expect(interpretGemini(answer({ found: false }), 'prata', 'xyz', WEB).details.reason).toBe('no_match');
    expect(interpretGemini(answer({ ...FOUND, confidence: 0.4 }), 'prata', GUESS, WEB).details.reason).toBe('ambiguous');
    expect(interpretGemini('sem json', 'prata', GUESS, WEB).outcome).toBe('error');
  });

  it('falhas do Gemini viram motivos amigáveis', () => {
    expect(geminiFailureReason({ message: '[429 Too Many Requests] Resource has been exhausted' })).toBe('ai_rate_limited');
    expect(geminiFailureReason({ code: 'AI/api-not-enabled', message: 'x' })).toBe('ai_service_unavailable');
    expect(geminiFailureReason(new Error('falha de rede'))).toBe('provider_unavailable');
  });
});
