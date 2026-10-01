import { describe, expect, it } from 'vitest';

import { pickRandomWord, WORD_BANK } from '@/data/words';

import { highlightWord, wordForms } from './highlight';
import { normalizeText, sameText } from './normalize';
import { buildPodium, rankPlayers } from './ranking';

describe('normalizeText', () => {
  it('ignora acentos, caixa, pontuação e espaços extras', () => {
    expect(normalizeText('  CORAÇÃO!! ')).toBe('coracao');
    expect(sameText('coração', 'coracao')).toBe(true);
    expect(sameText('Vejo enfim  a luz, brilhar', 'vejo enfim a luz brilhar')).toBe(true);
    expect(normalizeText("Pingo d'água")).toBe('pingo dagua');
  });
});

describe('highlightWord', () => {
  it('destaca a palavra no trecho preservando o texto original', () => {
    const segments = highlightWord('e ela pode Transformar de uma vez o mundo inteiro', 'transformar');
    expect(segments).toEqual([
      { text: 'e ela pode ', highlight: false },
      { text: 'Transformar', highlight: true },
      { text: ' de uma vez o mundo inteiro', highlight: false },
    ]);
  });

  it('funciona com acentos diferentes e plurais simples', () => {
    const segments = highlightWord('Dois corações batendo, um coracao só', 'CORAÇÃO');
    expect(segments.filter((s) => s.highlight).map((s) => s.text)).toEqual(['corações', 'coracao']);
    expect(wordForms('amor')).toContain('amores');
  });

  it('não destaca palavras que apenas contêm a palavra sorteada', () => {
    expect(highlightWord('solidão e girassol', 'sol').some((s) => s.highlight)).toBe(false);
  });
});

describe('ranking com empates', () => {
  const players = [
    { id: 'a', name: 'Ana', score: 8, joinOrder: 1 },
    { id: 'j', name: 'João', score: 6, joinOrder: 2 },
    { id: 'm', name: 'Maria', score: 8, joinOrder: 3 },
    { id: 'p', name: 'Pedro', score: 4, joinOrder: 4 },
    { id: 'l', name: 'Lia', score: 1, joinOrder: 5 },
  ];

  it('empatados dividem a posição e ninguém é removido', () => {
    const ranked = rankPlayers(players);
    expect(ranked.map((p) => [p.name, p.position])).toEqual([
      ['Ana', 1],
      ['Maria', 1],
      ['João', 2],
      ['Pedro', 3],
      ['Lia', 4],
    ]);
  });

  it('monta pódio com os três primeiros lugares e o restante abaixo', () => {
    const { tiers, rest } = buildPodium(players);
    expect(tiers.map((t) => t.players.map((p) => p.name))).toEqual([['Ana', 'Maria'], ['João'], ['Pedro']]);
    expect(rest.map((p) => p.name)).toEqual(['Lia']);
  });
});

describe('banco de palavras', () => {
  it('não tem palavras repetidas', () => {
    const keys = WORD_BANK.map(normalizeText);
    expect(new Set(keys).size).toBe(keys.length);
    expect(WORD_BANK.length).toBeGreaterThan(200);
  });

  it('nunca sorteia palavra já usada (ignorando acentos)', () => {
    const words = ['amor', 'coração', 'sol'];
    for (let i = 0; i < 50; i += 1) {
      expect(pickRandomWord(['AMOR', 'coracao'], words)).toBe('sol');
    }
    expect(pickRandomWord(['amor', 'coração', 'sol'], words)).toBeNull();
  });
});
