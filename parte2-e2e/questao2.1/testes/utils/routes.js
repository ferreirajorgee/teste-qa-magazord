/**
 * Rotas e identificadores do SauceDemo usados pelo spec, pelos Page Objects
 * e pelo helper de estado.
 */

/** Caminhos das páginas do SauceDemo. */
export const PAGINAS = {
  LOGIN: '/',
  PRODUTOS: '/inventory.html',
  CARRINHO: '/cart.html',
  INFORMACOES: '/checkout-step-one.html',
  RESUMO: '/checkout-step-two.html',
  CONFIRMACAO: '/checkout-complete.html',
};

/** Cookie de sessão e chave do carrinho no localStorage. */
export const COOKIE_SESSAO = 'session-username';
export const CHAVE_CARRINHO = 'cart-contents';

/**
 * URL de uma página do SauceDemo, pronta para `cy.visit`.
 *
 * O site é uma SPA hospedada no GitHub Pages: abrir `/inventory.html`
 * diretamente responde 404 e só depois redireciona para `/?/inventory.html`,
 * que a página inicial converte de volta no caminho original. Para páginas
 * internas usamos esse formato direto, que responde 200 e chega ao mesmo
 * caminho sem esconder erros de status com `failOnStatusCode: false`.
 */
export function urlSauce(caminho = PAGINAS.LOGIN) {
  const base = Cypress.expose('SAUCE_URL');
  return caminho === PAGINAS.LOGIN ? `${base}/` : `${base}/?${caminho}`;
}

/**
 * data-test dos botões de produto, pela mesma regra da aplicação:
 * `idDoBotao('add-to-cart', backpack)` -> "add-to-cart-sauce-labs-backpack".
 */
export function idDoBotao(acao, produto) {
  return `${acao}-${produto.nome}`.replace(/\s+/g, '-').toLowerCase();
}
