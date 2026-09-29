import { describe, expect, it } from 'vitest';

import { SharedClock } from './artifactBackend';
import { buildJudgePrompt, interpretVerdict, sampleFailureReason } from './claudeJudge';

describe('verificação pelo Claude', () => {
  it('o pedido leva a palavra e o palpite e pede JSON', () => {
    const prompt = buildJudgePrompt('coração', 'Evidências');
    expect(prompt).toContain('"coração"');
    expect(prompt).toContain('"Evidências"');
    expect(prompt).toContain('JSON');
  });

  it('música encontrada com a palavra: acerto, com o trecho só se ele mostrar a palavra', () => {
    const verdict = {
      songFound: true,
      title: 'Garota de Ipanema',
      artist: 'Tom Jobim',
      wordInSong: true,
      excerpt: 'Olha que coisa mais linda, mais cheia de graça',
      confidence: 0.95,
    };
    expect(interpretVerdict(verdict, 'graça')).toEqual({
      outcome: 'correct',
      details: {
        title: 'Garota de Ipanema',
        artist: 'Tom Jobim',
        excerpt: 'Olha que coisa mais linda, mais cheia de graça',
        matchedWord: 'graça',
      },
    });
    expect(interpretVerdict(verdict, 'mar').details.excerpt).toBeNull();
  });

  it('sem a palavra, sem música ou com pouca certeza: incorreto com o motivo certo', () => {
    const base = { songFound: true, title: 'Asa Branca', artist: 'Luiz Gonzaga', confidence: 0.9 };
    expect(interpretVerdict({ ...base, wordInSong: false }, 'mar')).toMatchObject({
      outcome: 'incorrect',
      details: { reason: 'word_not_in_song', title: 'Asa Branca' },
    });
    expect(interpretVerdict({ songFound: false }, 'mar').details.reason).toBe('no_match');
    expect(interpretVerdict({ ...base, wordInSong: true, confidence: 0.3 }, 'mar').details.reason).toBe('ambiguous');
  });

  it('resposta sem formato ou falha do pedido não contam como rodada', () => {
    expect(interpretVerdict('talvez', 'mar').outcome).toBe('error');
    expect(sampleFailureReason({ code: 'not_granted' })).toBe('ai_not_allowed');
    expect(sampleFailureReason({ code: 'rate_limited' })).toBe('ai_rate_limited');
    expect(sampleFailureReason(new Error('x'))).toBe('provider_unavailable');
  });
});

describe('relógio compartilhado', () => {
  it('estima o horário do servidor a partir do vencimento da trava', () => {
    const clock = new SharedClock();
    const server = Date.now() + 5000; // servidor 5 s adiantado
    clock.sample(new Date(server + 1500).toISOString(), 1500, Date.now() - 40, Date.now() + 40);
    expect(Math.abs(clock.offset - 5000)).toBeLessThan(100);
  });

  it('com horário sem milissegundos, várias amostras estreitam a estimativa', () => {
    const clock = new SharedClock();
    const offset = 2750;
    for (const shift of [0, 250, 500, 750]) {
      const now = Date.now();
      const expires = new Date(Math.floor((now + offset + shift + 1500) / 1000) * 1000).toISOString().replace('.000', '');
      clock.sample(expires, 1500, now + shift - 20, now + shift + 20);
    }
    expect(Math.abs(clock.offset - offset)).toBeLessThan(1000);
  });
});
