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

| Comando                   | Descrição                                            |
| ------------------------- | ---------------------------------------------------- |
| `npm test`                | Executa todos os testes                              |
| `npm run cy:open`         | Abre o Cypress no modo interativo                    |
| `npm run test:smoke`      | Executa apenas os testes marcados com `@smoke`       |
| `npm run test:destrutivo` | Executa só o CT-RL-11 (esgota a cota real do GitHub) |
| `npm run lint`            | Analisa o código com ESLint                          |
| `npm run format:check`    | Verifica a formatação com Prettier                   |

O relatório HTML é gerado em `cypress/reports/index.html` ao final de cada execução.

### Teste destrutivo (CT-RL-11)

O `CT-RL-11` esgota de verdade a cota anônima da GitHub API (60 req/h por IP), bloqueando o IP por até 1 hora. Por isso ele fica em um spec próprio e aparece como **pendente** no `npm test`, o que é esperado. Para executá-lo, rode `npm run test:destrutivo` isoladamente. Em CI, use um job agendado ou manual, separado da regressão. Na hora seguinte, os testes reais do GitHub continuam passando, mas sem validar o caminho de sucesso (200).

## Configuração

As credenciais de demonstração usadas nos testes são públicas e já estão como padrão no bloco `env` do `cypress.config.js`, então nenhum setup extra é necessário. Elas são lidas com `cy.env()`, que não as exibe no Command Log.

Opcionalmente, um token do GitHub pode ser informado localmente:

```bash
cp cypress.env.example.json cypress.env.json   # preencha GITHUB_TOKEN
```

Em CI, use variáveis com prefixo `CYPRESS_` (ex.: `CYPRESS_GITHUB_TOKEN`).

### Cota do ReqRes

A chave pública `reqres-free-v1` é tratada pelo ReqRes como acesso anônimo de demonstração: **40 requisições por dia por IP**, com reset à meia-noite UTC. Cada execução do `api.spec.js` usa cerca de 7 chamadas, então cabem poucas execuções por dia.

Quando a cota acaba, os cenários do ReqRes falham com a mensagem `INCONCLUSIVO: cota do ReqRes esgotada (...)`, indicando o horário do reset. Isso não é defeito da aplicação nem do teste. Após o primeiro 429, as chamadas seguintes ao ReqRes não são enviadas, para não gastar mais cota.

Para mais execuções, use a chave de uma conta própria do ReqRes, fora do Git: `REQRES_API_KEY` no `cypress.env.json` ou `CYPRESS_REQRES_API_KEY` em CI. Em CI, rode os cenários do ReqRes uma única vez por pipeline.

## Estrutura do Projeto

```text
├── cypress/
│   └── support/
│       ├── e2e.js              # carregado antes de cada spec (plugins e commands)
│       └── commands.js         # custom commands compartilhados
├── parte1-api/
│   └── questao1.1/             # rate limiting (GitHub API) e token (ReqRes)
│       ├── RESPOSTA_TEORICA.md # respostas teóricas 1.1.a, 1.1.b e 1.1.c
│       ├── CASOS_DE_TESTE.txt  # estratégia, casos, prioridades e rastreabilidade
│       └── testes/
│           ├── api.spec.js     # testes automatizados (CT-RL-* e CT-TK-*)
│           ├── rate-limit-destrutivo.spec.js # CT-RL-11, sob demanda
│           └── utils/
│               └── api-helper.js # helper de rate limit e de token
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
