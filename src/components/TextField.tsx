import { forwardRef, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radii, spacing, textVariants } from '@/theme';

import { AppText } from './AppText';

type Props = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  trailing?: ReactNode;
  tone?: 'light' | 'purple';
};

/** Campo de texto arredondado, com rótulo opcional e borda roxa ao focar. */
export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, hint, error, trailing, tone = 'light', style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const onPurple = tone === 'purple';

  return (
    <View style={styles.wrapper}>
      {label ? (
        <AppText variant="footnote" weight="semibold" color={onPurple ? colors.onPrimarySecondary : colors.inkSecondary}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.field,
          onPurple ? styles.fieldPurple : styles.fieldLight,
          focused ? (onPurple ? styles.focusedPurple : styles.focusedLight) : null,
          error ? styles.fieldError : null,
        ]}>
        <TextInput
          ref={ref}
          placeholderTextColor={onPurple ? colors.onPrimaryTertiary : colors.inkTertiary}
          selectionColor={onPurple ? colors.white : colors.primary}
          style={[styles.input, { color: onPurple ? colors.white : colors.ink }, style]}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
        {trailing}
      </View>
      {error ? (
        <AppText variant="footnote" color={colors.danger}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="footnote" color={onPurple ? colors.onPrimaryTertiary : colors.inkTertiary}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  field: {
    minHeight: 54,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderWidth: 1.5,
  },
  fieldLight: {
    backgroundColor: colors.white,
    borderColor: colors.separator,
  },
  fieldPurple: {
    backgroundColor: colors.onPrimarySurface,
    borderColor: colors.transparent,
  },
  focusedLight: {
    borderColor: colors.primary,
  },
  focusedPurple: {
    borderColor: colors.onPrimarySecondary,
  },
  fieldError: {
    borderColor: colors.danger,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingRight: spacing.xs,
    ...textVariants.body,
    outlineStyle: 'none',
  } as object,
});
