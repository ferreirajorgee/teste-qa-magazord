/**
 * Helper da Questão 1.1: rate limit (GitHub API) e token (ReqRes).
 */

// ---------------------------------------------------------------------------
// Rate limit (GitHub API)
// ---------------------------------------------------------------------------

/** Limite anônimo da GitHub API (req/h por IP). */
export const LIMITE_GITHUB_SEM_AUTENTICACAO = 60;

/**
 * Lê os headers de rate limit como números.
 * @returns {{ limite: number, restante: number, reset: number }}
 */
export function lerRateLimit(headers) {
  return {
    limite: Number(headers['x-ratelimit-limit']),
    restante: Number(headers['x-ratelimit-remaining']),
    reset: Number(headers['x-ratelimit-reset']),
  };
}

/**
 * Rate limit atingido = status 403 com `X-RateLimit-Remaining: 0`.
 * Um 403 com cota sobrando é outro erro (ex.: falta de permissão), não rate limit.
 */
export function rateLimitAtingido(resposta) {
  return resposta.status === 403 && lerRateLimit(resposta.headers).restante === 0;
}

/**
 * GET na GitHub API sem falhar por status (quem decide é o teste).
 * Usa `GITHUB_TOKEN` se preenchido (5000 req/h); sem ele, é anônima (60 req/h).
 */
export function requisicaoGithub(caminho) {
  return cy.env(['GITHUB_TOKEN']).then(({ GITHUB_TOKEN }) =>
    cy.request({
      url: `${Cypress.expose('GITHUB_API_URL')}${caminho}`,
      headers: GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {},
      failOnStatusCode: false,
    }),
  );
}

/**
 * Repete a requisição até o rate limit ser atingido e produz a resposta 403.
 * Destrutivo: consome a cota real do IP por até 1 hora.
 */
export function requisitarAteRateLimit(caminho, tentativa = 1) {
  return requisicaoGithub(caminho).then((resposta) => {
    if (rateLimitAtingido(resposta)) {
      return resposta;
    }
    if (tentativa > LIMITE_GITHUB_SEM_AUTENTICACAO) {
      throw new Error(`Rate limit não atingido após ${tentativa} requisições.`);
    }
    return requisitarAteRateLimit(caminho, tentativa + 1);
  });
}

// ---------------------------------------------------------------------------
// Token (ReqRes)
// ---------------------------------------------------------------------------

/** Requisição ao ReqRes com `x-api-key` e, se informado, `Authorization: Bearer`. */
export function requisicaoReqres({ method = 'GET', caminho, token, body }) {
  return cy.env(['REQRES_API_KEY']).then(({ REQRES_API_KEY }) =>
    cy.request({
      method,
      url: `${Cypress.expose('REQRES_API_URL')}${caminho}`,
      headers: token
        ? { 'x-api-key': REQRES_API_KEY, Authorization: `Bearer ${token}` }
        : { 'x-api-key': REQRES_API_KEY },
      body,
      failOnStatusCode: false,
    }),
  );
}

/**
 * POST /login com as credenciais de `cy.env()` (não aparecem no Command Log).
 * @returns {{ token: string, obtidoEm: number }} token e momento do login (ms)
 */
export function loginReqres() {
  return cy
    .env(['REQRES_EMAIL', 'REQRES_PASSWORD'])
    .then(({ REQRES_EMAIL, REQRES_PASSWORD }) =>
      requisicaoReqres({
        method: 'POST',
        caminho: '/login',
        body: { email: REQRES_EMAIL, password: REQRES_PASSWORD },
      }),
    )
    .then((resposta) => {
      if (resposta.status !== 200 || !resposta.body.token) {
        throw new Error(`Falha no login do ReqRes: HTTP ${resposta.status}.`);
      }
      return { token: resposta.body.token, obtidoEm: Date.now() };
    });
}

/** Token expira quando `agora - obtidoEm >= ttl` (no instante exato do TTL já expirou). */
export function tokenExpirado(sessao, ttlMs, agoraMs) {
  return agoraMs - sessao.obtidoEm >= ttlMs;
}

/** Devolve o token se ainda válido; senão lança o erro "Token expirado". */
export function exigirTokenValido(sessao, ttlMs, agoraMs) {
  if (tokenExpirado(sessao, ttlMs, agoraMs)) {
    throw new Error(
      `Token expirado: obtido há ${agoraMs - sessao.obtidoEm} ms, TTL de ${ttlMs} ms.`,
    );
  }
  return sessao.token;
}

/** Tratamento da expiração: faz novo login se o token expirou; senão mantém a sessão. */
export function renovarSeExpirado(sessao, ttlMs, agoraMs) {
  return tokenExpirado(sessao, ttlMs, agoraMs) ? loginReqres() : cy.wrap(sessao);
}
