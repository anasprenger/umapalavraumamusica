#!/usr/bin/env node
/**
 * Gera o SQL que carrega o banco de palavras do modo online a partir de
 * src/data/words.pt-BR.json (a mesma lista usada no modo local).
 *
 * Uso:
 *   npm run words:sql                 → atualiza supabase/migrations/20260928000003_seed_words.sql
 *   npm run words:sql -- --out x.sql  → grava em outro arquivo (ex.: nova migração)
 *
 * O SQL usa "on conflict do nothing": pode ser executado várias vezes sem duplicar.
 * Também é possível editar a tabela `words` direto no painel do Supabase.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'data', 'words.pt-BR.json');
const outIndex = process.argv.indexOf('--out');
const target =
  outIndex > -1
    ? path.resolve(process.argv[outIndex + 1])
    : path.join(root, 'supabase', 'migrations', '20260928000003_seed_words.sql');

const normalize = (value) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const { words } = JSON.parse(readFileSync(source, 'utf8'));
const seen = new Set();
const unique = [];
for (const raw of words) {
  const word = String(raw).trim();
  const key = normalize(word);
  if (!key || seen.has(key)) continue;
  seen.add(key);
  unique.push(word);
}

const values = unique.map((word) => `  ('${word.replace(/'/g, "''")}')`).join(',\n');
const sql = `-- Gerado por scripts/generate-words-sql.mjs a partir de src/data/words.pt-BR.json.
-- Para adicionar palavras: edite o JSON e rode \`npm run words:sql -- --out <nova migração>\`,
-- ou insira direto na tabela \`words\` pelo painel do Supabase.
insert into public.words (word) values
${values}
on conflict do nothing;
`;

writeFileSync(target, sql);
console.log(`✓ ${unique.length} palavras → ${path.relative(root, target)}`);
