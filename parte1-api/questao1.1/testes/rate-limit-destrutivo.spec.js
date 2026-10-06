/**
 * Questão 1.1 - Esgotamento real da cota anônima da GitHub API (CT-RL-11).
 *
 * Destrutivo: consome a cota anônima do IP (60 req/h) por até 1 hora. Fica em
 * spec separado para nunca rodar junto com a regressão, e desligado por padrão.
 * Execute somente com `npm run test:destrutivo`, que liga GITHUB_ESGOTAR_COTA.
 *
 * Valor do caso: as regras de decisão já são cobertas com respostas simuladas
 * (CT-RL-04 a 09); este caso confirma que o contrato real do bloqueio da
 * GitHub API continua igual ao simulado.
 */
import {
  HTTP,
  JANELA_GITHUB_SEGUNDOS,
  agoraDoServidorSegundos,
  analisarRateLimit,
  consultarCotaGithub,
  consumirCotaAteBloqueio,
  lerHeadersRateLimit,
} from './utils/api-helper';

const ENDPOINT_GITHUB = '/users/github';
const ESGOTAR_COTA = String(Cypress.expose('GITHUB_ESGOTAR_COTA')) === 'true';

describe('Questão 1.1 - Rate limit real da GitHub API (destrutivo)', () => {
  (ESGOTAR_COTA ? it : it.skip)(
    'CT-RL-11 - Deve receber 403 "API rate limit exceeded" ao exceder o limite anônimo real',
    { tags: ['@api', '@rate-limit', '@destrutivo'] },
    () => {
      consultarCotaGithub().then(({ remaining: restanteInicial }) => {
        cy.log(`Cota anônima restante antes do teste: ${restanteInicial}`);

        // Com a cota já zerada, o bloqueio viria na 1ª chamada sem provar a
        // transição de "atendida" para "bloqueada": o resultado é inconclusivo.
        if (restanteInicial === 0) {
          throw new Error(
            'Cenário inconclusivo: a cota anônima do IP já está esgotada. ' +
              'Aguarde o reset da janela e execute novamente.',
          );
        }

        consumirCotaAteBloqueio(ENDPOINT_GITHUB).then(
          ({ resposta, ultimaAtendida, requisicoes }) => {
            cy.log(`Bloqueio após ${requisicoes} requisição(ões)`);
            const resultado = analisarRateLimit(resposta, agoraDoServidorSegundos(resposta) * 1000);

            expect(resposta.status, 'status do bloqueio').to.equal(HTTP.FORBIDDEN);
            expect(resultado.limitado).to.equal(true);
            expect(resultado.motivo).to.equal('rate_limit_primario');
            expect(resposta.body.message).to.match(/API rate limit exceeded/i);
            expect(resultado.rateLimit.restante).to.equal(0);
            expect(resultado.esperaMs).to.be.within(0, JANELA_GITHUB_SEGUNDOS * 1000);

            // Transição: a requisição anterior foi atendida e zerou a cota.
            expect(ultimaAtendida, 'requisição atendida antes do bloqueio').to.not.equal(null);
            expect(ultimaAtendida.status).to.equal(HTTP.OK);
            expect(lerHeadersRateLimit(ultimaAtendida.headers).restante).to.equal(0);

            // Outras chamadas do mesmo IP podem antecipar o bloqueio, nunca adiá-lo.
            expect(requisicoes, 'bloqueio até a cota inicial + 1').to.be.at.most(
              restanteInicial + 1,
            );
          },
        );
      });
    },
  );
});
