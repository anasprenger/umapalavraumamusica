import { normalizeText } from '@/utils/normalize';

import bank from './words.pt-BR.json';

/**
 * Banco de palavras do modo local (o modo online usa a tabela `words` do Supabase,
 * gerada a partir deste mesmo arquivo com `npm run words:sql`).
 * Para adicionar palavras, basta editar `words.pt-BR.json`.
 */
export const WORD_BANK: readonly string[] = dedupe(bank.words);

function dedupe(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of words) {
    const word = raw.trim();
    const key = normalizeText(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(word);
  }
  return result;
}

/**
 * Sorteia uma palavra que ainda não foi usada na partida.
 * A comparação ignora acentos e caixa ("Coração" = "coracao").
 * Retorna `null` quando todas as palavras já foram usadas.
 */
export function pickRandomWord(
  used: readonly string[],
  words: readonly string[] = WORD_BANK,
  random: () => number = Math.random,
): string | null {
  const usedKeys = new Set(used.map(normalizeText));
  const available = words.filter((word) => !usedKeys.has(normalizeText(word)));
  if (available.length === 0) return null;
  const index = Math.min(available.length - 1, Math.floor(random() * available.length));
  return available[index];
}
