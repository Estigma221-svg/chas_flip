import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    // Sub-proyecto Hardhat: tiene su propio package.json (Node CJS) y su
    // propio linter. No mezclamos con el lint del cliente (browser/React).
    'contracts/**',
    // Edge Functions Deno: globals y resolver de modulos diferentes. Se
    // validan con `deno check` en CI on-demand, no con ESLint del cliente.
    'supabase/functions/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
