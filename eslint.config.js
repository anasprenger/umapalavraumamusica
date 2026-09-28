// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions rodam em Deno (imports npm:/jsr:) e têm checagem própria (deno check).
    ignores: ['dist/*', 'supabase/functions/**', 'supabase/tests/**', 'scripts/**'],
  },
]);
