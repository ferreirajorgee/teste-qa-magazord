# Teste QA Sênior - Jorge Ferreira

Automação e respostas do teste técnico para Coordenador de Qualidade de Software da Magazord.

## Tecnologias Utilizadas

- Node.js 22.13+ ou 24 LTS (recomendado o 24, versão de referência no `.nvmrc`)
- Cypress 16.1.1
- @cypress/grep: filtro de testes por tags
- cypress-mochawesome-reporter: relatório HTML com evidências
- @faker-js/faker: geração dinâmica de massa de dados
- ESLint (com `eslint-plugin-cypress`), Prettier e EditorConfig: padronização de código

## Instalação

```bash
npm install
```

Nenhuma configuração adicional é necessária: as credenciais usadas são as de demonstração publicadas pelos próprios sites (ver [Configuração](#configuração-opcional)).

## Execução dos Testes

### Todos os testes

```bash
npm test
```

### Por parte

```bash
npm run test:parte1   # API: rate limit (GitHub) e token (ReqRes)
npm run test:parte2   # E2E: checkout no SauceDemo
npm run test:parte3   # Arquivos: importação de CSV (the-internet)
# Partes 4 e 5 são teóricas, sem script de execução
```

### Outros comandos

| Comando                   | Descrição                                             |
| ------------------------- | ----------------------------------------------------- |
| `npm run cy:open`         | Abre o Cypress no modo interativo                     |
| `npm run test:smoke`      | Executa apenas os testes marcados com `@smoke`        |
| `npm run test:destrutivo` | Executa a Questão 1.1 esgotando a cota real do GitHub |
| `npm run lint`            | Analisa o código com ESLint                           |
| `npm run format:check`    | Verifica a formatação com Prettier                    |

O relatório HTML é gerado em `cypress/reports/index.html` ao final de cada execução.

### Rate limit real do GitHub (opcional)

Por padrão, o teste 2 da Questão 1.1 (detecção do 403) valida a detecção sem esgotar a cota. Com `npm run test:destrutivo` (flag `GITHUB_ESGOTAR_COTA=true`), ele faz requisições reais até a GitHub API bloquear, o que consome a cota anônima do IP (60 req/h) por até 1 hora. Em CI, esse modo deve rodar em um job agendado ou manual, separado da regressão.

### Reproduzir uma falha com a mesma massa de dados

Os dados do comprador (Parte 2) e os CSVs de 10, 100 e 1000 linhas (Parte 3) são gerados com faker a cada teste. A seed usada aparece no Command Log e no relatório HTML. Para repetir a execução com os mesmos dados:

```bash
npx cypress run --spec "parte2-e2e/**/*.spec.js" --expose FAKER_SEED=<seed>
npx cypress run --spec "parte3-arquivos/**/*.spec.js" --expose FAKER_SEED=<seed>
```

Os CSVs são gerados em memória; nada é gravado em disco.

### Configuração (opcional)

As credenciais de demonstração já estão como padrão no bloco `env` do `cypress.config.js` e são lidas com `cy.env()`, que não as exibe no Command Log. Não são segredos: `standard_user` / `secret_sauce` aparecem na própria tela do SauceDemo, o login do ReqRes está na documentação pública dele e ambos constam no enunciado. Specs e Page Objects não contêm credenciais.

Para usar outros valores, sobrescreva os padrões com `cypress.env.json` (fora do Git) ou com variáveis `CYPRESS_*` em CI (ex.: `CYPRESS_SAUCE_PASSWORD`). Um token do GitHub, que eleva o limite para 5000 req/h, pode ser informado assim:

```bash
cp cypress.env.example.json cypress.env.json   # preencha GITHUB_TOKEN
```

## Estrutura do Projeto

```text
├── cypress/
│   └── support/
│       ├── e2e.js              # carregado antes de cada spec (plugins e commands)
│       ├── commands.js         # custom commands compartilhados
│       └── seed.js             # leitura de FAKER_SEED, compartilhada pelas Partes 2 e 3
├── parte1-api/
│   └── questao1.1/             # rate limiting (GitHub API) e token (ReqRes)
│       ├── RESPOSTA_TEORICA.md # respostas teóricas 1.1.a, 1.1.b e 1.1.c
│       └── testes/
│           ├── api.spec.js     # os 4 testes do enunciado
│           └── utils/
│               └── api-helper.js # helper de rate limit e de token
├── parte2-e2e/
│   └── questao2.1/             # fluxo de checkout (SauceDemo)
│       ├── RESPOSTA_TEORICA.md # respostas teóricas 2.1.a e 2.1.b
│       ├── CASOS_DE_TESTE.txt  # estratégia, casos, prioridades e rastreabilidade
│       └── testes/
│           ├── checkout-flow.spec.js # testes automatizados (CT-CK-* e CT-IS-*)
│           ├── pages/          # Page Objects (login, inventory, cart, checkout, header)
│           ├── fixtures/
│           │   ├── checkout-data.js # gerador de dados do comprador (faker com seed)
│           │   └── products.js # catálogo e totais de referência
│           └── utils/
│               ├── routes.js   # páginas, URLs, cookie/chave do carrinho e ids de botões
│               ├── prices.js   # conversão de preços e cálculo de totais (funções puras)
│               └── checkout-helper.js # estado do navegador: sessão, carrinho e limpeza
├── parte3-arquivos/
│   └── questao3.1/             # importação de CSV (the-internet /upload)
│       ├── RESPOSTA_TEORICA.md # respostas teóricas 3.1.a e 3.1.b
│       ├── CASOS_DE_TESTE.txt  # estratégia, casos, prioridades e rastreabilidade
│       └── testes/
│           ├── csv-upload.spec.js # testes automatizados (CT-UP-*)
│           ├── pages/
│           │   └── upload-page.js # Page Object da página de upload
│           ├── fixtures/       # CSVs: válido, vazio, formato incorreto, malformado, corrompido
│           └── utils/
│               ├── csv-generator.js # gerador de CSV (10/100/1000 linhas, faker com seed)
│               ├── csv-validator.js # validador de referência (oráculo do importador)
│               └── multipart.js # leitura do arquivo no corpo do POST /upload
├── parte4-mobile/
│   └── questao4.1/             # automação mobile (teórica)
│       └── RESPOSTA_TEORICA.md # respostas teóricas 4.1.a a 4.1.e
├── parte5-mocks/
│   └── questao5.1/             # mocks de APIs de marketplaces (teórica)
│       └── RESPOSTA_TEORICA.md # respostas teóricas 5.1.a a 5.1.e
├── cypress.config.js           # configuração única do Cypress
├── cypress.env.example.json    # modelo para credenciais locais opcionais
├── eslint.config.js            # regras de lint (inclui eslint-plugin-cypress)
└── package.json                # dependências e scripts
```

Saídas geradas (fora do Git): `cypress/reports/`, `cypress/screenshots/` e `cypress/downloads/`.

As Partes 4 (mobile) e 5 (mocks e integrações) são teóricas: não têm specs nem script `npm run`. As respostas estão nos respectivos `RESPOSTA_TEORICA.md`.

### Organização do código

- **Specs** (`*.spec.js`): cenários e asserções de regra de negócio. Os títulos usam os mesmos IDs do `CASOS_DE_TESTE.txt` (CT-CK-01, CT-UP-03...), o que liga cada teste à sua especificação.
- **Page Objects** (`pages/`): seletores e ações de tela. Só verificam navegação e sincronização (página aberta, botão trocado); as regras de negócio ficam no spec.
- **Utils e fixtures**: funções puras (cálculo de totais, geração e validação de CSV) e massa de dados, sem comandos `cy`, para poderem ser testadas e reutilizadas isoladamente.
- **Nomes**: arquivos, classes e instâncias de Page Object em inglês (`cart-page.js`, `CartPage`, `cartPage`, `csv-generator.js`), seguindo os nomes do enunciado e das páginas do site; as demais funções, variáveis, constantes, comentários e mensagens de teste em português, com funções começando por verbo no infinitivo (`validarAberta`, `gerarCsv`, `prepararSessao`).

## Observações

### Decisões técnicas

- **Cypress 16 em vez do 13.x do modelo do enunciado**: o 13.x está sem manutenção e foi feito para o Node 18, já em fim de vida. O 16 é a versão estável atual e permite separar configuração pública de credenciais (ver abaixo).
- **Retries desligados** (`retries: 0`): instabilidade é tratada com sincronização por estado, e não mascarada por novas tentativas.
- **`cy.wait()` com tempo fixo é bloqueado pelo lint** (`cypress/no-unnecessary-waiting` como erro).
- **Separação entre configuração pública e credenciais**, usando `Cypress.expose()` e `cy.env()` do Cypress 16.
- **Versões fixadas** no `package.json` (sem `^`) para execução reproduzível.
- **Limpeza explícita na Parte 2**: o `afterEach` limpa cookies, localStorage e sessionStorage e confere que ficaram vazios. O bloco de isolamento roda com `testIsolation: false`, para que a prova da limpeza venha dos hooks do spec e não do isolamento automático do Cypress. `cy.session` não é usado, para não conflitar com essa limpeza.
- **Parte 3 sem gravação em disco**: o CSV gerado é enviado com `cy.selectFile({ contents })`, então não foi preciso `cy.task` nem alterar o `cypress.config.js`.
- **Validador de referência na Parte 3**: o the-internet aceita qualquer arquivo e não lê o conteúdo. Um validador próprio faz o papel do importador real e prova, antes do upload, que cada CSV é válido ou tem exatamente os defeitos esperados. Detalhes em `parte3-arquivos/questao3.1/RESPOSTA_TEORICA.md`.
- **Cupom e pagamento não são automatizados**: o SauceDemo não tem cupom, gateway de pagamento nem e-mail de confirmação. A estratégia para esses pontos está em `parte2-e2e/questao2.1/RESPOSTA_TEORICA.md`.

### Dificuldades encontradas

- **Dependência de sites públicos**: os testes rodam contra serviços reais (GitHub API, ReqRes, SauceDemo e the-internet) e com `retries: 0`. Se um desses sites estiver fora do ar, os testes dele falham. Nesse caso, a falha é do ambiente, não da aplicação nem do teste.
- **Cota do ReqRes**: a chave pública `reqres-free-v1` permite 40 requisições por dia por IP, com reset à meia-noite UTC. Cada execução do `api.spec.js` usa 4 chamadas, então cabem poucas execuções por dia. Quando a cota acaba, os testes falham com `Falha no login do ReqRes: HTTP 429`, o que não é defeito da aplicação nem do teste. Para mais execuções, use a chave de uma conta própria do ReqRes (`REQRES_API_KEY` no `cypress.env.json` ou `CYPRESS_REQRES_API_KEY` em CI).
- **Cypress no terminal integrado do VS Code**: alguns terminais integrados (VS Code e ferramentas baseadas em Electron) definem `ELECTRON_RUN_AS_NODE=1`. Com isso, o Cypress sobe como Node puro e falha com `Illegal instruction` ou `bad option: --smoke-test`. Num terminal comum isso não acontece. Se acontecer, remova a variável antes de rodar:
  - Git Bash/Linux/macOS: `env -u ELECTRON_RUN_AS_NODE npm test`
  - PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE; npm test`
- **Deep-link do SauceDemo**: abrir `/inventory.html` direto responde 404, porque o site é uma SPA hospedada no GitHub Pages. Os testes usam o formato de deep-link do próprio site (`/?/inventory.html`).
- **the-internet (Parte 3)**: o Heroku responde 503 de vez em quando, ao abrir a página ou no upload; o teste falha com `INCONCLUSIVO`, indicando problema de ambiente. O primeiro carregamento da página às vezes leva cerca de 30 s (latência do Heroku); fica dentro do `pageLoadTimeout` padrão. Enviar o formulário sem arquivo gera HTTP 500 no site (defeito D01, documentado no CT-UP-06).
- **Usuário bloqueado (CT-CK-12)**: o SauceDemo grava o cookie de sessão antes de checar o bloqueio. Por isso, o teste valida que a loja continua fechada, e não que o cookie não existe.
