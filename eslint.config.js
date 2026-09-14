import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * Flat ESLint config (CON-39).
 *
 * Deliberately narrow. `tsc` already covers types; this only adds what it
 * cannot see — hook order and effect dependencies, the bug classes behind
 * CON-35/CON-36/CON-37 (relay reconnect, `want()` refcounting, subscription
 * resubscribe races). Plus whatever `js.configs.recommended` catches for free.
 *
 * The React-Compiler-era rules that ship with eslint-plugin-react-hooks 7
 * (`set-state-in-effect`, `immutability`, `refs`, …) are deliberately *not*
 * enabled through its preset: this app subscribes to external stores and is
 * built around `useSyncExternalStore`, which those rules flag by design.
 * Turning them on wholesale would bury the two rules that matter here. If we
 * want one of them, add it individually with the findings fixed.
 */
export default tseslint.config(
  // .local/ and .gstack/ hold third-party repos cloned for local dev (see
  // .gitignore) — their sources are not ours to lint. .worktrees/ holds other
  // git worktrees of this repo; each carries its own tsconfig and would feed
  // the TypeScript parser several candidate roots.
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '.local/**',
      '.gstack/**',
      '.worktrees/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // browser for the app, node for the tests (they read `process` for the
      // unhandled-rejection guards) and for this config file
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // the codebase already marks params it must accept but not use with a
      // leading underscore (react-markdown hands each renderer a `node`)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react-hooks/rules-of-hooks': 'error',
      // an effect that reads a value it does not depend on is exactly the
      // stale-closure class this ticket was filed for
      'react-hooks/exhaustive-deps': 'error',
      // Only ever a Fast-Refresh hint. The named exports below sit next to
      // their provider on purpose (a context and its hook are one unit), so
      // they are declared instead of split into files for the rule's sake.
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: [
            'useSession',
            'useTheme',
            'useTocSource',
            'useTocMarkdown',
            'tabSync',
            'continueList',
            'normaliseTaskMarker',
          ],
        },
      ],
    },
  },
)
