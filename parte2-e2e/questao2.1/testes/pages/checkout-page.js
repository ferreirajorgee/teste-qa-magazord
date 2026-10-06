import { PAGINAS } from '../utils/rotas';
import { paraCentavos } from '../utils/valores';
import cabecalho from './cabecalho';

/**
 * Page Object das três etapas do checkout do SauceDemo:
 * "Checkout: Your Information", "Checkout: Overview" e "Checkout: Complete!".
 *
 * Encapsula seletores, ações e leitura de valores. As únicas verificações
 * daqui são de navegação e sincronização (etapa aberta, quantidade de itens
 * carregada antes da leitura). As regras de negócio (totais, itens,
 * mensagens) são verificadas no spec.
 */
class CheckoutPage {
  elements = {
    // Your Information
    campo: (nome) => cy.get(`[data-test="${nome}"]`),
    botaoContinuar: () => cy.get('[data-test="continue"]'),
    botaoCancelar: () => cy.get('[data-test="cancel"]'),
    erro: () => cy.get('[data-test="error"]'),

    // Overview
    itensDoResumo: () =>
      cy.get('[data-test="checkout-summary-container"] [data-test="inventory-item"]'),
    pagamento: () => cy.get('[data-test="payment-info-value"]'),
    entrega: () => cy.get('[data-test="shipping-info-value"]'),
    itemTotal: () => cy.get('[data-test="subtotal-label"]'),
    tax: () => cy.get('[data-test="tax-label"]'),
    total: () => cy.get('[data-test="total-label"]'),
    botaoFinalizar: () => cy.get('[data-test="finish"]'),

    // Complete
    cabecalhoConfirmacao: () => cy.get('[data-test="complete-header"]'),
    textoConfirmacao: () => cy.get('[data-test="complete-text"]'),
    imagemConfirmacao: () => cy.get('[data-test="pony-express"]'),
    botaoVoltarParaProdutos: () => cy.get('[data-test="back-to-products"]'),
  };

  // -------------------------------------------------------------------------
  // Your Information
  // -------------------------------------------------------------------------

  validarInformacoesAberta() {
    cabecalho.validarPagina(PAGINAS.INFORMACOES, 'Checkout: Your Information');
  }

  /**
   * Preenche nome, sobrenome e CEP. Campo com valor vazio fica em branco,
   * o que permite montar os cenários de campo obrigatório (CT-CK-06).
   */
  preencherComprador({ firstName, lastName, postalCode }) {
    Object.entries({ firstName, lastName, postalCode }).forEach(([campo, valor]) => {
      this.elements.campo(campo).clear();
      if (valor) {
        // Dados gerados podem ter "{" ou "}", que o type trataria como tecla.
        this.elements.campo(campo).type(valor, { parseSpecialCharSequences: false });
      }
    });
  }

  continuar() {
    this.elements.botaoContinuar().click();
  }

  /** Cancel existe nas etapas Your Information e Overview, com destinos diferentes (RI10). */
  cancelar() {
    this.elements.botaoCancelar().click();
  }

  // -------------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------------

  validarResumoAberto() {
    cabecalho.validarPagina(PAGINAS.RESUMO, 'Checkout: Overview');
  }

  /**
   * Itens do resumo como `{ nome, preco }`, com o preço em centavos. Espera
   * `quantidade` itens na tela antes de ler, para não ler a lista incompleta.
   */
  lerItensDoResumo(quantidade) {
    return this.elements
      .itensDoResumo()
      .should('have.length', quantidade)
      .then(($itens) =>
        Cypress._.map($itens, (item) => ({
          nome: Cypress.$(item).find('[data-test="inventory-item-name"]').text().trim(),
          preco: paraCentavos(Cypress.$(item).find('[data-test="inventory-item-price"]').text()),
        })),
      );
  }

  /** Item total, Tax e Total exibidos, em centavos. */
  lerTotais() {
    const totais = {};

    this.elements
      .itemTotal()
      .invoke('text')
      .then((texto) => {
        totais.itemTotal = paraCentavos(texto);
      });
    this.elements
      .tax()
      .invoke('text')
      .then((texto) => {
        totais.tax = paraCentavos(texto);
      });
    return this.elements
      .total()
      .invoke('text')
      .then((texto) => {
        totais.total = paraCentavos(texto);
        return totais;
      });
  }

  finalizar() {
    this.elements.botaoFinalizar().click();
  }

  // -------------------------------------------------------------------------
  // Complete
  // -------------------------------------------------------------------------

  validarConfirmacaoAberta() {
    cabecalho.validarPagina(PAGINAS.CONFIRMACAO, 'Checkout: Complete!');
  }

  voltarParaProdutos() {
    this.elements.botaoVoltarParaProdutos().click();
  }
}

export default new CheckoutPage();
