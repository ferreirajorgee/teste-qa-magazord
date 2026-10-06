# Questão 1.1 - Rate Limiting e Autenticação com Token

Implementação: [`testes/api.spec.js`](testes/api.spec.js) e [`testes/utils/api-helper.js`](testes/utils/api-helper.js).
Casos de teste, prioridades e rastreabilidade: [`CASOS_DE_TESTE.txt`](CASOS_DE_TESTE.txt).

## Premissa: separar a regra de decisão da chamada de rede

Rate limit e expiração de token são comportamentos **dependentes de tempo e de estado externo** (cota consumida por outros processos no mesmo IP, relógio, janela de 1 hora). Testá-los só com chamadas reais gera testes lentos, destrutivos e instáveis. Por isso a suíte tem duas camadas:

| Camada                                | O que valida                                                                                         | Custo de cota |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- |
| Funções puras com respostas simuladas | Regras de decisão: classificar 403/429, calcular espera, decidir se o token expirou, classificar 401 | Zero          |
| Chamadas reais (GitHub e ReqRes)      | Contrato: headers presentes e coerentes, login, erros 400, envio do token, renovação                 | Mínimo        |

O helper concentra as duas coisas: funções puras (`analisarRateLimit`, `tokenExpirado`, `analisarRespostaAutenticada`) e funções com `cy` que as usam sobre respostas reais. Assim, a mesma lógica testada com respostas simuladas é a que roda no fluxo real.

---

## 1.1.a) Como estruturar testes de rate limiting e do comportamento ao exceder o limite

**1. Validar o contrato dos headers em toda resposta (barato e sempre executado).**
A cada `GET /users/github`, os testes verificam:

- `X-RateLimit-Limit`: inteiro positivo, e igual a 60 sem token ou 5000 com `GITHUB_TOKEN`;
- `X-RateLimit-Remaining`: inteiro entre 0 e o limite;
- `X-RateLimit-Used`: igual a `Limit - Remaining` (invariante);
- `X-RateLimit-Reset`: epoch no futuro e no máximo 1 hora à frente. A comparação usa o header `Date` do servidor, e não o relógio da máquina, para não falhar por diferença de fuso ou relógio desajustado;
- `X-RateLimit-Resource`: `core`;
- entre duas chamadas consecutivas, `Remaining` diminui **pelo menos** 1 (outros processos no mesmo IP podem consumir cota em paralelo, então a asserção não exige exatamente 1).

**2. Validar a detecção do bloqueio sem esgotar a cota de verdade.**
A regra "esta resposta é rate limit?" é uma função pura testada com respostas simuladas:

| Resposta                                                  | Classificação esperada                    |
| --------------------------------------------------------- | ----------------------------------------- |
| 403 + `Remaining: 0` + "API rate limit exceeded"          | rate limit primário; espera até o `Reset` |
| 429 + `Retry-After`                                       | rate limit; espera = `Retry-After`        |
| 403 + "secondary rate limit" (com cota primária sobrando) | rate limit secundário                     |
| 403 por permissão ("Resource not accessible...")          | **não** é rate limit (acesso negado)      |
| 200 + `Remaining: 0`                                      | atendida, mas próxima será bloqueada      |
| `Reset` já no passado                                     | espera 0                                  |

A distinção entre 403 de rate limit e 403 por outra causa é o ponto mais importante: tratar todo 403 como limite esconderia falhas de permissão, e o contrário faria o teste falhar sem explicar o motivo.

Por que não `cy.intercept`? Ele intercepta apenas requisições feitas pelo navegador da aplicação; `cy.request` sai pelo processo do Cypress e não passa pelo intercept. Para chamadas de API, a forma correta de simular respostas é testar a função de decisão diretamente.

**3. Teste real de esgotamento: opcional e isolado.**
Esgotar 60 req/h de verdade consome a cota de todo o IP por até 1 hora, quebra os outros testes do GitHub da mesma execução e, em CI com IP compartilhado, depende do que outras pipelines fizeram. Por isso o `CT-RL-11` existe, mas fica em um spec próprio (`rate-limit-destrutivo.spec.js`), desligado por padrão, e é executado sob demanda por um script que roda só esse spec, sempre de forma anônima (sem token), para que o limite seja 60:

```bash
npm run test:destrutivo
```

Antes de consumir a cota, ele consulta `GET /rate_limit` (que não consome cota) e falha como inconclusivo se a cota já estiver zerada. Depois faz chamadas até o primeiro bloqueio e valida: status 403 classificado como rate limit primário, mensagem "API rate limit exceeded", `Remaining: 0`, espera dentro da janela (calculada com o relógio do servidor), que a requisição anterior foi atendida com `Remaining: 0` e que o bloqueio ocorreu em no máximo `cota inicial + 1` chamadas.

Em CI, o lugar dele é um job agendado ou manual, separado da regressão e de qualquer outro job que use a GitHub API no mesmo runner.

**4. Resiliência quando a cota já está esgotada no ambiente.**
Os headers chegam também no 403, então o `CT-RL-01` aceita 200 ou 403/429 desde que a classificação seja coerente com o status, e continua validando os headers. O `CT-RL-10` aplica o classificador à resposta real: se veio 200, não pode estar marcado como limitado e o corpo deve ser o usuário `github`; se veio bloqueio, a mensagem deve citar rate limit e a espera deve ser calculável.

**5. Em um produto real**, eu complementaria com: testes de integração do componente de rate limit com relógio controlado (limite configurado baixo, por exemplo 3 req, em ambiente de teste), teste de reset da janela, de isolamento entre clientes (o consumo de um não afeta o outro) e de concorrência (N chamadas paralelas não ultrapassam o limite). Esses testes dependem de controlar a configuração do servidor, o que não é possível em APIs públicas.

---

## 1.1.b) Como obter e reutilizar o token entre testes, evitando login a cada teste

`criarGerenciadorToken({ ttlMs, agora })` mantém um cache em memória com `{ token, obtidoEm, logins }`:

- `obterToken()`: se há token e ele não expirou, devolve o token em cache; senão faz login (`POST /login` com `x-api-key`) e grava o horário de obtenção;
- a decisão é tomada **na execução** do comando (dentro de um `.then`), e não no momento em que o comando é enfileirado. Isso evita usar um estado desatualizado quando o relógio é avançado no mesmo teste;
- `logins` conta quantos logins foram feitos, o que permite provar a reutilização: o `CT-TK-02` verifica que, entre testes diferentes, foi feito um único login.

O gerenciador é criado uma vez no escopo do spec. O módulo do spec é carregado uma única vez por arquivo, então o cache sobrevive entre os `it`, mas não vaza para outros specs.

Alternativas consideradas:

| Alternativa                            | Por que não foi a escolha                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cy.session()`                         | Feito para estado do navegador (cookies, localStorage, sessionStorage). O token aqui é usado em `cy.request`, não fica no navegador; seria usar a ferramenta fora do propósito. |
| `before()` com login e variável global | Funciona, mas não trata expiração: o token seria usado mesmo vencido.                                                                                                           |
| `Cypress.env()` em tempo de execução   | O projeto reserva `cy.env()` para credenciais; guardar token em `Cypress.env` também o exporia em logs.                                                                         |
| `cy.task()` com cache no Node          | Seria a evolução para reaproveitar o token **entre specs** (o cache em memória zera a cada spec). Não foi necessário para uma questão com um único spec.                        |

As credenciais vêm de `cy.env()` e o login é feito com `log: false`, para que a senha não apareça no Command Log.

---

## 1.1.c) Como detectar que o token expirou e tratar o cenário no teste

**Detecção no cliente (pelo TTL).** O ReqRes devolve um token fixo e sem expiração, então a expiração é simulada com o TTL de 2 minutos (`TOKEN_TTL_MS`). A regra é `agora - obtidoEm >= TTL`: no instante exato do TTL o token já é considerado expirado, para nunca enviar um token no limite. O `CT-TK-07` cobre as bordas (recém-obtido, TTL - 1 ms, TTL exato, sem token).

**Sem esperar 2 minutos.** O "agora" é injetado no gerenciador por um relógio controlado (`criarRelogioControlado`), e os testes avançam o tempo com `relogio.avancar(ms)`. `cy.clock()`/`cy.tick()` não serviriam aqui: eles controlam o relógio da janela da aplicação, e testes de API não têm aplicação nem usam o `Date` dessa janela. O lint do projeto também proíbe `cy.wait()` com tempo fixo.

**Tratamento.** Há dois comportamentos, cada um com teste:

1. **Renovação automática** (`CT-TK-10`): `requisicaoAutenticada()` verifica o TTL antes de enviar; se expirou, faz novo login, envia o token renovado e o teste confirma que houve exatamente um login a mais e que o horário de obtenção foi atualizado;
2. **Erro claro** (`CT-TK-09`): quando o chamador exige um token válido sem renovar (`exigirTokenValido()`), recebe o erro `Token expirado: obtido há 120000 ms, TTL de 120000 ms.`, em vez de uma falha genérica de asserção mais adiante.

**Detecção no servidor (resposta 401).** Em uma API real, o sinal definitivo de token expirado é o 401. `analisarRespostaAutenticada()` classifica a resposta em `sucesso`, `token_rejeitado` (401), `rate_limit` ou `erro` (`CT-TK-11`). Em um produto real, ao receber `token_rejeitado` eu renovaria o token **uma única vez** e repetiria a chamada; um segundo 401 deve falhar o teste com mensagem explícita, para não mascarar um defeito de autenticação com um laço de tentativas.

### Comportamento atual do ReqRes (observado em 06/10/2026)

Durante a implementação foram verificados três pontos que divergem do enunciado e foram tratados de forma explícita:

1. **`x-api-key`**: todas as chamadas ao ReqRes enviam `x-api-key: reqres-free-v1`, como pede a documentação atual da plataforma. Na verificação, os endpoints legados (`/login`, `/users/2`) ainda responderam sem a chave, mas ela é o que identifica o cliente na cota e é exigida nos endpoints novos; enviá-la evita que a suíte quebre quando a exigência chegar aos legados.
2. **`Authorization: Bearer` é recusado em `/api/users/2`**: o ReqRes passou a interpretar esse header como chave de API (ou sessão de usuário da plataforma nova). Qualquer valor enviado nele, inclusive o token do `/login`, resulta em `401` com `X-Reqres-Help: missing_api_key`. Sem o header, o mesmo recurso responde `200`.
   - O `CT-TK-03` envia o token como o enunciado pede e valida o que é responsabilidade do cliente: o header saiu com o token em cache e sem novo login. Ele também documenta o `401` atual e confirma que o helper o classifica como `token_rejeitado`.
   - O `CT-TK-04` é um teste de controle: o mesmo recurso, sem `Bearer`, responde `200`. Ele isola a causa do 401 (o header, e não o recurso).
   - Se o ReqRes voltar a aceitar o `Bearer`, o `CT-TK-03` falha e sinaliza a mudança, o que é o comportamento desejado para um teste que caracteriza uma dependência externa.
3. **O ReqRes também tem rate limit**: `RateLimit-Limit: 20` por janela de 60 s e um limite diário na chave gratuita (`X-RateLimit-Limit: 40`, com reset à meia-noite UTC). A suíte foi desenhada para fazer poucas chamadas reais ao ReqRes (8 por execução completa) e o login informa no erro quando a falha foi por rate limit.

O login aceita qualquer senha para `eve.holt@reqres.in` (a API é de demonstração). Por isso não há caso de "senha incorreta": ele passaria a validar um comportamento que o ReqRes não implementa.
