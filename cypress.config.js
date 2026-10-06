const { defineConfig } = require('cypress');
const { plugin: cypressGrepPlugin } = require('@cypress/grep/plugin');

/**
 * Configuração única do Cypress para as Partes 1, 2 e 3.
 *
 * - `expose`: valores públicos (URLs, flags), lidos com `Cypress.expose('CHAVE')`.
 * - `env`: credenciais, lidas com `cy.env(['CHAVE'])`, que não as registra no
 *   Command Log. Os defaults abaixo são as credenciais de demonstração publicadas
 *   pelos próprios sites, para que `npm install && npm test` rode sem setup.
 *   Podem ser sobrescritas por `cypress.env.json` (fora do Git) ou por variáveis
 *   `CYPRESS_*` em CI.
 */
module.exports = defineConfig({
  reporter: 'cypress-mochawesome-reporter',
  reporterOptions: {
    reportDir: 'cypress/reports',
    reportPageTitle: 'Teste QA Magazord - Relatório de Execução',
    charts: true,
    embeddedScreenshots: true,
    inlineAssets: true,
  },

  // Flakiness é tratada com sincronização por estado, não mascarada por retry.
  retries: 0,

  defaultCommandTimeout: 8000,
  requestTimeout: 15000,
  responseTimeout: 30000,

  viewportWidth: 1366,
  viewportHeight: 768,

  expose: {
    SAUCE_URL: 'https://www.saucedemo.com',
    UPLOAD_URL: 'https://the-internet.herokuapp.com/upload',
    GITHUB_API_URL: 'https://api.github.com',
    REQRES_API_URL: 'https://reqres.in/api',

    // Tempo de vida simulado do token do ReqRes (2 minutos, conforme enunciado).
    TOKEN_TTL_MS: 120000,

    // @cypress/grep: ao filtrar por tag, só abre os specs que contêm a tag.
    grepFilterSpecs: true,
  },

  env: {
    SAUCE_USERNAME: 'standard_user',
    SAUCE_PASSWORD: 'secret_sauce',
    REQRES_EMAIL: 'eve.holt@reqres.in',
    REQRES_PASSWORD: 'cityslicka',
    REQRES_API_KEY: 'reqres-free-v1',
    // Opcional: sem token, a GitHub API é usada sem autenticação (60 req/h).
    GITHUB_TOKEN: '',
  },

  e2e: {
    // Os entregáveis ficam em parteN/ por exigência do enunciado;
    // cypress/ guarda só a infraestrutura padrão (support) e as saídas geradas.
    specPattern: 'parte*/**/*.spec.js',
    // Fixtures ficam em parteN/.../testes/fixtures e são importadas diretamente.
    fixturesFolder: false,

    setupNodeEvents(on, config) {
      require('cypress-mochawesome-reporter/plugin')(on);
      cypressGrepPlugin(config);
      return config;
    },
  },
});
