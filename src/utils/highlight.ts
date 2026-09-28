import { normalizeText } from './normalize';

export type HighlightSegment = { text: string; highlight: boolean };

/** Formas aceitas da palavra sorteada (singular e plurais simples), já normalizadas. */
export function wordForms(word: string): string[] {
  const base = normalizeText(word);
  if (!base) return [];
  const forms = new Set([base, `${base}s`, `${base}es`]);
  if (base.endsWith('ao')) {
    const stem = base.slice(0, -2);
    forms.add(`${stem}oes`);
    forms.add(`${stem}aes`);
    forms.add(`${stem}aos`);
  }
  if (base.endsWith('l')) forms.add(`${base.slice(0, -1)}is`);
  if (base.endsWith('m')) forms.add(`${base.slice(0, -1)}ns`);
  return [...forms];
}

/**
 * Divide o trecho em segmentos, marcando as ocorrências da palavra sorteada.
 * A comparação ignora acentos/caixa, mas o texto original é preservado.
 */
export function highlightWord(rawExcerpt: string, word: string): HighlightSegment[] {
  const forms = new Set(wordForms(word));
  if (!rawExcerpt) return [];
  // NFC não muda o texto visível, apenas junta acentos decompostos ao caractere base.
  const excerpt = rawExcerpt.normalize('NFC');
  if (forms.size === 0) return [{ text: excerpt, highlight: false }];

  const segments: HighlightSegment[] = [];
  // Separa em "palavras" (letras latinas, incluindo acentuadas, e números) e o resto.
  const pattern = /[A-Za-z0-9\u00C0-\u024F]+(?:['’][A-Za-z0-9\u00C0-\u024F]+)*/g;
  let cursor = 0;
  for (const match of excerpt.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (!forms.has(normalizeText(token).replace(/\s+/g, ''))) continue;
    if (start > cursor) segments.push({ text: excerpt.slice(cursor, start), highlight: false });
    segments.push({ text: token, highlight: true });
    cursor = start + token.length;
  }
  if (cursor < excerpt.length) segments.push({ text: excerpt.slice(cursor), highlight: false });
  return segments;
}
