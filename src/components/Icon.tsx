import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { colors } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  name: IconName;
  size?: number;
  color?: string;
};

/** Ícones simples (Ionicons, com traço no estilo iOS). */
export function Icon({ name, size = 22, color = colors.ink }: Props) {
  return <Ionicons name={name} size={size} color={color} />;
}
