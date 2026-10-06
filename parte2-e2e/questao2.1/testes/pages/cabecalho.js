/**
 * Cabeçalho comum às páginas internas: título, link e badge do carrinho.
 * Fica separado porque é usado em produtos, carrinho, checkout e confirmação.
 *
 * Como nos demais Page Objects, as verificações daqui são de navegação e
 * sincronização (qual página está aberta, quantos itens o badge mostra). As
 * regras de negócio ficam no spec.
 */
class Cabecalho {
  elements = {
    titulo: () => cy.get('[data-test="title"]'),
    linkCarrinho: () => cy.get('[data-test="shopping-cart-link"]'),
    badgeCarrinho: () => cy.get('[data-test="shopping-cart-badge"]'),
  };

  abrirCarrinho() {
    this.elements.linkCarrinho().click();
  }

  /** Sincroniza pela página aberta: caminho da URL e título exibido. */
  validarPagina(caminho, titulo) {
    cy.location('pathname').should('eq', caminho);
    this.elements.titulo().should('have.text', titulo);
  }

  /** Badge com a quantidade; com o carrinho vazio ele não é exibido (RI03). */
  validarQuantidadeNoCarrinho(quantidade) {
    if (quantidade === 0) {
      this.elements.badgeCarrinho().should('not.exist');
      return;
    }
    this.elements.badgeCarrinho().should('have.text', String(quantidade));
  }
}

export default new Cabecalho();
