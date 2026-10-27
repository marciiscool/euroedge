// @ts-check
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import root from '../../eslint.config.js';

// eslint-plugin-react / jsx-a11y / import do not declare ESLint 10 support yet (ADR-0011);
// accessibility is enforced by axe-core in Playwright (M7-27).
export default [
  ...root,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
];
