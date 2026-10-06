/**
 * Gerador de CSV da Questão 3.1 (RN01 e RP01 do CASOS_DE_TESTE).
 *
 * Funções puras (sem `cy`): o mesmo CSV pode ser gerado, conferido e enviado
 * no próprio teste. Garantias do arquivo gerado:
 * - cabeçalho do enunciado: nome,email,idade,cidade;
 * - exatamente `linhas` registros, um por linha, terminados em "\n";
 * - e-mails únicos por construção (o índice do registro faz parte do e-mail),
 *   para que o arquivo válido nunca contenha duplicatas;
 * - texto UTF-8 com acentos: a cidade segue uma rotação fixa que começa em
 *   "São Paulo", então todo arquivo com 1 registro ou mais tem acento;
 * - determinístico: a mesma seed sempre produz o mesmo arquivo. A seed vai
 *   para o log do teste para reproduzir uma falha.
 */
import { Faker, base, en, pt_BR } from '@faker-js/faker';

// pt_BR gera nomes brasileiros (com acentos); en e base cobrem o que faltar.
const LOCALES = [pt_BR, en, base];

const SEED_MAXIMA = 2 ** 31 - 1;

/** Cabeçalho do exemplo do enunciado, na ordem das colunas. */
export const CABECALHO = ['nome', 'email', 'idade', 'cidade'];

/** Tamanhos pedidos no enunciado (quantidade de registros, sem o cabeçalho). */
export const TAMANHOS = {
  PEQUENO: 10,
  MEDIO: 100,
  GRANDE: 1000,
};

/** Domínio reservado para exemplos (RFC 2606): nenhum e-mail real é gerado. */
export const DOMINIO_EMAIL = 'example.com';

export const IDADE_MINIMA = 18;
export const IDADE_MAXIMA = 90;

// Rotação fixa de cidades reais; a maioria tem acento ou cedilha.
const CIDADES = [
  'São Paulo',
  'Florianópolis',
  'Goiânia',
  'Belém',
  'Maceió',
  'Vitória',
  'Rio de Janeiro',
  'Cuiabá',
  'São Luís',
  'Brasília',
];

/** Seed aleatória para uma nova massa de dados. */
export function gerarSeed() {
  return Math.floor(Math.random() * SEED_MAXIMA);
}

function criarFaker(seed) {
  const faker = new Faker({ locale: LOCALES });
  faker.seed(seed);
  return faker;
}

/** "João da Silva" -> "joao.da.silva" (sem acentos, só [a-z0-9.]). */
function paraParteLocalDoEmail(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

/**
 * Campo no formato CSV (RFC 4180): entre aspas quando contém vírgula, aspas
 * ou quebra de linha, com aspas internas duplicadas.
 */
export function escaparCampo(valor) {
  const texto = String(valor);
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Linha CSV a partir da lista de valores, sem a quebra de linha. */
export function montarLinha(valores) {
  return valores.map(escaparCampo).join(',');
}

/**
 * `quantidade` registros { nome, email, idade, cidade }. O e-mail termina com
 * o número do registro (1-based, com zeros à esquerda), o que garante
 * unicidade e permite localizar a linha de origem de qualquer registro.
 */
export function gerarRegistros(quantidade, seed = gerarSeed()) {
  if (!Number.isInteger(quantidade) || quantidade < 0) {
    throw new Error(`Quantidade de linhas inválida: ${quantidade}`);
  }

  const faker = criarFaker(seed);
  const digitos = String(quantidade).length;

  return Array.from({ length: quantidade }, (_, indice) => {
    const numero = String(indice + 1).padStart(digitos, '0');
    const nome = `${faker.person.firstName()} ${faker.person.lastName()}`;

    return {
      nome,
      email: `${paraParteLocalDoEmail(nome)}.${numero}@${DOMINIO_EMAIL}`,
      idade: faker.number.int({ min: IDADE_MINIMA, max: IDADE_MAXIMA }),
      cidade: CIDADES[indice % CIDADES.length],
    };
  });
}

/** Texto CSV (cabeçalho + registros), cada linha terminada em "\n". */
export function registrosParaCsv(registros) {
  const linhas = [
    montarLinha(CABECALHO),
    ...registros.map((registro) => montarLinha(CABECALHO.map((coluna) => registro[coluna]))),
  ];
  return `${linhas.join('\n')}\n`;
}

/**
 * Arquivo CSV completo, pronto para `cy.selectFile`:
 * `{ seed, linhas, nomeArquivo, registros, conteudo }`.
 * O nome do arquivo é só ASCII: o site exibe nomes com acento com a
 * codificação errada (ver RESPOSTA_TEORICA, comportamento observado).
 */
export function gerarCsv({ linhas, seed = gerarSeed(), prefixo = 'usuarios' }) {
  const registros = gerarRegistros(linhas, seed);

  return {
    seed,
    linhas,
    nomeArquivo: `${prefixo}-${linhas}-linhas-seed-${seed}.csv`,
    registros,
    conteudo: registrosParaCsv(registros),
  };
}
