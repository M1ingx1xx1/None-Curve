// ESLint flat config: the recommended JavaScript, TypeScript (without type information) and React hooks rules.
// `npm run lint` checks the whole project; CI runs it before the tests. Layout is Prettier's (`npm run format`), so
// eslint-config-prettier turns off every rule that would argue with it.

import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['dist', 'node_modules', 'test-audio', 'resources', '.claude'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    rules: {
      // A leading underscore names what is left out on purpose (`const { view: _view, ...rest } = state`).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // React Compiler checks (the app is not compiled with it), which flag established patterns here: refs that hold
      // the latest value and are read while rendering, drafts synced from their props in an effect, and caches kept in
      // useMemo and filled while rendering.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    files: ['scripts/**', 'tests/**', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
)
