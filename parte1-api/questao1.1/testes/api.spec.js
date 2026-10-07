/**
 * Questão 1.1 - Rate limiting (GitHub API) e autenticação com token (ReqRes).
 * Um teste para cada item do enunciado (1 a 4).
 */
import {
  exigirTokenValido,
  lerRateLimit,
  loginReqres,
  rateLimitAtingido,
  renovarSeExpirado,
  requisicaoGithub,
  requisicaoReqres,
  requisitarAteRateLimit,
} from './utils/api-helper';

const ENDPOINT_GITHUB = '/users/github';
const TOKEN_TTL_MS = Cypress.expose('TOKEN_TTL_MS'); // 2 minutos

// Esgotar a cota real bloqueia o IP por até 1 hora; desligado por padrão
// (ligue com `npm run test:destrutivo`).
const ESGOTAR_COTA = String(Cypress.expose('GITHUB_ESGOTAR_COTA')) === 'true';

describe('API 1 - GitHub (rate limiting)', () => {
  it('1. deve retornar os headers de rate limiting com valores válidos', { tags: '@smoke' }, () => {
    requisicaoGithub(ENDPOINT_GITHUB).then((resposta) => {
      // Os headers também vêm no 403, então o teste vale mesmo com a cota esgotada.
      expect(resposta.status).to.be.oneOf([200, 403]);
      expect(resposta.headers).to.include.keys(
        'x-ratelimit-limit',
        'x-ratelimit-remaining',
        'x-ratelimit-reset',
      );

      const { limite, restante, reset } = lerRateLimit(resposta.headers);
      const agoraServidorSeg = Date.parse(resposta.headers.date) / 1000;

      expect(limite, 'X-RateLimit-Limit (60 sem token, 5000 com token)').to.be.oneOf([60, 5000]);
      expect(restante, 'X-RateLimit-Remaining').to.be.within(0, limite);
      expect(reset, 'X-RateLimit-Reset (epoch no futuro)').to.be.greaterThan(agoraServidorSeg);
    });
  });

  it('2. deve detectar quando o rate limit foi atingido (status 403)', () => {
    if (ESGOTAR_COTA) {
      // Modo real: repete a requisição até a API bloquear.
      requisitarAteRateLimit(ENDPOINT_GITHUB).then((bloqueada) => {
        expect(bloqueada.status).to.equal(403);
        expect(bloqueada.body.message).to.match(/rate limit exceeded/i);
        expect(rateLimitAtingido(bloqueada)).to.equal(true);
      });
      return;
    }

    // Padrão: para não esgotar a cota a cada execução, a detecção é validada com
    // respostas no formato do bloqueio do GitHub e conferida na resposta real.
    const bloqueada = { status: 403, headers: { 'x-ratelimit-remaining': '0' } };
    const semPermissao = { status: 403, headers: { 'x-ratelimit-remaining': '42' } };

    expect(rateLimitAtingido(bloqueada), '403 com Remaining 0').to.equal(true);
    expect(rateLimitAtingido(semPermissao), '403 com cota sobrando').to.equal(false);

    requisicaoGithub(ENDPOINT_GITHUB).then((resposta) => {
      expect(rateLimitAtingido(resposta), 'resposta real').to.equal(resposta.status === 403);
    });
  });
});

describe('API 2 - ReqRes (token)', () => {
  it(
    '3. deve fazer login, obter o token e reutilizá-lo em uma requisição autenticada',
    { tags: '@smoke' },
    () => {
      loginReqres().then(({ token }) => {
        expect(token, 'token do login').to.be.a('string').and.not.be.empty;

        requisicaoReqres({ caminho: '/users/2', token }).then((resposta) => {
          // Nome de header é case-insensitive; requestHeaders preserva a grafia enviada.
          const [, authorization] =
            Object.entries(resposta.requestHeaders).find(
              ([nome]) => nome.toLowerCase() === 'authorization',
            ) || [];
          expect(authorization, 'token reutilizado').to.equal(`Bearer ${token}`);
          // Hoje o ReqRes interpreta o Authorization como chave de API e responde 401
          // (ver RESPOSTA_TEORICA.md, 1.1.c). O teste aceita o 200 do enunciado ou
          // apenas esse 401 específico; qualquer outra recusa do token falha.
          expect(resposta.status).to.be.oneOf([200, 401]);
          if (resposta.status === 200) {
            expect(resposta.body.data.id, 'usuário retornado').to.equal(2);
          } else {
            expect(resposta.headers['x-reqres-help'], '401 conhecido do ReqRes').to.equal(
              'missing_api_key',
            );
            expect(resposta.body.error, 'motivo do 401').to.equal('missing_api_key');
          }
        });
      });
    },
  );

  it('4. deve tratar a expiração do token (TTL simulado de 2 minutos)', () => {
    // O ReqRes não expira o token; o TTL é simulado injetando o "agora".
    loginReqres().then((sessao) => {
      const antesDoTtl = sessao.obtidoEm + TOKEN_TTL_MS - 1;
      const aposTtl = sessao.obtidoEm + TOKEN_TTL_MS;

      expect(exigirTokenValido(sessao, TOKEN_TTL_MS, antesDoTtl), 'válido antes do TTL').to.equal(
        sessao.token,
      );
      expect(() => exigirTokenValido(sessao, TOKEN_TTL_MS, aposTtl)).to.throw('Token expirado');

      // Tratamento: token expirado gera um novo login.
      renovarSeExpirado(sessao, TOKEN_TTL_MS, aposTtl).then((renovada) => {
        expect(renovada.token).to.be.a('string').and.not.be.empty;
        expect(renovada.obtidoEm, 'novo login realizado').to.be.greaterThan(sessao.obtidoEm);
      });
    });
  });
});
