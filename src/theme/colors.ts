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

  // Pódio
  gold: '#FFD66B',
  silver: '#E4E1EE',
  bronze: '#F2B892',

  overlay: 'rgba(20, 8, 50, 0.45)',
  transparent: 'transparent',
} as const;

/** Cores de avatar derivadas do roxo, para diferenciar jogadores sem poluir a interface. */
export const avatarPalette = [
  '#6B3FE0',
  '#8A63F0',
  '#4A23B0',
  '#A77BF3',
  '#5B4FD6',
  '#7C4DDB',
  '#3F2A9C',
  '#9B6BE8',
] as const;

export type ColorName = keyof typeof colors;
