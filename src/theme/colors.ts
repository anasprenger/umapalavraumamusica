/**
 * Paleta oficial do Uma Palavra, Uma Música.
 * Roxo como cor de ação, branco como base e lilás suave como apoio.
 */
export const colors = {
  // Roxos
  primary: '#6B3FE0',
  primaryPressed: '#5A30CC',
  primaryDark: '#4A23B0',
  primaryDeep: '#2E1470',
  primaryDeeper: '#22104F',

  // Apoio lilás
  lilac: '#EEE8FF',
  lilacStrong: '#DCD0FF',
  lilacSoft: '#F7F4FF',

  // Neutros
  white: '#FFFFFF',
  background: '#F7F5FC',
  surface: '#FFFFFF',
  ink: '#1E1238',
  inkSecondary: '#5E5575',
  inkTertiary: '#9A93AD',
  separator: 'rgba(46, 20, 112, 0.10)',

  // Sobre fundos roxos
  onPrimary: '#FFFFFF',
  onPrimarySecondary: 'rgba(255, 255, 255, 0.78)',
  onPrimaryTertiary: 'rgba(255, 255, 255, 0.55)',
  onPrimarySurface: 'rgba(255, 255, 255, 0.12)',
  onPrimarySurfaceStrong: 'rgba(255, 255, 255, 0.2)',

  // Estados
  danger: '#E5484D',
  dangerSoft: '#FDECEC',
  success: '#2DB36F',
  warningSoft: '#FFF6E0',

  // Acentos (tons da própria paleta para dar vida aos elementos)
  violet: '#8A63F0',
  lavender: '#A77BF3',
  goldSoft: '#FFF3D1',
  goldDeep: '#9A6A00',
  successSoft: '#E2F6EB',
  successDeep: '#1D7A4A',

  // Pódio
  gold: '#FFD66B',
  silver: '#E4E1EE',
  bronze: '#F2B892',

  overlay: 'rgba(20, 8, 50, 0.45)',
  transparent: 'transparent',
} as const;

/** Cores de avatar: roxos da paleta intercalados com lilás, dourado e pêssego do pódio. */
export const avatarPalette = [
  { bg: '#6B3FE0', fg: '#FFFFFF' },
  { bg: '#FFD66B', fg: '#2E1470' },
  { bg: '#8A63F0', fg: '#FFFFFF' },
  { bg: '#F2B892', fg: '#2E1470' },
  { bg: '#4A23B0', fg: '#FFFFFF' },
  { bg: '#DCD0FF', fg: '#4A23B0' },
  { bg: '#2E1470', fg: '#FFD66B' },
  { bg: '#9B6BE8', fg: '#FFFFFF' },
] as const;

type GradientStops = readonly [string, string, ...string[]];

/** Degradês da interface (sempre dentro da paleta). */
export const gradients = {
  /** Fundo das telas roxas: violeta claro no alto até o roxo profundo embaixo. */
  purple: ['#7B4DEC', '#5530C6', '#2A1266'],
  /** Fundo das telas claras: lilás no alto, quase branco embaixo. */
  light: ['#E9E0FF', '#F5F1FF', '#FDFBFF'],
  /** Botão principal. */
  primary: ['#7F55F3', '#5A30CC'],
  /** Cartão da palavra. */
  word: ['#9064F7', '#6B3FE0', '#4A23B0'],
  /** Destaques dourados (pontos, 1º lugar). */
  gold: ['#FFE596', '#F5C443'],
} as const satisfies Record<string, GradientStops>;

export type GradientName = keyof typeof gradients;

export type ColorName = keyof typeof colors;
