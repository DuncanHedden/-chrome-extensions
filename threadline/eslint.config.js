import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Webhook URLs carry a token; all logging goes through the redacting logger in @threadline/core.
      'no-console': 'error',
    },
  },
  {
    files: ['apps/*/static/**', 'packages/admin-ui/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/core/src/log.ts', 'test/**', '**/test/**', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
);
