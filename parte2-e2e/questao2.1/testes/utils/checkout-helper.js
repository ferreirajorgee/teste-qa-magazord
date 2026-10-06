/**
 * Helper da Questão 2.1: estado do navegador (sessão, carrinho e limpeza).
 */
import { CHAVE_CARRINHO, COOKIE_SESSAO, PAGINAS, urlSauce } from './rotas';

/**
 * Abre `pagina` já logado e com `produtos` no carrinho, gravando o cookie de
 * sessão e o localStorage como a própria aplicação faz. Usado nos cenários
 * em que login e inclusão de produtos não são o objeto do teste (estratégia,
 * decisão 1). O login pela interface é coberto pelo CT-CK-01 e CT-CK-02.
 */
export function prepararSessao({ produtos = [], pagina = PAGINAS.PRODUTOS } = {}) {
  return cy.env(['SAUCE_USERNAME']).then(({ SAUCE_USERNAME }) => {
    const { hostname } = new URL(urlSauce());

    cy.setCookie(COOKIE_SESSAO, SAUCE_USERNAME, { domain: hostname, path: '/' });
    cy.visit(urlSauce(pagina), {
      onBeforeLoad(win) {
        if (produtos.length > 0) {
          win.localStorage.setItem(
            CHAVE_CARRINHO,
            JSON.stringify(produtos.map((produto) => produto.id)),
          );
        }
      },
    });
  });
}

/**
 * Confere o carrinho gravado no localStorage "cart-contents": a lista de IDs
 * dos `produtos`, ou ausência da chave quando `produtos` é `null`. A leitura
 * fica dentro do `should`, então o Cypress a refaz até a asserção passar.
 */
export function validarCarrinhoArmazenado(produtos) {
  cy.window()
    .its('localStorage')
    .should((armazenamento) => {
      const conteudo = armazenamento.getItem(CHAVE_CARRINHO);

      if (produtos === null) {
        expect(conteudo, `localStorage "${CHAVE_CARRINHO}"`).to.be.null;
        return;
      }
      expect(conteudo, `localStorage "${CHAVE_CARRINHO}"`).to.be.a('string');
      expect(JSON.parse(conteudo), 'IDs no carrinho').to.deep.equal(
        produtos.map((produto) => produto.id),
      );
    });
}

/**
 * Limpeza do navegador (RN04): cookies, localStorage e sessionStorage de
 * todas as origens. As versões "All" funcionam com qualquer página aberta,
 * inclusive antes do primeiro cy.visit do teste.
 */
export function limparNavegador() {
  cy.clearAllCookies();
  cy.clearAllLocalStorage();
  cy.clearAllSessionStorage();
}

/** Confirma que não sobrou sessão, carrinho nem dado de navegador. */
export function validarNavegadorLimpo() {
  cy.getCookie(COOKIE_SESSAO).should('be.null');
  cy.getAllCookies().should('be.empty');
  cy.getAllLocalStorage().then((porOrigem) => {
    Object.entries(porOrigem).forEach(([origem, itens]) => {
      expect(itens, `localStorage de ${origem}`).to.be.empty;
    });
  });
  cy.getAllSessionStorage().then((porOrigem) => {
    Object.entries(porOrigem).forEach(([origem, itens]) => {
      expect(itens, `sessionStorage de ${origem}`).to.be.empty;
    });
  });
}
