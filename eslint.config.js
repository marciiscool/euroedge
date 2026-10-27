// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Determinism rules (ADR-0001, ADR-0011): engine-core code must not read the
 * clock, use randomness, timers or floating-point maths. Money and prices are
 * branded bigints from @euroedge/fixed.
 */
const deterministicCore = {
  files: [
    'packages/fixed/src/**/*.ts',
    'packages/ledger/src/**/*.ts',
    'packages/risk-core/src/**/*.ts',
    'apps/engine/src/core/**/*.ts',
  ],
  ignores: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
  rules: {
    'no-restricted-globals': [
      'error',
      { name: 'Date', message: 'Engine core never reads the clock; time arrives as event ts.' },
      { name: 'Math', message: 'No floating-point maths in the core; use @euroedge/fixed.' },
      { name: 'performance', message: 'Engine core never reads the clock.' },
      { name: 'setTimeout', message: 'No timers in the core; time arrives as ClockTick events.' },
      { name: 'setInterval', message: 'No timers in the core; time arrives as ClockTick events.' },
      { name: 'process', message: 'No environment access in the core.' },
      { name: 'parseFloat', message: 'No floats in the core.' },
      { name: 'crypto', message: 'No randomness in the core.' },
    ],
    'no-restricted-properties': [
      'error',
      { object: 'Number', property: 'parseFloat', message: 'No floats in the core.' },
      { property: 'toFixed', message: 'No float formatting in the core.' },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Literal[raw=/^[0-9_]*\\.[0-9]/]',
        message: 'Non-integer numeric literal in the core; use bigint fixed-point.',
      },
      {
        selector: 'Literal[raw=/^[0-9_.]+[eE]-/]',
        message: 'Non-integer numeric literal in the core; use bigint fixed-point.',
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      'contracts/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      eqeqeq: ['error', 'always'],
      // False positive for branded bigints (bigint & { brand }), used for all money types.
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  deterministicCore,
);
