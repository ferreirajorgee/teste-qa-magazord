import { PAGINAS, idDoBotao } from '../utils/rotas';
import { paraCentavos } from '../utils/valores';
import cabecalho from './cabecalho';

class InventoryPage {
  elements = {
    itens: () => cy.get('[data-test="inventory-item"]'),
    item: (produto) => cy.contains('[data-test="inventory-item"]', produto.nome),
    botaoAdicionar: (produto) => cy.get(`[data-test="${idDoBotao('add-to-cart', produto)}"]`),
    botaoRemover: (produto) => cy.get(`[data-test="${idDoBotao('remove', produto)}"]`),
  };

  validarAberta() {
    cabecalho.validarPagina(PAGINAS.PRODUTOS, 'Products');
  }

  /** Espera o botão trocar de estado (RI04) antes de seguir para a próxima ação. */
  adicionar(produto) {
    this.elements.botaoAdicionar(produto).click();
    this.elements.botaoRemover(produto).should('be.visible');
  }

  remover(produto) {
    this.elements.botaoRemover(produto).click();
    this.elements.botaoAdicionar(produto).should('be.visible');
  }

  /** Preço exibido do produto, em centavos (base dos valores esperados, RP02). */
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
