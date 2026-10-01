/**
 * Normalização e comparação de texto tolerantes a diferenças de escrita:
 * acentos, maiúsculas/minúsculas, pontuação, espaços extras e pequenos erros
 * de digitação. O texto original nunca é alterado; isto é só para comparar.
 */

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ') : [];
}

/** Formas aceitas da palavra sorteada: singular e plurais simples do português. */
export function wordForms(word: string): Set<string> {
  const base = normalizeText(word).replace(/\s+/g, ' ');
  const forms = new Set<string>();
  if (!base) return forms;
  forms.add(base);
  if (base.includes(' ')) return forms;
  forms.add(`${base}s`);
  forms.add(`${base}es`);
  if (base.endsWith('ao')) {
    const stem = base.slice(0, -2);
    forms.add(`${stem}oes`);
    forms.add(`${stem}aes`);
    forms.add(`${stem}aos`);
  }
  if (base.endsWith('l')) forms.add(`${base.slice(0, -1)}is`);
  if (base.endsWith('m')) forms.add(`${base.slice(0, -1)}ns`);
  return forms;
}

/** Procura a palavra (ou expressão) nos tokens; retorna a forma encontrada. */
export function findWord(tokens: readonly string[], forms: Set<string>): string | null {
  for (const form of forms) {
    const parts = form.split(' ');
    if (parts.length === 1) {
      if (tokens.includes(form)) return form;
      continue;
    }
    for (let i = 0; i + parts.length <= tokens.length; i += 1) {
      if (parts.every((part, offset) => tokens[i + offset] === part)) return form;
    }
  }
  return null;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Igualdade de palavras com tolerância a erros pequenos em palavras longas. */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const shortest = Math.min(a.length, b.length);
  if (shortest >= 8) return levenshtein(a, b) <= 2;
  if (shortest >= 5) return levenshtein(a, b) <= 1;
  return false;
}

/** Remove complementos do título: "(Ao Vivo)", "[Remastered]", "- Acústico", "feat. X". */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([{][^)\]}]*[)\]}]\s*/g, ' ')
    .replace(/\s+[-–—]\s+.*$/, '')
    .replace(/\s+(feat\.?|ft\.?|part\.?|featuring|participação especial de)\s+.*$/i, '')
    .trim();
}

/** Linhas da letra sem avisos da fonte e sem linhas vazias. */
export function lyricsLines(lyrics: string): string[] {
  return lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '...' && !/^\*{3,}/.test(line) && !/^\(\d{6,}\)$/.test(line));
}
