import { PAGINAS, idDoBotao } from '../utils/routes';
import header from './header';

class CartPage {
  elements = {
    itens: () => cy.get('[data-test="cart-list"] [data-test="inventory-item"]'),
    nomesDosItens: () => cy.get('[data-test="cart-list"] [data-test="inventory-item-name"]'),
    botaoRemover: (produto) => cy.get(`[data-test="${idDoBotao('remove', produto)}"]`),
    botaoCheckout: () => cy.get('[data-test="checkout"]'),
    botaoContinuarComprando: () => cy.get('[data-test="continue-shopping"]'),
  };

  validarAberta() {
    header.validarPagina(PAGINAS.CARRINHO, 'Your Cart');
  }

  remover(produto) {
    this.elements.botaoRemover(produto).click();
  }

  iniciarCheckout() {
    this.elements.botaoCheckout().click();
  }

  continuarComprando() {
    this.elements.botaoContinuarComprando().click();
  }
}

export default new CartPage();
