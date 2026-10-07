# Questão 1.1 - Rate Limiting e Autenticação com Token

Implementação: [`testes/api.spec.js`](testes/api.spec.js) e [`testes/utils/api-helper.js`](testes/utils/api-helper.js).

| #   | Teste (enunciado)                                      | Função principal do helper               |
| --- | ------------------------------------------------------ | ---------------------------------------- |
| 1   | Valida os headers `X-RateLimit-*` do GitHub            | `lerRateLimit`                           |
| 2   | Detecta o rate limit atingido (403)                    | `rateLimitAtingido`                      |
| 3   | Login no ReqRes e reutilização do token                | `loginReqres`, `requisicaoReqres`        |
| 4   | Simula a expiração do token (2 minutos) e trata o erro | `exigirTokenValido`, `renovarSeExpirado` |

## Premissa: separar a regra de decisão da chamada de rede

Rate limit e expiração de token dependem de **tempo e de estado externo** (cota consumida por outros processos no mesmo IP, relógio, janela de 1 hora). Testá-los só com chamadas reais gera testes lentos, destrutivos e instáveis. Por isso o helper separa:

- **funções puras**, que só decidem (`rateLimitAtingido`, `tokenExpirado`, `exigirTokenValido`) e podem ser testadas com respostas e horários simulados;
- **funções com `cy.request`**, que fazem as chamadas reais (`requisicaoGithub`, `loginReqres`, `requisicaoReqres`).

A mesma regra validada com dados simulados é a que roda sobre as respostas reais.

---

## 1.1.a) Como estruturar testes de rate limiting e do comportamento ao exceder o limite

**1. Validar o contrato dos headers em toda resposta (teste 1).**
Em `GET /users/github`, o teste verifica:

- `X-RateLimit-Limit`: 60 sem token ou 5000 com `GITHUB_TOKEN`;
- `X-RateLimit-Remaining`: inteiro entre 0 e o limite;
- `X-RateLimit-Reset`: epoch no futuro. A comparação usa o header `Date` do servidor, e não o relógio da máquina, para não falhar por relógio desajustado.

O teste aceita 200 ou 403, porque os headers também vêm quando a cota já está esgotada.

**2. Validar a detecção do bloqueio sem esgotar a cota de verdade (teste 2).**
A regra "esta resposta é rate limit?" é a função `rateLimitAtingido`: **status 403 com `X-RateLimit-Remaining: 0`**. O teste a valida com duas respostas simuladas e depois a aplica à resposta real:

| Resposta                | Esperado                                       |
| ----------------------- | ---------------------------------------------- |
| 403 + `Remaining: 0`    | rate limit atingido                            |
| 403 + cota sobrando     | **não** é rate limit (ex.: falta de permissão) |
| resposta real do GitHub | detecção coerente com o status recebido        |

Distinguir 403 de rate limit de 403 por outra causa é o ponto mais importante: tratar todo 403 como limite esconderia falhas de permissão.

Por que não `cy.intercept`? Ele intercepta apenas requisições feitas pelo navegador; `cy.request` sai pelo processo do Cypress e não passa pelo intercept. Para chamadas de API, a forma de simular respostas é testar a função de decisão diretamente.

**3. Esgotamento real: opcional.**
Esgotar 60 req/h de verdade bloqueia o IP por até 1 hora e, em CI com IP compartilhado, depende do que outras pipelines fizeram. Por isso o modo real do teste 2 fica atrás da flag `GITHUB_ESGOTAR_COTA` (desligada por padrão) e é executado sob demanda:

```bash
npm run test:destrutivo
```

Nesse modo, `requisitarAteRateLimit` repete a requisição até o bloqueio e o teste valida o status 403, a mensagem "rate limit exceeded" e a detecção pelo helper. Em CI, o lugar dele é um job agendado ou manual, separado da regressão.

**4. Em um produto real**, eu complementaria com testes do componente de rate limit em ambiente controlado (limite configurado baixo, por exemplo 3 req), reset da janela, isolamento entre clientes e concorrência. Esses testes dependem de controlar a configuração do servidor, o que não é possível em APIs públicas.

---

## 1.1.b) Como obter e reutilizar o token entre testes, evitando login a cada teste

`loginReqres()` faz `POST /login` e devolve uma sessão `{ token, obtidoEm }`. O token é reutilizado passando essa sessão adiante: `requisicaoReqres({ caminho, token })` monta o header `Authorization: Bearer <token>`, e o teste 3 confere que o header enviado é exatamente o token obtido no login.

Para reaproveitar o token entre vários `it`, basta fazer o login uma vez (em um `before`) e guardar a sessão em uma variável do spec, renovando-a com `renovarSeExpirado` antes de usar. Como a questão pede um fluxo simples com um único teste autenticado, o spec não precisou desse cache.

Alternativas consideradas:

| Alternativa                          | Observação                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cy.session()`                       | Feito para estado do navegador (cookies, localStorage). O token aqui é usado em `cy.request`, não fica no navegador.                                  |
| `before()` sem checar expiração      | Funciona, mas usaria o token mesmo vencido. Por isso a renovação passa por `renovarSeExpirado`.                                                       |
| `Cypress.env()` em tempo de execução | O projeto reserva `cy.env()` para credenciais; guardar o token ali também o exporia em logs.                                                          |
| `cy.task()` com cache no Node        | Evolução para reaproveitar o token **entre specs** (uma variável do spec zera a cada arquivo). Não foi necessário para uma questão com um único spec. |

As credenciais vêm de `cy.env()`, que não as registra no Command Log.

---

## 1.1.c) Como detectar que o token expirou e tratar o cenário no teste

**Detecção pelo TTL.** O ReqRes devolve um token fixo e sem expiração, então a expiração é simulada com o TTL de 2 minutos (`TOKEN_TTL_MS`). A regra (`tokenExpirado`) é `agora - obtidoEm >= TTL`: no instante exato do TTL o token já é considerado expirado.

**Sem esperar 2 minutos.** As funções recebem o "agora" como parâmetro, então o teste 4 calcula os instantes `TTL - 1 ms` e `TTL` a partir do horário do login. `cy.clock()`/`cy.tick()` não serviriam: eles controlam o relógio da janela da aplicação, e testes de API não têm aplicação. O lint do projeto também proíbe `cy.wait()` com tempo fixo.

**Tratamento do erro (teste 4).**

1. **Erro claro:** `exigirTokenValido()` devolve o token enquanto ele é válido e, após o TTL, lança `Token expirado: obtido há 120000 ms, TTL de 120000 ms.`, em vez de uma falha genérica mais adiante;
2. **Renovação:** `renovarSeExpirado()` faz um novo login quando o token expirou; o teste confirma que veio um token e que o horário de obtenção foi atualizado.

**Detecção no servidor (401).** Em uma API real, o sinal definitivo de token expirado é o 401. Ao recebê-lo, eu renovaria o token **uma única vez** e repetiria a chamada; um segundo 401 deve falhar o teste com mensagem explícita, para não mascarar um defeito de autenticação com um laço de tentativas.

### Comportamento atual do ReqRes (observado em 06/10/2026)

1. **`x-api-key`**: todas as chamadas ao ReqRes enviam `x-api-key: reqres-free-v1`, como pede a documentação atual da plataforma.
2. **`Authorization: Bearer` é recusado em `/api/users/2`**: o ReqRes passou a interpretar esse header como chave de API. Qualquer valor enviado nele, inclusive o token do `/login`, resulta em `401` com `X-Reqres-Help: missing_api_key`. O teste 3 envia o token como o enunciado pede, valida que o header saiu com o token obtido e aceita `200` (comportamento descrito no enunciado, conferindo o usuário 2) ou `401` (comportamento atual).
3. **O ReqRes também tem rate limit** (20 req por minuto e limite diário na chave gratuita). A suíte faz poucas chamadas reais ao ReqRes (4 por execução).

O login aceita qualquer senha para `eve.holt@reqres.in` (a API é de demonstração). Por isso não há caso de "senha incorreta": ele validaria um comportamento que o ReqRes não implementa.
