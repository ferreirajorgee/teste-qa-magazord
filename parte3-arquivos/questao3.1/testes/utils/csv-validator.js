/**
 * Validador de referência da Questão 3.1: funções puras, sem `cy`.
 *
 * O site do teste prático aceita qualquer arquivo e não lê o conteúdo. Este
 * módulo faz o papel do oráculo: implementa as validações que um importador
 * real deveria aplicar (regras RH01 a RH08 do CASOS_DE_TESTE.txt, adotadas
 * como premissa porque o enunciado não as detalha) e é usado para:
 * - conferir o CSV gerado antes do upload (contagem de linhas, colunas,
 *   e-mails únicos, UTF-8);
 * - provar que cada fixture inválida contém exatamente o defeito que diz ter.
 *
 * Os números de linha são os do arquivo (o cabeçalho é a linha 1), como um
 * relatório de importação mostraria ao usuário.
 */
import { CABECALHO } from './csv-generator';

/** Tipos de erro reportados, no formato de um relatório de importação. */
export const ERROS = {
  ARQUIVO_VAZIO: 'ARQUIVO_VAZIO',
  CODIFICACAO_INVALIDA: 'CODIFICACAO_INVALIDA',
  CONTEUDO_BINARIO: 'CONTEUDO_BINARIO',
  CABECALHO_INVALIDO: 'CABECALHO_INVALIDO',
  ASPAS_NAO_FECHADAS: 'ASPAS_NAO_FECHADAS',
  LINHA_EM_BRANCO: 'LINHA_EM_BRANCO',
  QUANTIDADE_DE_COLUNAS: 'QUANTIDADE_DE_COLUNAS',
  CAMPO_OBRIGATORIO: 'CAMPO_OBRIGATORIO',
  EMAIL_INVALIDO: 'EMAIL_INVALIDO',
  IDADE_INVALIDA: 'IDADE_INVALIDA',
  EMAIL_DUPLICADO: 'EMAIL_DUPLICADO',
};

const FORMATO_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const INTEIRO_NAO_NEGATIVO = /^\d+$/;

function erro(tipo, linha, detalhe) {
  return { tipo, linha, detalhe };
}

/**
 * Separa o texto em linhas de campos, seguindo a RFC 4180: campos entre
 * aspas podem conter vírgula, aspas duplicadas ("") e quebra de linha.
 * Aceita "\n" e "\r\n". Retorna `{ linhas: [{ numero, campos }], erros }`.
 */
export function separarLinhas(texto) {
  const linhas = [];
  let campos = [];
  let campo = '';
  let entreAspas = false;
  let linhaAtual = 1;
  let inicioDoRegistro = 1;

  const fecharRegistro = () => {
    campos.push(campo);
    linhas.push({ numero: inicioDoRegistro, campos });
    campos = [];
    campo = '';
  };

  for (let i = 0; i < texto.length; i += 1) {
    const caractere = texto[i];

    if (entreAspas) {
      if (caractere === '"' && texto[i + 1] === '"') {
        campo += '"';
        i += 1;
      } else if (caractere === '"') {
        entreAspas = false;
      } else {
        if (caractere === '\n') linhaAtual += 1;
        campo += caractere;
      }
    } else if (caractere === '"' && campo === '') {
      entreAspas = true;
    } else if (caractere === ',') {
      campos.push(campo);
      campo = '';
    } else if (caractere === '\r' && texto[i + 1] === '\n') {
      // O "\n" seguinte fecha o registro.
    } else if (caractere === '\n') {
      fecharRegistro();
      linhaAtual += 1;
      inicioDoRegistro = linhaAtual;
    } else {
      campo += caractere;
    }
  }

  if (entreAspas) {
    return {
      linhas,
      erros: [
        erro(ERROS.ASPAS_NAO_FECHADAS, inicioDoRegistro, 'aspas abertas até o fim do arquivo'),
      ],
    };
  }
  // Sem "\n" final, o último registro ainda está aberto.
  if (campo !== '' || campos.length > 0) {
    fecharRegistro();
  }
  return { linhas, erros: [] };
}

function validarRegistro({ numero, campos }) {
  const erros = [];

  if (campos.length === 1 && campos[0].trim() === '') {
    return { erros: [erro(ERROS.LINHA_EM_BRANCO, numero, 'linha sem conteúdo')] };
  }
  if (campos.length !== CABECALHO.length) {
    return {
      erros: [
        erro(
          ERROS.QUANTIDADE_DE_COLUNAS,
          numero,
          `esperadas ${CABECALHO.length} colunas, encontradas ${campos.length}`,
        ),
      ],
    };
  }

  const [nome, email, idade, cidade] = campos.map((valor) => valor.trim());
  const obrigatorios = { nome, email, idade, cidade };

  Object.entries(obrigatorios)
    .filter(([, valor]) => valor === '')
    .forEach(([coluna]) => erros.push(erro(ERROS.CAMPO_OBRIGATORIO, numero, coluna)));

  if (email !== '' && !FORMATO_EMAIL.test(email)) {
    erros.push(erro(ERROS.EMAIL_INVALIDO, numero, email));
  }
  if (idade !== '' && !INTEIRO_NAO_NEGATIVO.test(idade)) {
    erros.push(erro(ERROS.IDADE_INVALIDA, numero, idade));
  }

  return { erros, registro: { nome, email, idade: Number(idade), cidade } };
}

/**
 * Valida o texto CSV inteiro e retorna o relatório:
 * `{ valido, totalLinhasDeDados, linhasRejeitadas, registros, erros }`.
 * - `totalLinhasDeDados`: linhas lidas após o cabeçalho, aceitas ou não;
 * - `registros`: só as linhas aceitas;
 * - `linhasRejeitadas`: números das linhas com pelo menos um erro.
 * Assim vale sempre: aceitas + rejeitadas = lidas (a reconciliação da 3.1.a).
 * Aspas abertas no fim do arquivo não escondem os erros das linhas
 * anteriores: tudo entra no mesmo relatório.
 */
export function validarCsv(texto) {
  if (texto.length === 0) {
    return relatorio(0, [], [erro(ERROS.ARQUIVO_VAZIO, null, 'arquivo com 0 bytes')]);
  }

  const { linhas, erros: errosDeEstrutura } = separarLinhas(texto.replace(/^\uFEFF/, ''));
  if (linhas.length === 0) {
    return relatorio(0, [], errosDeEstrutura);
  }

  const [cabecalho, ...dados] = linhas;
  // O registro com aspas abertas não chega a ser fechado, mas foi lido.
  const totalLinhasDeDados = dados.length + errosDeEstrutura.length;
  const colunas = cabecalho.campos.map((coluna) => coluna.trim().toLowerCase());
  if (colunas.join(',') !== CABECALHO.join(',')) {
    // Sem cabeçalho válido nenhuma coluna pode ser interpretada: o arquivo é
    // recusado por inteiro e todas as linhas de dados contam como rejeitadas.
    return relatorio(
      totalLinhasDeDados,
      [],
      [erro(ERROS.CABECALHO_INVALIDO, 1, `esperado "${CABECALHO.join(',')}"`)],
      [...dados, ...errosDeEstrutura].map(({ numero, linha }) => numero ?? linha),
    );
  }

  const erros = [];
  const registros = [];
  const primeiraLinhaDoEmail = new Map();

  dados.forEach((linha) => {
    const { erros: errosDaLinha, registro } = validarRegistro(linha);
    if (errosDaLinha.length > 0) {
      erros.push(...errosDaLinha);
      return;
    }

    const chave = registro.email.toLowerCase();
    if (primeiraLinhaDoEmail.has(chave)) {
      erros.push(
        erro(
          ERROS.EMAIL_DUPLICADO,
          linha.numero,
          `${registro.email} (já usado na linha ${primeiraLinhaDoEmail.get(chave)})`,
        ),
      );
      return;
    }
    primeiraLinhaDoEmail.set(chave, linha.numero);
    registros.push(registro);
  });

  return relatorio(totalLinhasDeDados, registros, [...erros, ...errosDeEstrutura]);
}

/** Relatório final; por padrão, rejeitadas são as linhas de dados com erro. */
function relatorio(
  totalLinhasDeDados,
  registros,
  erros,
  linhasRejeitadas = [
    ...new Set(erros.map(({ linha }) => linha).filter((linha) => linha !== null && linha > 1)),
  ],
) {
  return { valido: erros.length === 0, totalLinhasDeDados, linhasRejeitadas, registros, erros };
}

/**
 * Valida os bytes do arquivo: primeiro a codificação (UTF-8 válido e sem
 * byte nulo, sinal de arquivo binário ou corrompido) e depois o CSV.
 */
export function validarArquivoCsv(bytes) {
  if (bytes.length === 0) {
    return validarCsv('');
  }

  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return relatorio(0, [], [erro(ERROS.CODIFICACAO_INVALIDA, null, 'não é texto UTF-8 válido')]);
  }
  if (texto.includes('\u0000')) {
    return relatorio(0, [], [erro(ERROS.CONTEUDO_BINARIO, null, 'contém byte nulo (0x00)')]);
  }
  return validarCsv(texto);
}

/** Lista compacta "TIPO@linha", útil para comparar com o esperado. */
export function resumirErros(erros) {
  return erros.map(({ tipo, linha }) => (linha === null ? tipo : `${tipo}@${linha}`));
}
