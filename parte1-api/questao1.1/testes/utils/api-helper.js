/**
 * Helper da Questão 1.1: rate limit (GitHub API) e token de curta duração (ReqRes).
 *
 * Organização:
 * - Funções puras (sem `cy`): leem headers, classificam respostas e decidem se o
 *   token expirou. São testadas com respostas simuladas, sem gastar cota das APIs.
 * - Funções com `cy`: fazem as requisições reais e usam as funções puras para
 *   decidir o que fazer com a resposta.
 */

export const HTTP = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  TOO_MANY_REQUESTS: 429,
};

/** Limites documentados da GitHub API para o recurso `core`. */
export const LIMITE_GITHUB = {
  SEM_AUTENTICACAO: 60,
  COM_AUTENTICACAO: 5000,
};

/** Janela do rate limit primário da GitHub API, em segundos. */
export const JANELA_GITHUB_SEGUNDOS = 3600;

const MENSAGEM_RATE_LIMIT_PRIMARIO = 'api rate limit exceeded';
const MENSAGEM_RATE_LIMIT_SECUNDARIO = 'secondary rate limit';

// ---------------------------------------------------------------------------
// Rate limit: funções puras
// ---------------------------------------------------------------------------

function paraInteiro(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }
  const numero = Number(valor);
  return Number.isInteger(numero) ? numero : null;
}

function normalizarHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([nome, valor]) => [nome.toLowerCase(), valor]),
  );
}

/**
 * Converte os headers de rate limit em números. Header ausente ou não numérico
 * vira `null`, para que o teste acuse o problema em vez de comparar `NaN`.
 */
export function lerHeadersRateLimit(headers) {
  const h = normalizarHeaders(headers);
  return {
    limite: paraInteiro(h['x-ratelimit-limit']),
    restante: paraInteiro(h['x-ratelimit-remaining']),
    usado: paraInteiro(h['x-ratelimit-used']),
    reset: paraInteiro(h['x-ratelimit-reset']),
    recurso: h['x-ratelimit-resource'] ?? null,
    retryAfter: paraInteiro(h['retry-after']),
  };
}

/**
 * Tempo a aguardar até poder repetir a chamada. `Retry-After` (segundos
 * relativos) tem precedência sobre `X-RateLimit-Reset` (epoch em segundos).
 * Reset no passado resulta em 0.
 */
export function calcularEsperaMs(rateLimit, agoraMs) {
  if (rateLimit.retryAfter !== null) {
    return rateLimit.retryAfter * 1000;
  }
  if (rateLimit.reset !== null) {
    return Math.max(rateLimit.reset * 1000 - agoraMs, 0);
  }
  return null;
}

/** Data/hora do servidor (header `Date`), imune a diferença de relógio da máquina. */
export function agoraDoServidorSegundos(resposta) {
  return Math.floor(Date.parse(resposta.headers.date) / 1000);
}

/**
 * Classifica uma resposta quanto a rate limit.
 *
 * - 429: rate limit (qualquer API).
 * - 403 com mensagem de limite secundário: rate limit secundário (GitHub).
 * - 403 com `X-RateLimit-Remaining: 0` ou mensagem "API rate limit exceeded":
 *   rate limit primário (GitHub).
 * - Outro 403: acesso negado por outra causa, NÃO é rate limit.
 *
 * `cotaEsgotada` indica que a próxima chamada será bloqueada, mesmo que esta
 * ainda tenha sido atendida (200 com Remaining 0).
 */
export function analisarRateLimit(resposta, agoraMs = Date.now()) {
  const rateLimit = lerHeadersRateLimit(resposta.headers);
  const mensagem = String(resposta.body?.message ?? '').toLowerCase();

  let motivo = null;
  if (resposta.status === HTTP.TOO_MANY_REQUESTS) {
    motivo = 'rate_limit';
  } else if (resposta.status === HTTP.FORBIDDEN) {
    if (mensagem.includes(MENSAGEM_RATE_LIMIT_SECUNDARIO)) {
      motivo = 'rate_limit_secundario';
    } else if (rateLimit.restante === 0 || mensagem.includes(MENSAGEM_RATE_LIMIT_PRIMARIO)) {
      motivo = 'rate_limit_primario';
    } else {
      motivo = 'acesso_negado';
    }
  }

  const limitado = motivo !== null && motivo !== 'acesso_negado';
  return {
    limitado,
    motivo,
    cotaEsgotada: rateLimit.restante === 0,
    esperaMs: limitado ? calcularEsperaMs(rateLimit, agoraMs) : null,
    rateLimit,
  };
}

// ---------------------------------------------------------------------------
// Rate limit: requisições reais à GitHub API
// ---------------------------------------------------------------------------

/**
 * GET na GitHub API. Usa `GITHUB_TOKEN` quando preenchido (limite 5000/h);
 * sem ele, a chamada é anônima (60/h por IP). `autenticar: false` força a
 * chamada anônima. Nunca falha por status: quem decide é o teste.
 *
 * Produz `{ resposta, autenticado }`.
 */
export function requisicaoGithub(caminho, { autenticar = true } = {}) {
  return cy.env(['GITHUB_TOKEN']).then(({ GITHUB_TOKEN }) => {
    const autenticado = autenticar && Boolean(GITHUB_TOKEN);
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (autenticado) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }

    return cy
      .request({
        method: 'GET',
        url: `${Cypress.expose('GITHUB_API_URL')}${caminho}`,
        headers,
        failOnStatusCode: false,
      })
      .then((resposta) => ({ resposta, autenticado }));
  });
}

/**
 * Cota anônima atual do recurso `core`, via GET /rate_limit. Essa rota não
 * consome a cota, então serve de pré-condição para o teste de esgotamento.
 *
 * Produz `{ limit, remaining, reset, used }`.
 */
export function consultarCotaGithub() {
  return requisicaoGithub('/rate_limit', { autenticar: false }).then(({ resposta }) => {
    const core = resposta.body?.resources?.core;
    if (resposta.status !== HTTP.OK || !core) {
      throw new Error(`Falha ao consultar /rate_limit: HTTP ${resposta.status}.`);
    }
    return core;
  });
}

/**
 * Faz chamadas anônimas até a API bloquear por rate limit primário. Produz a
 * resposta bloqueada, a última resposta atendida antes dela (ou `null`) e o
 * número de requisições feitas. Bloqueio por outro motivo (ex.: limite
 * secundário) interrompe com erro descritivo.
 * Destrutivo: consome toda a cota anônima do IP por até 1 hora.
 * Por isso só é usado no teste opcional (`GITHUB_ESGOTAR_COTA=true`).
 */
export function consumirCotaAteBloqueio(
  caminho,
  maxRequisicoes = LIMITE_GITHUB.SEM_AUTENTICACAO + 1,
) {
  const tentar = (numero, ultimaAtendida) =>
    requisicaoGithub(caminho, { autenticar: false }).then(({ resposta }) => {
      const { limitado, motivo } = analisarRateLimit(resposta);
      if (limitado) {
        if (motivo !== 'rate_limit_primario') {
          throw new Error(
            `Bloqueio na requisição ${numero} por "${motivo}" (HTTP ${resposta.status}), ` +
              'e não pela cota primária.',
          );
        }
        return cy.wrap({ resposta, ultimaAtendida, requisicoes: numero }, { log: false });
      }
      if (numero >= maxRequisicoes) {
        throw new Error(
          `A API não bloqueou após ${numero} requisições (limite esperado: ${LIMITE_GITHUB.SEM_AUTENTICACAO}).`,
        );
      }
      return tentar(numero + 1, resposta);
    });

  return tentar(1, null);
}

// ---------------------------------------------------------------------------
// Token: funções puras
// ---------------------------------------------------------------------------

/**
 * O token vale enquanto `idade < ttl`. No instante exato do TTL ele já é
 * considerado expirado (borda fechada), para nunca enviar um token no limite.
 */
export function tokenExpirado(obtidoEmMs, ttlMs, agoraMs) {
  if (obtidoEmMs === null || obtidoEmMs === undefined) {
    return true;
  }
  return agoraMs - obtidoEmMs >= ttlMs;
}

/**
 * Classifica a resposta de uma requisição autenticada:
 * `sucesso` (2xx), `token_rejeitado` (401), `rate_limit` (403/429 de limite)
 * ou `erro` (qualquer outra falha).
 */
export function analisarRespostaAutenticada(resposta) {
  if (resposta.status >= 200 && resposta.status < 300) {
    return 'sucesso';
  }
  if (resposta.status === HTTP.UNAUTHORIZED) {
    return 'token_rejeitado';
  }
  if (analisarRateLimit(resposta).limitado) {
    return 'rate_limit';
  }
  return 'erro';
}

/**
 * Relógio controlável para simular a passagem do tempo sem esperar de verdade.
 * `cy.clock()` só altera o relógio da aplicação (janela do navegador), e testes
 * de API não têm aplicação; por isso o "agora" é injetado no gerenciador.
 */
export function criarRelogioControlado(inicioMs = Date.now()) {
  let atualMs = inicioMs;
  return {
    agora: () => atualMs,
    avancar: (ms) => {
      atualMs += ms;
    },
  };
}

// ---------------------------------------------------------------------------
// Token: requisições reais ao ReqRes
// ---------------------------------------------------------------------------

function urlReqres(caminho) {
  return `${Cypress.expose('REQRES_API_URL')}${caminho}`;
}

/** Headers exigidos pelo ReqRes, com o token opcional em `Authorization`. */
export function montarHeadersReqres(apiKey, token) {
  const headers = { 'x-api-key': apiKey };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Instante (ms) em que a cota do ReqRes volta, a partir do corpo do 429
 * (`reset_at`, epoch em segundos) ou dos headers `Retry-After`/`X-RateLimit-Reset`.
 * `null` quando a resposta não informa.
 */
function resetCotaReqresMs(resposta, agoraMs) {
  const resetAt = paraInteiro(resposta.body?.reset_at);
  if (resetAt !== null) {
    return resetAt * 1000;
  }
  const esperaMs = calcularEsperaMs(lerHeadersRateLimit(resposta.headers), agoraMs);
  return esperaMs === null ? null : agoraMs + esperaMs;
}

/**
 * Mensagem padronizada para cota externa esgotada: deixa claro no relatório
 * que o resultado é inconclusivo, e não um defeito da aplicação ou do teste.
 */
export function mensagemCotaReqresEsgotada({
  limite = null,
  resetMs = null,
  detectadaAntes = false,
}) {
  const detalhes = [
    limite === null ? null : `limite ${limite} req/dia`,
    resetMs === null ? null : `reset em ${new Date(resetMs).toISOString()}`,
  ].filter(Boolean);
  const origem = detectadaAntes
    ? 'detectada em chamada anterior; requisição não enviada'
    : 'HTTP 429';
  return (
    `INCONCLUSIVO: cota do ReqRes esgotada (${origem}` +
    `${detalhes.length ? `, ${detalhes.join(', ')}` : ''}). ` +
    'Não é defeito da aplicação nem do teste.'
  );
}

// Circuit breaker da cota do ReqRes. Vive no escopo do módulo (um por spec):
// após o primeiro 429, as chamadas seguintes falham sem nova requisição, para
// não gastar mais cota nem repetir a mesma causa em formatos diferentes.
const cotaReqres = { esgotada: false, limite: null, resetMs: null };

function cotaReqresBloqueada(agoraMs) {
  return cotaReqres.esgotada && (cotaReqres.resetMs === null || agoraMs < cotaReqres.resetMs);
}

/**
 * Requisição ao ReqRes com `x-api-key` (e Bearer opcional). Nunca falha por
 * status, exceto por cota esgotada (429), que lança a mensagem INCONCLUSIVO.
 */
export function requisicaoReqres({ metodo = 'GET', caminho, token, body, log = true }) {
  return cy.env(['REQRES_API_KEY']).then(({ REQRES_API_KEY }) => {
    if (cotaReqresBloqueada(Date.now())) {
      throw new Error(mensagemCotaReqresEsgotada({ ...cotaReqres, detectadaAntes: true }));
    }

    return cy
      .request({
        method: metodo,
        url: urlReqres(caminho),
        headers: montarHeadersReqres(REQRES_API_KEY, token),
        body,
        failOnStatusCode: false,
        log,
      })
      .then((resposta) => {
        if (resposta.status === HTTP.TOO_MANY_REQUESTS) {
          Object.assign(cotaReqres, {
            esgotada: true,
            limite: paraInteiro(resposta.body?.limit),
            resetMs: resetCotaReqresMs(resposta, Date.now()),
          });
          throw new Error(mensagemCotaReqresEsgotada(cotaReqres));
        }
        return resposta;
      });
  });
}

/**
 * POST /login com o corpo informado, sem falhar por status. Usado diretamente
 * pelos testes negativos e, com as credenciais válidas, pelo gerenciador.
 */
export function loginReqres(corpo, { log = true } = {}) {
  return requisicaoReqres({ metodo: 'POST', caminho: '/login', body: corpo, log });
}

/**
 * Gerenciador de token com cache em memória.
 *
 * O estado vive no escopo do módulo do spec, que é carregado uma única vez por
 * arquivo: todos os testes do spec compartilham o mesmo token, e o login só é
 * refeito quando o TTL vence. Em outro spec o cache começa vazio.
 *
 * @param {{ ttlMs: number, agora?: () => number }} opcoes
 */
export function criarGerenciadorToken({ ttlMs, agora = () => Date.now() }) {
  const estado = { token: null, obtidoEm: null, logins: 0 };

  function situacao() {
    if (estado.token === null) {
      return { status: 'ausente', idadeMs: null };
    }
    const idadeMs = agora() - estado.obtidoEm;
    const status = tokenExpirado(estado.obtidoEm, ttlMs, agora()) ? 'expirado' : 'valido';
    return { status, idadeMs };
  }

  /** Lança erro descritivo se não houver token válido. Não faz login. */
  function exigirTokenValido() {
    const { status, idadeMs } = situacao();
    if (status === 'ausente') {
      throw new Error('Token ausente: faça o login antes da requisição autenticada.');
    }
    if (status === 'expirado') {
      throw new Error(`Token expirado: obtido há ${idadeMs} ms, TTL de ${ttlMs} ms.`);
    }
    return estado.token;
  }

  function login() {
    return cy
      .env(['REQRES_EMAIL', 'REQRES_PASSWORD'])
      .then(({ REQRES_EMAIL, REQRES_PASSWORD }) =>
        loginReqres({ email: REQRES_EMAIL, password: REQRES_PASSWORD }, { log: false }),
      )
      .then((resposta) => {
        const token = resposta.body?.token;
        if (resposta.status !== HTTP.OK || typeof token !== 'string' || token === '') {
          // Resumo do erro, sem despejar o corpo inteiro no relatório.
          const motivo = resposta.body?.error ?? resposta.body?.message ?? 'sem token na resposta';
          throw new Error(`Falha no login do ReqRes: HTTP ${resposta.status} - ${motivo}`);
        }
        estado.token = token;
        estado.obtidoEm = agora();
        estado.logins += 1;
        cy.log(`Login no ReqRes realizado (login nº ${estado.logins})`);
        return cy.wrap(token, { log: false });
      });
  }

  /**
   * Reutiliza o token em cache se ainda válido; senão faz um novo login.
   * A decisão é tomada na execução do comando (não no enfileiramento), para
   * enxergar avanços de relógio feitos por comandos anteriores do teste.
   */
  function obterToken() {
    return cy.wrap(null, { log: false }).then(() => {
      if (situacao().status === 'valido') {
        return cy.wrap(estado.token, { log: false });
      }
      return login();
    });
  }

  /**
   * Requisição ao ReqRes com o token no header `Authorization: Bearer`.
   * Se o token expirou pelo TTL, renova antes de enviar (renovação proativa).
   * Produz `{ resposta, token, classificacao }`.
   */
  function requisicaoAutenticada({ metodo = 'GET', caminho }) {
    return obterToken().then((token) =>
      requisicaoReqres({ metodo, caminho, token }).then((resposta) => ({
        resposta,
        token,
        classificacao: analisarRespostaAutenticada(resposta),
      })),
    );
  }

  return {
    obterToken,
    requisicaoAutenticada,
    exigirTokenValido,
    situacao,
    /** Cópia do estado, para asserções (quantidade de logins, horário). */
    estado: () => ({ ...estado }),
  };
}
