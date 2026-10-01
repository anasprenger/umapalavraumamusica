/**
 * Normalização de texto para comparação interna.
 * Nunca altera o texto exibido: serve apenas para comparar
 * (ex.: "Coração", "coracao" e " CORAÇÃO! " ficam iguais).
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

/** Compara dois textos ignorando acentos, caixa, pontuação e espaços extras. */
export function sameText(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

/** Limpa espaços extras de um nome digitado, mantendo acentos e caixa originais. */
export function tidyName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
