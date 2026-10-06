const js = require('@eslint/js');
const pluginCypress = require('eslint-plugin-cypress');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/', 'cypress/reports/', 'cypress/screenshots/', 'cypress/downloads/'],
  },

  js.configs.recommended,

  // Arquivos executados pelo Node (configurações do projeto).
  {
    files: ['*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // Specs, Page Objects, helpers e support: empacotados pelo Cypress.
  {
    files: ['cypress/**/*.js', 'parte*/**/*.js'],
    ...pluginCypress.configs.recommended,
    rules: {
      ...pluginCypress.configs.recommended.rules,
      // Esperas fixas são proibidas: sincronize por estado ou por alias.
      'cypress/no-unnecessary-waiting': 'error',
      'cypress/no-force': 'warn',
      'cypress/no-pause': 'error',
      'cypress/no-debug': 'error',
      'cypress/assertion-before-screenshot': 'warn',
    },
  },

  // Regras gerais de qualidade de código.
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'warn',
    },
  },
];
