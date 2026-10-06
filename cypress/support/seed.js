/**
 * Seed da massa de dados gerada com faker, compartilhada entre as partes.
 *
 * Segue a regra de commands.js: só fica em support o que é reutilizado por
 * mais de uma questão. Não é custom command porque não enfileira comandos:
 * é uma leitura síncrona de configuração, importada pelos specs.
 */

/**
 * Seed de `--expose FAKER_SEED`, para reproduzir uma falha. Sem o parâmetro,
 * retorna `undefined` e o gerador sorteia uma seed nova.
 */
export function seedInformada() {
  const valor = Cypress.expose('FAKER_SEED');
  if (valor === undefined || valor === null || valor === '') {
    return undefined;
  }

  const seed = Number(valor);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error(`FAKER_SEED deve ser um inteiro não negativo; recebido "${valor}".`);
  }
  return seed;
}
