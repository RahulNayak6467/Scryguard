import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const envAccess = [
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message: "Read process.env only in an app's src/config.ts or in packages/config.",
  },
  {
    selector: "MemberExpression[object.name='process'][computed=true][property.value='env']",
    message: "Read process.env only in an app's src/config.ts or in packages/config.",
  },
];

const scryguardApps = [
  '@scryguard/api',
  '@scryguard/api/*',
  '@scryguard/worker',
  '@scryguard/worker/*',
  '@scryguard/publisher',
  '@scryguard/publisher/*',
];

const crossWorkspaceRelative = {
  group: ['**/apps/**', '**/packages/**'],
  message: 'Import other workspaces by package name (@scryguard/...), not by relative path.',
};

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts', 'apps/*/vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', { patterns: [crossWorkspaceRelative] }],
    },
  },
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossWorkspaceRelative,
            {
              group: scryguardApps,
              message: 'Packages must not import apps. Move shared code into a package.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossWorkspaceRelative,
            {
              group: scryguardApps,
              message: 'Apps must not import other apps. Move shared code into a package.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: ['apps/*/src/config.ts', 'packages/config/src/**'],
    rules: {
      'no-restricted-syntax': ['error', ...envAccess],
    },
  },
);
