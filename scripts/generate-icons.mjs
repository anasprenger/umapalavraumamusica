#!/usr/bin/env node
/**
 * Gera os ícones PNG do app a partir do desenho vetorial da nota musical.
 *
 * Uso:
 *   npm install --no-save sharp
 *   npm run icons
 *
 * Arquivos gerados em assets/images/:
 *   icon.png                    1024×1024, quadrado cheio (o iOS aplica os cantos arredondados)
 *   icon-rounded.png            1024×1024, com cantos arredondados (loja/web/documentação)
 *   android-icon-foreground.png nota branca na área segura do ícone adaptativo
 *   android-icon-background.png fundo roxo com gradiente leve
 *   android-icon-monochrome.png nota para ícones temáticos do Android 13+
 *   splash-icon.png             nota branca para a tela de abertura (fundo roxo)
 *   favicon.png                 ícone da versão web
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'images');
const svgDir = path.join(root, 'assets', 'icon');

// Mesmo desenho usado em src/components/LogoMark.tsx (grade 100×100).
const NOTE_PATH =
  'M40 24.5 L74 16.5 C76.4 15.9 78.5 17.7 78.5 20.1 V64 C78.5 71.2 72.1 77 64.2 77 C56.9 77 51.5 72.8 51.5 67.2 C51.5 61.4 57.8 56.8 65.3 56.8 C67.4 56.8 69.3 57.2 70.9 57.9 V32.1 L47.6 37.5 V72 C47.6 79.2 41.2 85 33.3 85 C26 85 20.6 80.8 20.6 75.2 C20.6 69.4 26.9 64.8 34.4 64.8 C36.5 64.8 38.4 65.2 40 65.9 Z';

const gradient = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8052F0"/><stop offset="1" stop-color="#5626CC"/></linearGradient>`;

/** Nota centralizada, ocupando `scale` da largura do quadro. */
function note(scale, fill = '#FFFFFF') {
  const offset = (100 - 100 * scale) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})"><path d="${NOTE_PATH}" fill="${fill}" transform="translate(2 -1)"/></g>`;
}

function svg(body, { rounded = false, background = true } = {}) {
  const bg = background ? `<rect width="100" height="100" ${rounded ? 'rx="23"' : ''} fill="url(#bg)"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100"><defs>${gradient}</defs>${bg}${body}</svg>`;
}

const sources = {
  'icon.png': svg(note(1)),
  'icon-rounded.png': svg(note(1), { rounded: true }),
  'android-icon-foreground.png': svg(note(0.62), { background: false }),
  'android-icon-background.png': svg(''),
  'android-icon-monochrome.png': svg(note(0.62, '#000000'), { background: false }),
  'splash-icon.png': svg(note(0.9), { background: false }),
  'favicon.png': svg(note(1), { rounded: true }),
};

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('O pacote "sharp" não está instalado. Rode: npm install --no-save sharp');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(svgDir, { recursive: true });
writeFileSync(path.join(svgDir, 'icon.svg'), svg(note(1), { rounded: true }));

for (const [file, source] of Object.entries(sources)) {
  const size = file === 'favicon.png' ? 196 : 1024;
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(path.join(outDir, file));
  console.log(`✓ assets/images/${file}`);
}
