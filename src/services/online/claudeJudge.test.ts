import { describe, expect, it } from 'vitest';

import { SharedClock } from './artifactBackend';
import {
  buildConfirmPrompt,
  buildJudgePrompt,
  interpretConfirmation,
  parseJsonAnswer,
  planJudgement,
  sameName,
  sampleFailureReason,
} from './claudeJudge';

const PRATA_GUESS = 'eu vim trocar, sua aliança de prata por essa de ouro de um ano de noivado - ze neto e cristiano';
const PRATA_LYRICS = 'eu vim trocar, sua aliança de prata por essa de ouro';

describe('verificação pelo Claude: de qual música é o palpite', () => {
  it('os pedidos levam a palavra e o palpite e pedem JSON', () => {
    const prompt = buildJudgePrompt('coração', 'Evidências');
    expect(prompt).toContain('"coração"');
    expect(prompt).toContain('"Evidências"');
    expect(prompt).toContain('JSON');
    const confirm = buildConfirmPrompt('prata', PRATA_GUESS, { title: 'Um Ano de Noivado', artist: 'Zé Neto & Cristiano' });
    expect(confirm).toContain('"Um Ano de Noivado"');
    expect(confirm).toContain('"Zé Neto & Cristiano"');
  });

  it('jogador disse a música: confere exatamente a música dita, mesmo que o Claude tenha sugerido outra', () => {
    const plan = planJudgement(
      {
        kind: 'lyrics',
        lyricsPart: PRATA_LYRICS,
        claimedTitle: 'Um Ano de Noivado',
        claimedArtist: 'Zé Neto & Cristiano',
        songs: [{ title: 'Aliança de Prata', artist: 'Bruno & Marrone', confidence: 0.8, hasWord: true }],
      },
      'prata',
      PRATA_GUESS,
    );
    expect(plan).toEqual({ confirm: { title: 'Um Ano de Noivado', artist: 'Zé Neto & Cristiano' }, lyrics: PRATA_LYRICS });
  });

  it('trecho sem música identificada não vale (ninguém pode inventar música)', () => {
    const plan = planJudgement({ kind: 'lyrics', lyricsPart: 'um verso com prata', songs: [] }, 'prata', 'um verso com prata');
    expect(plan).toEqual({ result: { outcome: 'incorrect', details: { reason: 'no_match', title: null, artist: null } } });
    const unsure = planJudgement(
      { kind: 'lyrics', songs: [{ title: 'Talvez', artist: 'Alguém', confidence: 0.4, hasWord: true }] },
      'prata',
      'um verso com prata',
    );
    expect('result' in unsure && unsure.result.details.reason).toBe('ambiguous');
  });

  it('sem nome dito: confere a música mais provável que tem a palavra', () => {
    const plan = planJudgement(
      {
        kind: 'title',
        songs: [
          { title: 'Sem a palavra', artist: 'A', confidence: 0.9, hasWord: false },
          { title: 'Com a palavra', artist: 'B', confidence: 0.7, hasWord: true },
        ],
      },
      'mar',
      'x',
    );
    expect(plan).toMatchObject({ confirm: { title: 'Com a palavra', artist: 'B' } });
    const without = planJudgement(
      { kind: 'title', songs: [{ title: 'Asa Branca', artist: 'Luiz Gonzaga', confidence: 0.9, hasWord: false }] },
      'mar',
      'asa branca',
    );
    expect(without).toMatchObject({ result: { details: { reason: 'word_not_in_song', title: 'Asa Branca' } } });
  });

  it('só o artista dito: vale a música desse artista; de outro artista não', () => {
    const verdict = {
      kind: 'lyrics',
      lyricsPart: 'aliança de prata',
      claimedArtist: 'ze neto e cristiano',
      songs: [{ title: 'Outra', artist: 'Bruno & Marrone', confidence: 0.9, hasWord: true }],
    };
    expect(planJudgement(verdict, 'prata', 'aliança de prata ze neto e cristiano')).toMatchObject({
      result: { details: { reason: 'no_match' } },
    });
    expect(sameName('Zé Neto & Cristiano', 'ze neto e cristiano')).toBe(true);
    expect(sameName('Bruno & Marrone', 'ze neto e cristiano')).toBe(false);
  });
});

describe('verificação pelo Claude: segunda conferência', () => {
  const song = { title: 'Um Ano de Noivado', artist: 'Zé Neto & Cristiano' };

  it('música existe, o trecho é dela e tem a palavra: ponto, com o trecho digitado em destaque', () => {
    const answer = { exists: true, matches: true, hasWord: true, confidence: 0.85 };
    expect(interpretConfirmation(answer, 'prata', song, PRATA_LYRICS)).toEqual({
      outcome: 'correct',
      details: { title: song.title, artist: song.artist, excerpt: PRATA_LYRICS, matchedWord: 'prata' },
    });
  });

  it('música inexistente, trecho de outra música ou sem certeza: não vale', () => {
    const base = { exists: true, matches: true, hasWord: true, confidence: 0.9 };
    expect(interpretConfirmation({ ...base, exists: false }, 'prata', song, null).details.reason).toBe('song_not_found');
    expect(interpretConfirmation({ ...base, confidence: 0.5 }, 'prata', song, null).details.reason).toBe('song_not_found');
    expect(interpretConfirmation({ ...base, matches: false }, 'prata', song, null).details.reason).toBe('song_mismatch');
    expect(interpretConfirmation({ ...base, hasWord: false }, 'prata', song, null).details.reason).toBe('word_not_in_song');
    expect(interpretConfirmation('talvez', 'prata', song, null).outcome).toBe('error');
  });

  it('sem artista dito, usa o artista confirmado pelo Claude', () => {
    const answer = { exists: true, artist: 'Chitãozinho & Xororó', matches: true, hasWord: true, confidence: 0.95 };
    expect(interpretConfirmation(answer, 'coração', { title: 'Evidências', artist: null }, null).details).toMatchObject({
      title: 'Evidências',
      artist: 'Chitãozinho & Xororó',
    });
  });

  it('falhas do pedido ao Claude não contam como rodada', () => {
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
