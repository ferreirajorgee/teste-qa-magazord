/**
 * Gerador de dados dinâmicos da Questão 2.1 (RN02 e RP01 do CASOS_DE_TESTE).
 *
 * Cada chamada cria uma instância própria do faker com uma seed conhecida.
 * Assim os dados mudam a cada execução, mas qualquer falha pode ser
 * reproduzida: basta gerar de novo com a seed registrada no log do teste.
 *
 * As funções são puras (sem `cy`), para que a reprodutibilidade possa ser
 * verificada no próprio teste (CT-CK-05).
 */
import { Faker, base, en, pt_BR } from '@faker-js/faker';

// pt_BR gera nomes e CEPs brasileiros; en e base cobrem o que faltar no pt_BR.
const LOCALES = [pt_BR, en, base];

const SEED_MAXIMA = 2 ** 31 - 1;

/** Campos do formulário "Checkout: Your Information", na ordem de validação (RI05). */
export const CAMPOS_COMPRADOR = ['firstName', 'lastName', 'postalCode'];

/** Seed aleatória para uma nova massa de dados. */
export function gerarSeed() {
  return Math.floor(Math.random() * SEED_MAXIMA);
}

function criarFaker(seed) {
  const faker = new Faker({ locale: LOCALES });
  faker.seed(seed);
  return faker;
}

/**
 * Comprador com nome, sobrenome e CEP gerados. A mesma seed sempre produz o
 * mesmo comprador.
 */
export function gerarComprador(seed = gerarSeed()) {
  const faker = criarFaker(seed);

  return {
    seed,
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    postalCode: faker.location.zipCode(),
  };
}

/** Cópia do comprador com os campos informados em branco (CT-CK-06). */
export function compradorSemCampos(comprador, camposVazios) {
  const copia = { ...comprador };
  camposVazios.forEach((campo) => {
    copia[campo] = '';
  });
  return copia;
}

/** Senha gerada para o login inválido (CT-CK-12), nunca igual à senha válida. */
export function gerarSenhaInvalida(senhaValida, seed = gerarSeed()) {
  const faker = criarFaker(seed);
  let senha = faker.internet.password({ length: 12 });

  while (senha === senhaValida) {
    senha = faker.internet.password({ length: 12 });
  }
  return senha;
}
