# Teste QA - Jorge Ferreira

Automação de testes do teste técnico para Coordenador de Qualidade da Magazord.

## Tecnologias Utilizadas

- Node.js 24 LTS (versão de referência em `.nvmrc`)
- Cypress 16.1.1
- @cypress/grep: filtro de testes por tags
- cypress-mochawesome-reporter: relatório HTML com evidências
- @faker-js/faker: geração dinâmica de massa de dados
- ESLint (com `eslint-plugin-cypress`), Prettier e EditorConfig: padronização de código

## Pré-requisitos

- Node.js 22.13+ ou 24 LTS (recomendado o 24, conforme `.nvmrc`)

## Instalação

```bash
npm install
```

## Comandos

| Comando                | Descrição                                      |
| ---------------------- | ---------------------------------------------- |
| `npm test`             | Executa todos os testes                        |
| `npm run cy:open`      | Abre o Cypress no modo interativo              |
| `npm run test:smoke`   | Executa apenas os testes marcados com `@smoke` |
| `npm run lint`         | Analisa o código com ESLint                    |
| `npm run format:check` | Verifica a formatação com Prettier             |

O relatório HTML é gerado em `cypress/reports/index.html` ao final de cada execução.

## Configuração

As credenciais de demonstração usadas nos testes são públicas e já estão como padrão no bloco `env` do `cypress.config.js`, então nenhum setup extra é necessário. Elas são lidas com `cy.env()`, que não as exibe no Command Log.

Opcionalmente, um token do GitHub pode ser informado localmente:

```bash
cp cypress.env.example.json cypress.env.json   # preencha GITHUB_TOKEN
```

Em CI, use variáveis com prefixo `CYPRESS_` (ex.: `CYPRESS_GITHUB_TOKEN`).

## Estrutura do Projeto

```text
├── cypress/
│   └── support/
│       ├── e2e.js              # carregado antes de cada spec (plugins e commands)
│       └── commands.js         # custom commands compartilhados
├── cypress.config.js           # configuração única do Cypress
├── cypress.env.example.json    # modelo para credenciais locais opcionais
├── eslint.config.js            # regras de lint (inclui eslint-plugin-cypress)
└── package.json                # dependências e scripts
```

Saídas geradas (fora do Git): `cypress/reports/`, `cypress/screenshots/` e `cypress/downloads/`.

## Observações

### Decisões técnicas

- **Cypress 16 em vez do 13.x do modelo do enunciado**: o 13.x está sem manutenção e foi feito para o Node 18, já em fim de vida. O 16 é a versão estável atual e permite separar configuração pública de credenciais (ver abaixo).
- **Retries desligados** (`retries: 0`): instabilidade é tratada com sincronização por estado, e não mascarada por novas tentativas.
- **`cy.wait()` com tempo fixo é bloqueado pelo lint** (`cypress/no-unnecessary-waiting` como erro).
- **Separação entre configuração pública e credenciais**, usando `Cypress.expose()` e `cy.env()` do Cypress 16.
- **Versões fixadas** no `package.json` (sem `^`) para execução reproduzível.
