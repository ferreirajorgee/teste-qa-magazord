/**
 * Catálogo do SauceDemo usado nos cenários (observado em 06/10/2026).
 *
 * `id` é o valor gravado no localStorage "cart-contents" (RI03), usado para
 * preparar o carrinho sem passar pela interface. Os preços não ficam aqui:
 * os valores esperados vêm do preço exibido na tela (RP02) e da tabela de
 * referência abaixo.
 */
export const PRODUTOS = {
  BACKPACK: { id: 4, nome: 'Sauce Labs Backpack' },
  BIKE_LIGHT: { id: 0, nome: 'Sauce Labs Bike Light' },
  BOLT_TSHIRT: { id: 1, nome: 'Sauce Labs Bolt T-Shirt' },
  FLEECE_JACKET: { id: 5, nome: 'Sauce Labs Fleece Jacket' },
  ONESIE: { id: 2, nome: 'Sauce Labs Onesie' },
  TSHIRT_RED: { id: 3, nome: 'Test.allTheThings() T-Shirt (Red)' },
};

/**
 * Tabela de controle do CT-CK-03 e do CT-CK-08 (Tax = 8% do Item total, 2 casas). Se o
 * catálogo mudar de preço, o cenário falha e sinaliza a mudança.
 */
export const TOTAIS_REFERENCIA = {
  BACKPACK: {
    descricao: 'Sauce Labs Backpack',
    produtos: [PRODUTOS.BACKPACK],
    itemTotal: '29.99',
    tax: '2.40',
    total: '32.39',
  },
  ONESIE: {
    // Cobre o arredondamento para cima: 0.6392 -> 0.64.
    descricao: 'Sauce Labs Onesie',
    produtos: [PRODUTOS.ONESIE],
    itemTotal: '7.99',
    tax: '0.64',
    total: '8.63',
  },
  BACKPACK_E_BIKE_LIGHT: {
    descricao: 'Sauce Labs Backpack + Sauce Labs Bike Light',
    produtos: [PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT],
    itemTotal: '39.98',
    tax: '3.20',
    total: '43.18',
  },
  CATALOGO_COMPLETO: {
    descricao: 'os 6 produtos do catálogo',
    produtos: Object.values(PRODUTOS),
    itemTotal: '129.94',
    tax: '10.40',
    total: '140.34',
  },
};
