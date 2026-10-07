import { PAGINAS, idDoBotao } from '../utils/routes';
import { paraCentavos } from '../utils/prices';
import header from './header';

class InventoryPage {
  elements = {
    itens: () => cy.get('[data-test="inventory-item"]'),
    item: (produto) => cy.contains('[data-test="inventory-item"]', produto.nome),
    botaoAdicionar: (produto) => cy.get(`[data-test="${idDoBotao('add-to-cart', produto)}"]`),
    botaoRemover: (produto) => cy.get(`[data-test="${idDoBotao('remove', produto)}"]`),
  };

  validarAberta() {
    header.validarPagina(PAGINAS.PRODUTOS, 'Products');
  }

  /** Espera o botão trocar de estado ("Add to cart" vira "Remove") antes de seguir para a próxima ação. */
  adicionar(produto) {
    this.elements.botaoAdicionar(produto).click();
    this.elements.botaoRemover(produto).should('be.visible');
  }

  remover(produto) {
    this.elements.botaoRemover(produto).click();
    this.elements.botaoAdicionar(produto).should('be.visible');
  }

  /** Preço exibido do produto, em centavos (base dos valores esperados). */
  lerPreco(produto) {
    return this.elements
      .item(produto)
      .find('[data-test="inventory-item-price"]')
      .should('contain.text', '$')
      .invoke('text')
      .then(paraCentavos);
  }
}

export default new InventoryPage();
