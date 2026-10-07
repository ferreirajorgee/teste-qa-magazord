/**
 * Valores monetários do checkout: funções puras, sem `cy`.
 * Tudo é calculado em centavos para evitar erro de ponto flutuante nas somas.
 */

const TAXA_IMPOSTO = 0.08;

// "$29.99", "Tax: $2.40" ou "$1,234.56" (separador de milhar opcional).
const VALOR_MONETARIO = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/;

/** Extrai o valor em centavos de um texto da tela. */
export function paraCentavos(texto) {
  const encontrado = VALOR_MONETARIO.exec(texto);
  if (!encontrado) {
    throw new Error(`Valor monetário não encontrado em "${texto}"`);
  }
  const [, inteiro, decimais = '0'] = encontrado;
  return Number(inteiro.replace(/,/g, '')) * 100 + Number(decimais.padEnd(2, '0'));
}

/** Formata centavos como na tela, sem o símbolo: 3239 -> "32.39". */
export function formatarCentavos(centavos) {
  return (centavos / 100).toFixed(2);
}

/** Totais esperados do resumo: Tax = 8% do Item total, em 2 casas. */
export function calcularTotais(precosEmCentavos) {
  const itemTotal = precosEmCentavos.reduce((soma, preco) => soma + preco, 0);
  const tax = Math.round(itemTotal * TAXA_IMPOSTO);
  return { itemTotal, tax, total: itemTotal + tax };
}
