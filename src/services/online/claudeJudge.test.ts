import { describe, expect, it } from 'vitest';

import { SharedClock } from './artifactBackend';
import { buildJudgePrompt, interpretVerdict, parseJsonAnswer, sampleFailureReason } from './claudeJudge';

describe('verificação pelo Claude', () => {
  it('o pedido leva a palavra e o palpite e pede JSON', () => {
    const prompt = buildJudgePrompt('coração', 'Evidências');
    expect(prompt).toContain('"coração"');
    expect(prompt).toContain('"Evidências"');
    expect(prompt).toContain('JSON');
  });

  it('título reconhecido com a palavra: acerto, sem inventar trecho', () => {
    const verdict = {
      kind: 'title',
      songs: [{ title: 'Garota de Ipanema', artist: 'Tom Jobim', confidence: 0.95, hasWord: true }],
    };
    expect(interpretVerdict(verdict, 'graça', 'garota de ipanema')).toEqual({
      outcome: 'correct',
      details: { title: 'Garota de Ipanema', artist: 'Tom Jobim', excerpt: null, matchedWord: 'graça' },
    });
  });

  it('trecho reconhecido: o trecho digitado aparece como destaque, mesmo que o Claude hesite sobre a palavra', () => {
    const guess = 'olha que coisa mais linda mais cheia de graça';
    const verdict = {
      kind: 'lyrics',
      songs: [{ title: 'Garota de Ipanema', artist: 'Tom Jobim', confidence: 0.8, hasWord: false }],
    };
    expect(interpretVerdict(verdict, 'graça', guess)).toMatchObject({
      outcome: 'correct',
      details: { title: 'Garota de Ipanema', excerpt: guess },
    });
  });

  it('entre várias candidatas, vale a mais provável que tem a palavra', () => {
    const verdict = {
      kind: 'title',
      songs: [
        { title: 'Sem a palavra', artist: 'A', confidence: 0.9, hasWord: false },
        { title: 'Com a palavra', artist: 'B', confidence: 0.7, hasWord: true },
        { title: 'Improvável', artist: 'C', confidence: 0.2, hasWord: true },
      ],
    };
    expect(interpretVerdict(verdict, 'mar', 'x').details.title).toBe('Com a palavra');
  });

  it('sem a palavra, sem música ou com pouca certeza: incorreto com o motivo certo', () => {
    const song = { title: 'Asa Branca', artist: 'Luiz Gonzaga', confidence: 0.9, hasWord: false };
    expect(interpretVerdict({ kind: 'title', songs: [song] }, 'mar', 'asa branca')).toMatchObject({
      outcome: 'incorrect',
      details: { reason: 'word_not_in_song', title: 'Asa Branca' },
    });
    expect(interpretVerdict({ kind: 'unclear', songs: [] }, 'mar', 'xyz').details.reason).toBe('no_match');
    const unsure = { kind: 'lyrics', songs: [{ ...song, confidence: 0.3, hasWord: true }] };
    expect(interpretVerdict(unsure, 'mar', 'o mar').details.reason).toBe('ambiguous');
  });

  it('resposta sem formato ou falha do pedido não contam como rodada', () => {
    expect(interpretVerdict('talvez', 'mar', 'x').outcome).toBe('error');
    expect(sampleFailureReason({ code: 'not_granted' })).toBe('ai_not_allowed');
    expect(sampleFailureReason({ code: 'rate_limited' })).toBe('ai_rate_limited');
    expect(sampleFailureReason({ code: 'capability_removed' })).toBe('ai_unavailable');
    expect(sampleFailureReason({ code: 'sampling_disabled' })).toBe('ai_unavailable');
    expect(sampleFailureReason(new Error('x'))).toBe('provider_unavailable');
  });
});

describe('resposta em texto (apps do Claude sem sample.json)', () => {
  it('lê o JSON puro, dentro de bloco de código ou no meio de uma frase', () => {
    expect(parseJsonAnswer('{"songFound": true}')).toEqual({ songFound: true });
    expect(parseJsonAnswer('Resultado:\n```json\n{"songFound": false}\n```')).toEqual({ songFound: false });
    expect(parseJsonAnswer('Claro! {"confidence": 0.8} Espero ter ajudado.')).toEqual({ confidence: 0.8 });
    expect(parseJsonAnswer('não sei')).toBeNull();
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
