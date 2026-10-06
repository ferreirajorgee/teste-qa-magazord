/**
 * Questão 1.1 - Rate limiting (GitHub API) e autenticação com token (ReqRes).
 *
 * Os casos de teste, prioridades e a rastreabilidade com o enunciado estão em
 * parte1-api/questao1.1/CASOS_DE_TESTE.txt (os IDs abaixo são os mesmos).
 *
 * Estratégia de cota: as duas APIs são públicas e limitadas (GitHub: 60 req/h
 * por IP sem token; ReqRes: limite diário da chave gratuita). Por isso:
 * - as regras de decisão (classificar 403/429, calcular espera, expiração do
 *   token) são validadas com respostas simuladas, sem chamadas de rede;
 * - as chamadas reais se limitam ao necessário para validar o contrato;
 * - o esgotamento real da cota do GitHub (CT-RL-11) fica em spec separado,
 *   rate-limit-destrutivo.spec.js, executado só sob demanda.
 */
import {
  HTTP,
  JANELA_GITHUB_SEGUNDOS,
  LIMITE_GITHUB,
  agoraDoServidorSegundos,
  analisarRateLimit,
  analisarRespostaAutenticada,
  criarGerenciadorToken,
  criarRelogioControlado,
  lerHeadersRateLimit,
  loginReqres,
  requisicaoGithub,
  requisicaoReqres,
  tokenExpirado,
} from './utils/api-helper';

const ENDPOINT_GITHUB = '/users/github';
const TTL_MS = Cypress.expose('TOKEN_TTL_MS');

/** Monta uma resposta no mesmo formato da produzida por `cy.request`. */
function respostaSimulada({ status, headers = {}, body = {} }) {
  return { status, headers, body };
}

/** Header efetivamente enviado na requisição (busca sem diferenciar maiúsculas). */
function headerEnviado(resposta, nome) {
  const chave = Object.keys(resposta.requestHeaders ?? {}).find(
    (atual) => atual.toLowerCase() === nome.toLowerCase(),
  );
  return chave ? resposta.requestHeaders[chave] : undefined;
}

describe('Questão 1.1 - Rate limiting e autenticação com token', () => {
  // -------------------------------------------------------------------------
  // Item 1: headers de rate limit da GitHub API
  // -------------------------------------------------------------------------
  describe('GitHub API - headers de rate limit', () => {
    it(
      'CT-RL-01 - Deve retornar os headers de rate limit com valores coerentes',
      { tags: ['@smoke', '@api', '@rate-limit'] },
      () => {
        requisicaoGithub(ENDPOINT_GITHUB).then(({ resposta }) => {
          // Mesmo com a cota esgotada no ambiente (403/429), os headers são
          // enviados; o teste continua válido e não fica falso-negativo.
          expect(resposta.status, 'status HTTP').to.be.oneOf([
            HTTP.OK,
            HTTP.FORBIDDEN,
            HTTP.TOO_MANY_REQUESTS,
          ]);
          expect(analisarRateLimit(resposta).limitado, 'bloqueio coerente com o status').to.equal(
            resposta.status !== HTTP.OK,
          );

          expect(resposta.headers).to.include.keys(
            'x-ratelimit-limit',
            'x-ratelimit-remaining',
            'x-ratelimit-reset',
          );

          const { limite, restante, usado, reset, recurso } = lerHeadersRateLimit(resposta.headers);
          const agora = agoraDoServidorSegundos(resposta);

          expect(limite, 'X-RateLimit-Limit').to.be.a('number').and.to.be.greaterThan(0);
          expect(restante, 'X-RateLimit-Remaining').to.be.a('number').and.to.be.within(0, limite);
          expect(usado, 'X-RateLimit-Used').to.equal(limite - restante);
          expect(reset, 'X-RateLimit-Reset no futuro').to.be.a('number').and.to.be.at.least(agora);
          expect(reset - agora, 'X-RateLimit-Reset dentro da janela de 1 hora').to.be.at.most(
            JANELA_GITHUB_SEGUNDOS,
          );
          expect(recurso, 'X-RateLimit-Resource').to.equal('core');
        });
      },
    );

    it(
      'CT-RL-02 - Deve aplicar o limite correspondente ao modo de autenticação',
      { tags: ['@api', '@rate-limit'] },
      () => {
        requisicaoGithub(ENDPOINT_GITHUB).then(({ resposta, autenticado }) => {
          const esperado = autenticado
            ? LIMITE_GITHUB.COM_AUTENTICACAO
            : LIMITE_GITHUB.SEM_AUTENTICACAO;

          expect(
            lerHeadersRateLimit(resposta.headers).limite,
            `limite ${autenticado ? 'com' : 'sem'} GITHUB_TOKEN`,
          ).to.equal(esperado);
        });
      },
    );

    it(
      'CT-RL-03 - Deve decrementar X-RateLimit-Remaining a cada requisição consumida',
      { tags: ['@api', '@rate-limit'] },
      () => {
        requisicaoGithub(ENDPOINT_GITHUB).then(({ resposta: primeira }) => {
          const antes = lerHeadersRateLimit(primeira.headers);

          requisicaoGithub(ENDPOINT_GITHUB).then(({ resposta: segunda }) => {
            const depois = lerHeadersRateLimit(segunda.headers);

            // Outras chamadas do mesmo IP podem consumir cota em paralelo, então
            // a regra é "diminuiu pelo menos 1", nunca abaixo de zero.
            expect(depois.restante, 'Remaining após nova chamada').to.be.at.most(
              Math.max(antes.restante - 1, 0),
            );
            expect(depois.reset, 'mesma janela de rate limit').to.equal(antes.reset);
          });
        });
      },
    );
  });

  // -------------------------------------------------------------------------
  // Item 2: detecção do rate limit atingido (403/429)
  // -------------------------------------------------------------------------
  describe('Detecção de rate limit atingido', () => {
    const resetEmSegundos = 1_800_000_000;
    const agoraMs = (resetEmSegundos - 600) * 1000; // 10 minutos antes do reset

    it(
      'CT-RL-04 - Deve identificar 403 com Remaining 0 como rate limit primário e calcular a espera',
      { tags: ['@smoke', '@rate-limit', '@unitario'] },
      () => {
        const resposta = respostaSimulada({
          status: HTTP.FORBIDDEN,
          headers: {
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Used': '60',
            'X-RateLimit-Reset': String(resetEmSegundos),
          },
          body: { message: 'API rate limit exceeded for 203.0.113.10.' },
        });

        const resultado = analisarRateLimit(resposta, agoraMs);

        expect(resultado.limitado).to.equal(true);
        expect(resultado.motivo).to.equal('rate_limit_primario');
        expect(resultado.cotaEsgotada).to.equal(true);
        expect(resultado.esperaMs, 'espera até o reset').to.equal(600_000);
      },
    );

    it(
      'CT-RL-05 - Deve identificar 429 com Retry-After e priorizar esse header no cálculo da espera',
      { tags: ['@rate-limit', '@unitario'] },
      () => {
        const resposta = respostaSimulada({
          status: HTTP.TOO_MANY_REQUESTS,
          headers: { 'retry-after': '30', 'x-ratelimit-reset': String(resetEmSegundos) },
        });

        const resultado = analisarRateLimit(resposta, agoraMs);

        expect(resultado.limitado).to.equal(true);
        expect(resultado.motivo).to.equal('rate_limit');
        expect(resultado.esperaMs).to.equal(30_000);
      },
    );

    it(
      'CT-RL-06 - Deve identificar 403 de rate limit secundário mesmo com cota primária disponível',
      { tags: ['@rate-limit', '@unitario'] },
      () => {
        const resposta = respostaSimulada({
          status: HTTP.FORBIDDEN,
          headers: { 'x-ratelimit-remaining': '42', 'retry-after': '60' },
          body: { message: 'You have exceeded a secondary rate limit.' },
        });

        const resultado = analisarRateLimit(resposta, agoraMs);

        expect(resultado.limitado).to.equal(true);
        expect(resultado.motivo).to.equal('rate_limit_secundario');
        expect(resultado.esperaMs).to.equal(60_000);
      },
    );

    it(
      'CT-RL-07 - Não deve tratar como rate limit um 403 causado por falta de permissão',
      { tags: ['@rate-limit', '@unitario'] },
      () => {
        const resposta = respostaSimulada({
          status: HTTP.FORBIDDEN,
          headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990' },
          body: { message: 'Resource not accessible by personal access token' },
        });

        const resultado = analisarRateLimit(resposta, agoraMs);

        expect(resultado.limitado).to.equal(false);
        expect(resultado.motivo).to.equal('acesso_negado');
        expect(resultado.esperaMs).to.equal(null);
      },
    );

    it(
      'CT-RL-08 - Deve sinalizar cota esgotada sem bloquear a última requisição atendida (200 com Remaining 0)',
      { tags: ['@rate-limit', '@unitario'] },
      () => {
        const resposta = respostaSimulada({
          status: HTTP.OK,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEmSegundos) },
        });

        const resultado = analisarRateLimit(resposta, agoraMs);

        expect(resultado.limitado, 'esta requisição foi atendida').to.equal(false);
        expect(resultado.cotaEsgotada, 'a próxima será bloqueada').to.equal(true);
      },
    );

    it(
      'CT-RL-09 - Deve retornar espera zero quando o reset informado já passou',
      { tags: ['@rate-limit', '@unitario'] },
      () => {
        const resposta = respostaSimulada({
          status: HTTP.FORBIDDEN,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEmSegundos) },
          body: { message: 'API rate limit exceeded' },
        });

        const resultado = analisarRateLimit(resposta, (resetEmSegundos + 5) * 1000);

        expect(resultado.limitado).to.equal(true);
        expect(resultado.esperaMs).to.equal(0);
      },
    );

    it(
      'CT-RL-10 - Deve classificar a resposta real da GitHub API de forma coerente com a cota',
      { tags: ['@api', '@rate-limit'] },
      () => {
        requisicaoGithub(ENDPOINT_GITHUB).then(({ resposta }) => {
          const resultado = analisarRateLimit(resposta);

          // Determinístico para qualquer estado da cota no ambiente: atendida
          // (200, usuário "github") ou bloqueada (403/429 com mensagem e espera).
          if (resposta.status === HTTP.OK) {
            expect(resultado.limitado).to.equal(false);
            expect(resposta.body.login).to.equal('github');
          } else {
            expect(resultado.limitado, `HTTP ${resposta.status} classificado`).to.equal(true);
            expect(resposta.body.message).to.match(/rate limit/i);
            expect(resultado.esperaMs).to.be.a('number').and.to.be.at.least(0);
          }
        });
      },
    );
  });

  // -------------------------------------------------------------------------
  // Itens 3 e 4: token do ReqRes (obtenção, reutilização e expiração)
  // -------------------------------------------------------------------------

  // Um único gerenciador por spec: o cache sobrevive entre os testes. O relógio
  // controlado permite simular a expiração do TTL sem esperar 2 minutos.
  const relogio = criarRelogioControlado();
  const gerenciador = criarGerenciadorToken({ ttlMs: TTL_MS, agora: relogio.agora });

  describe('ReqRes - login e reutilização do token', () => {
    it(
      'CT-TK-01 - Deve obter um token ao fazer login com credenciais válidas',
      { tags: ['@smoke', '@api', '@token'] },
      () => {
        gerenciador.obterToken().then((token) => {
          expect(token, 'token').to.be.a('string').and.not.be.empty;
          expect(gerenciador.situacao().status).to.equal('valido');
        });
      },
    );

    it(
      'CT-TK-02 - Deve reutilizar o token em cache em outro teste, sem novo login',
      { tags: ['@api', '@token'] },
      () => {
        gerenciador.obterToken().then((primeiro) => {
          const loginsAntes = gerenciador.estado().logins;

          gerenciador.obterToken().then((segundo) => {
            expect(segundo, 'mesmo token').to.equal(primeiro);
            expect(gerenciador.estado().logins, 'nenhum login adicional').to.equal(loginsAntes);
            // No spec inteiro, até aqui, houve um único login (feito no CT-TK-01
            // ou, se este teste rodar isolado, no início deste teste).
            expect(gerenciador.estado().logins, 'login único no spec').to.equal(1);
          });
        });
      },
    );

    it(
      'CT-TK-03 - Deve enviar o token reutilizado no header Authorization da requisição autenticada',
      { tags: ['@api', '@token'] },
      () => {
        gerenciador.requisicaoAutenticada({ caminho: '/users/2' }).then((resultado) => {
          const { resposta, token } = resultado;

          expect(headerEnviado(resposta, 'Authorization'), 'header enviado').to.equal(
            `Bearer ${token}`,
          );
          expect(gerenciador.estado().logins, 'token reutilizado, sem novo login').to.equal(1);

          // Comportamento atual do ReqRes (verificado em 06/10/2026): o header
          // Authorization: Bearer passou a ser interpretado como chave de API e
          // o token legado do /login é recusado com 401 nos endpoints /api/users.
          // O teste documenta esse comportamento e valida que o helper o
          // classifica como token rejeitado (ver RESPOSTA_TEORICA.md).
          expect(resposta.status).to.equal(HTTP.UNAUTHORIZED);
          expect(resultado.classificacao).to.equal('token_rejeitado');
        });
      },
    );

    it(
      'CT-TK-04 - Deve acessar o usuário 2 sem Bearer (controle que isola a causa do 401)',
      { tags: ['@api', '@token'] },
      () => {
        requisicaoReqres({ caminho: '/users/2' }).then((resposta) => {
          expect(resposta.status).to.equal(HTTP.OK);
          expect(resposta.body.data).to.include({ id: 2, email: 'janet.weaver@reqres.in' });
        });
      },
    );

    const loginsInvalidos = [
      {
        id: 'CT-TK-05',
        titulo: 'sem senha',
        corpo: { email: 'eve.holt@reqres.in' },
        erro: 'Missing password',
      },
      {
        id: 'CT-TK-06',
        titulo: 'com usuário inexistente',
        corpo: { email: 'usuario.inexistente@reqres.in', password: 'qualquer' },
        erro: 'user not found',
      },
    ];

    loginsInvalidos.forEach(({ id, titulo, corpo, erro }) => {
      it(
        `${id} - Deve recusar o login ${titulo} com 400 e sem token`,
        { tags: ['@api', '@token'] },
        () => {
          loginReqres(corpo).then((resposta) => {
            expect(resposta.status).to.equal(HTTP.BAD_REQUEST);
            expect(resposta.body).to.deep.equal({ error: erro });
            expect(resposta.body).not.to.have.property('token');
          });
        },
      );
    });
  });

  describe('ReqRes - expiração do token (TTL simulado)', () => {
    it(
      'CT-TK-07 - Deve considerar o token válido até 1 ms antes do TTL e expirado no TTL exato',
      { tags: ['@token', '@unitario'] },
      () => {
        const obtidoEm = 1_000_000;

        expect(tokenExpirado(obtidoEm, TTL_MS, obtidoEm), 'recém-obtido').to.equal(false);
        expect(tokenExpirado(obtidoEm, TTL_MS, obtidoEm + TTL_MS - 1), 'TTL - 1 ms').to.equal(
          false,
        );
        expect(tokenExpirado(obtidoEm, TTL_MS, obtidoEm + TTL_MS), 'TTL exato').to.equal(true);
        expect(tokenExpirado(null, TTL_MS, obtidoEm), 'sem token').to.equal(true);
      },
    );

    it(
      'CT-TK-08 - Deve reutilizar o token enquanto o TTL não venceu',
      { tags: ['@api', '@token'] },
      () => {
        gerenciador.obterToken().then(() => {
          const { obtidoEm, logins } = gerenciador.estado();

          cy.then(() => relogio.avancar(obtidoEm + TTL_MS - 1 - relogio.agora()));
          gerenciador.obterToken().then(() => {
            expect(gerenciador.situacao().status).to.equal('valido');
            expect(gerenciador.estado().logins, 'sem novo login').to.equal(logins);
          });
        });
      },
    );

    it(
      'CT-TK-09 - Deve detectar o token expirado e informar o erro de forma clara',
      { tags: ['@smoke', '@api', '@token'] },
      () => {
        gerenciador.obterToken().then(() => {
          const { obtidoEm } = gerenciador.estado();

          cy.then(() => relogio.avancar(obtidoEm + TTL_MS - relogio.agora()));
          cy.then(() => {
            expect(gerenciador.situacao().status).to.equal('expirado');
            expect(() => gerenciador.exigirTokenValido()).to.throw(
              `Token expirado: obtido há ${TTL_MS} ms, TTL de ${TTL_MS} ms.`,
            );
          });
        });
      },
    );

    it(
      'CT-TK-10 - Deve renovar o token expirado automaticamente antes da requisição autenticada',
      { tags: ['@api', '@token'] },
      () => {
        gerenciador.obterToken().then(() => {
          const { obtidoEm, logins } = gerenciador.estado();

          cy.then(() => relogio.avancar(obtidoEm + TTL_MS - relogio.agora()));
          gerenciador.requisicaoAutenticada({ caminho: '/users/2' }).then(({ resposta, token }) => {
            const depois = gerenciador.estado();

            expect(depois.logins, 'novo login por expiração').to.equal(logins + 1);
            expect(depois.obtidoEm, 'token renovado no "agora" simulado').to.equal(relogio.agora());
            expect(gerenciador.situacao().status).to.equal('valido');
            expect(headerEnviado(resposta, 'Authorization'), 'token renovado enviado').to.equal(
              `Bearer ${token}`,
            );
          });
        });
      },
    );

    it(
      'CT-TK-11 - Deve classificar a resposta autenticada conforme o status HTTP',
      { tags: ['@token', '@unitario'] },
      () => {
        const casos = [
          { status: HTTP.OK, esperado: 'sucesso' },
          { status: HTTP.UNAUTHORIZED, esperado: 'token_rejeitado' },
          {
            status: HTTP.TOO_MANY_REQUESTS,
            headers: { 'retry-after': '60' },
            esperado: 'rate_limit',
          },
          { status: HTTP.BAD_REQUEST, esperado: 'erro' },
        ];

        casos.forEach(({ status, headers, esperado }) => {
          expect(
            analisarRespostaAutenticada(respostaSimulada({ status, headers })),
            `HTTP ${status}`,
          ).to.equal(esperado);
        });
      },
    );
  });
});
