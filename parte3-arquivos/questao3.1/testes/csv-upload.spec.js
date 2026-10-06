/**
 * Questão 3.1 - Importação de CSV, no the-internet (https://the-internet.herokuapp.com/upload).
 *
 * Os casos de teste, prioridades e a rastreabilidade com o enunciado estão em
 * parte3-arquivos/questao3.1/CASOS_DE_TESTE.txt (os IDs abaixo são os mesmos).
 *
 * Premissa: o site é um upload genérico. Ele recebe qualquer arquivo, exibe
 * "File Uploaded!" com o nome e não lê o conteúdo: não há contagem de linhas,
 * regra de negócio, duplicata nem relacionamento a validar no servidor
 * (gaps G01 e G02). Por isso, cada cenário separa duas coisas:
 * 1. O arquivo: gerado ou lido da fixture e conferido antes do upload pelo
 *    validador de referência (utils/csv-validador.js), que faz o papel do
 *    importador real e prova que o arquivo é o que o cenário diz ser.
 * 2. O site: o que ele realmente faz. Para os arquivos válidos, que o arquivo
 *    saiu íntegro do navegador (corpo multipart capturado pelo proxy do
 *    Cypress no cy.intercept, idêntico ao gerado) e que o servidor respondeu
 *    200 exibindo o nome. O site não devolve o conteúdo recebido. Para os inválidos, o comportamento
 *    observado (aceita sem validar), registrado como tal e não como acerto.
 *
 * - CSV gerado em memória e enviado com cy.selectFile({ contents }), sem
 *   gravar arquivo em disco. A seed vai para o Command Log e para o relatório;
 *   para reproduzir uma falha: `npx cypress run --expose FAKER_SEED=<seed>`.
 * - Fixtures (testes/fixtures) enviadas pelo caminho, como faria um usuário.
 * - Sincronização pelo alias do POST /upload (Page Object), sem cy.wait fixo.
 *   Um 503 do Heroku, ao abrir a página ou no POST /upload, vira falha
 *   INCONCLUSIVO (ambiente), não defeito.
 */
import uploadPage from './pages/upload-page';
import { TAMANHOS, gerarCsv } from './utils/csv-generator';
import { ERROS, resumirErros, validarArquivoCsv, validarCsv } from './utils/csv-validador';
import { lerArquivoEnviado } from './utils/multipart';
import { seedInformada } from '../../../cypress/support/seed';

const PASTA_FIXTURES = 'parte3-arquivos/questao3.1/testes/fixtures';
const STATUS_OK = 200;
// Cabeçalho do exemplo do enunciado, escrito aqui como texto para não
// validar o gerador com a própria constante dele.
const CABECALHO_ENUNCIADO = 'nome,email,idade,cidade';
// Tipo enviado pelo navegador: o informado no selectFile (CSV gerado) ou o
// inferido pelo Cypress a partir da extensão .csv (fixtures).
const TIPO_CSV = 'text/csv';
const STATUS_ERRO_INTERNO = 500;

/**
 * Fixtures inválidas e o relatório que um importador real deveria produzir
 * para cada uma (RH01 a RH08). O site aceita todas (G01).
 */
const ARQUIVOS_INVALIDOS = [
  {
    descricao: 'CSV vazio (0 bytes)',
    arquivo: 'vazio.csv',
    linhasLidas: 0,
    erros: [ERROS.ARQUIVO_VAZIO],
  },
  {
    descricao: 'CSV com formato incorreto (separador ";")',
    arquivo: 'formato-incorreto.csv',
    linhasLidas: 2,
    erros: [`${ERROS.CABECALHO_INVALIDO}@1`],
  },
  {
    descricao: 'CSV com dados malformados',
    arquivo: 'malformado.csv',
    linhasLidas: 9,
    erros: [
      `${ERROS.QUANTIDADE_DE_COLUNAS}@3`,
      `${ERROS.QUANTIDADE_DE_COLUNAS}@4`,
      `${ERROS.EMAIL_INVALIDO}@5`,
      `${ERROS.IDADE_INVALIDA}@6`,
      `${ERROS.CAMPO_OBRIGATORIO}@7`,
      `${ERROS.LINHA_EM_BRANCO}@8`,
      `${ERROS.EMAIL_DUPLICADO}@9`,
      `${ERROS.ASPAS_NAO_FECHADAS}@10`,
    ],
  },
  {
    descricao: 'CSV corrompido (bytes binários, UTF-8 inválido)',
    arquivo: 'corrompido.csv',
    linhasLidas: 0,
    erros: [ERROS.CODIFICACAO_INVALIDA],
    // Bytes inválidos em UTF-8 chegam substituídos no corpo lido pelo
    // intercept; nesse caso a prova de integridade é o tamanho do arquivo
    // selecionado, e no corpo só o nome é comparável.
    binario: true,
  },
];

/** CSV deste teste, com a seed registrada no Command Log e no relatório. */
function csvDoTeste(linhas) {
  const csv = gerarCsv({ linhas, seed: seedInformada() });
  cy.log(`CSV de ${linhas} linhas gerado com a seed ${csv.seed}`);
  cy.addTestContext({ title: `Seed do CSV de ${linhas} linhas (FAKER_SEED)`, value: csv.seed });
  return csv;
}

function caminhoFixture(arquivo) {
  return `${PASTA_FIXTURES}/${arquivo}`;
}

/** Linhas físicas do texto, sem a vazia depois do "\n" final. */
function contarLinhas(texto) {
  return texto === '' ? 0 : texto.replace(/\n$/, '').split('\n').length;
}

/** Relatório do validador de referência para um CSV que deve ser aceito por inteiro. */
function validarCsvAceitoPorInteiro(relatorio, linhas) {
  expect(resumirErros(relatorio.erros), 'erros da validação de referência').to.deep.equal([]);
  expect(relatorio.totalLinhasDeDados, 'linhas de dados lidas').to.equal(linhas);
  expect(relatorio.registros, 'registros aceitos').to.have.length(linhas);
  expect(relatorio.linhasRejeitadas, 'linhas rejeitadas').to.be.empty;
}

/**
 * O que o navegador enviou no POST /upload (corpo capturado pelo proxy do
 * Cypress): status, campo "file", nome e tipo do arquivo e, quando
 * informado, o conteúdo idêntico ao esperado.
 */
function validarArquivoRecebido(interceptacao, { nomeArquivo, conteudo }) {
  const enviado = lerArquivoEnviado(
    interceptacao.request.body,
    interceptacao.request.headers['content-type'],
  );

  expect(interceptacao.response.statusCode, 'status do POST /upload').to.equal(STATUS_OK);
  expect(enviado.campo, 'campo do formulário').to.equal('file');
  expect(enviado.nomeArquivo, 'nome do arquivo enviado').to.equal(nomeArquivo);
  expect(enviado.tipo, 'Content-Type do arquivo enviado').to.equal(TIPO_CSV);

  if (conteudo !== undefined) {
    expect(contarLinhas(enviado.conteudo), 'linhas enviadas').to.equal(contarLinhas(conteudo));
    // Comparação booleana: em uma falha, o diff de 60 KB não ajudaria a ler o log.
    expect(enviado.conteudo === conteudo, 'conteúdo enviado idêntico ao arquivo').to.equal(true);
  }
}

/** Arquivo no input antes do envio: nome e tamanho em bytes. */
function validarArquivoSelecionado(nomeArquivo, tamanhoEmBytes) {
  uploadPage.elements.campoArquivo().should(($campo) => {
    const arquivos = $campo[0].files;
    expect(arquivos, 'arquivos selecionados').to.have.length(1);
    expect(arquivos[0].name, 'arquivo selecionado').to.equal(nomeArquivo);
    expect(arquivos[0].size, 'tamanho em bytes').to.equal(tamanhoEmBytes);
  });
}

/** Resultado exibido pelo site: "File Uploaded!" e o nome do arquivo. */
function validarUploadExibido(nomeArquivo) {
  uploadPage.validarResultadoAberto();
  uploadPage.elements
    .arquivosEnviados()
    .should('be.visible')
    .invoke('text')
    .invoke('trim')
    .should('eq', nomeArquivo);
  uploadPage.elements.campoArquivo().should('not.exist');
}

describe('Questão 3.1 - Importação de CSV (the-internet /upload)', () => {
  // -------------------------------------------------------------------------
  // Gerador de CSV (item 1): funções puras, sem rede
  // -------------------------------------------------------------------------
  describe('Gerador de CSV dinâmico', () => {
    Object.entries(TAMANHOS).forEach(([tamanho, linhas]) => {
      it(
        `CT-UP-01 - Deve gerar o CSV ${tamanho.toLowerCase()} com ${linhas} linhas válidas, e-mails únicos e UTF-8`,
        { tags: ['@unitario', '@csv', '@gerador'] },
        () => {
          const csv = csvDoTeste(linhas);
          const linhasDoArquivo = csv.conteudo.replace(/\n$/, '').split('\n');

          expect(linhasDoArquivo, 'cabeçalho + registros').to.have.length(linhas + 1);
          expect(linhasDoArquivo[0], 'cabeçalho do enunciado').to.equal(CABECALHO_ENUNCIADO);
          expect(csv.conteudo.endsWith('\n'), 'termina com quebra de linha').to.equal(true);

          const relatorio = validarCsv(csv.conteudo);
          validarCsvAceitoPorInteiro(relatorio, linhas);
          expect(relatorio.registros, 'registros lidos = registros gerados').to.deep.equal(
            csv.registros,
          );

          const emails = csv.registros.map(({ email }) => email.toLowerCase());
          expect(new Set(emails).size, 'e-mails únicos').to.equal(linhas);

          // Acentos gravados como UTF-8: "ã" ocupa 2 bytes, então o arquivo
          // tem mais bytes do que caracteres.
          expect(csv.conteudo, 'texto com acento').to.include('São Paulo');
          expect(
            Cypress.Buffer.byteLength(csv.conteudo, 'utf8'),
            'bytes UTF-8 > caracteres',
          ).to.be.greaterThan(csv.conteudo.length);
        },
      );
    });

    it(
      'CT-UP-02 - Deve gerar o mesmo CSV para a mesma seed e CSVs diferentes para seeds diferentes',
      { tags: ['@unitario', '@csv', '@gerador'] },
      () => {
        const primeiro = csvDoTeste(TAMANHOS.PEQUENO);
        const repetido = gerarCsv({ linhas: TAMANHOS.PEQUENO, seed: primeiro.seed });
        const outro = gerarCsv({ linhas: TAMANHOS.PEQUENO, seed: primeiro.seed + 1 });

        expect(repetido, 'mesma seed, mesmo arquivo').to.deep.equal(primeiro);
        expect(outro.conteudo, 'outra seed, outro conteúdo').not.to.equal(primeiro.conteudo);
        expect(validarCsv(outro.conteudo).valido, 'outra seed continua válida').to.equal(true);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Upload de arquivo válido (itens 2 e 4)
  // -------------------------------------------------------------------------
  describe('Upload de arquivo válido', () => {
    beforeEach(() => {
      uploadPage.visitar();
      uploadPage.validarAberta();
    });

    Object.entries(TAMANHOS).forEach(([tamanho, linhas]) => {
      it(
        `CT-UP-03 - Deve enviar o CSV ${tamanho.toLowerCase()} gerado (${linhas} linhas) por inteiro e exibir o nome`,
        {
          tags:
            linhas === TAMANHOS.PEQUENO
              ? ['@smoke', '@e2e', '@csv', '@upload']
              : ['@e2e', '@csv', '@upload'],
        },
        () => {
          const csv = csvDoTeste(linhas);
          validarCsvAceitoPorInteiro(validarCsv(csv.conteudo), linhas);

          uploadPage.selecionarArquivo({
            contents: Cypress.Buffer.from(csv.conteudo, 'utf8'),
            fileName: csv.nomeArquivo,
            mimeType: TIPO_CSV,
          });
          validarArquivoSelecionado(
            csv.nomeArquivo,
            Cypress.Buffer.byteLength(csv.conteudo, 'utf8'),
          );

          uploadPage.enviar().then((interceptacao) => {
            validarArquivoRecebido(interceptacao, {
              nomeArquivo: csv.nomeArquivo,
              conteudo: csv.conteudo,
            });
          });
          validarUploadExibido(csv.nomeArquivo);
        },
      );
    });

    it(
      'CT-UP-04 - Deve enviar a fixture válida do enunciado, com acentos e campos entre aspas',
      { tags: ['@e2e', '@csv', '@upload'] },
      () => {
        const arquivo = 'valido.csv';

        cy.readFile(caminhoFixture(arquivo), null).then((bytes) => {
          const relatorio = validarArquivoCsv(bytes);
          validarCsvAceitoPorInteiro(relatorio, 5);
          expect(
            relatorio.registros.map(({ nome }) => nome),
            'nomes lidos (vírgula e aspas dentro do campo)',
          ).to.deep.equal([
            'João Silva',
            'Maria Santos',
            'Conceição Araújo',
            'Souza, Luís',
            'Ana "Nina" Lima',
          ]);

          uploadPage.selecionarArquivo(caminhoFixture(arquivo));
          validarArquivoSelecionado(arquivo, bytes.length);
          uploadPage.enviar().then((interceptacao) => {
            validarArquivoRecebido(interceptacao, {
              nomeArquivo: arquivo,
              conteudo: new TextDecoder('utf-8').decode(bytes),
            });
          });
        });
        validarUploadExibido(arquivo);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Upload de arquivo inválido (item 3): esperado de um importador real
  // versus comportamento observado do site
  // -------------------------------------------------------------------------
  describe('Upload de arquivo inválido', () => {
    beforeEach(() => {
      uploadPage.visitar();
      uploadPage.validarAberta();
    });

    ARQUIVOS_INVALIDOS.forEach(({ descricao, arquivo, linhasLidas, erros, binario }) => {
      it(
        `CT-UP-05 - ${descricao}: deve ser recusado pela validação de referência; o site aceita sem validar o conteúdo`,
        { tags: ['@e2e', '@csv', '@upload', '@negativo'] },
        () => {
          cy.readFile(caminhoFixture(arquivo), null).then((bytes) => {
            // 1. O arquivo tem exatamente o defeito do cenário (o que um
            //    importador real deveria recusar e reportar).
            const relatorio = validarArquivoCsv(bytes);
            expect(relatorio.valido, 'aceito pela validação de referência').to.equal(false);
            expect(resumirErros(relatorio.erros), 'erros esperados').to.deep.equal(erros);
            expect(relatorio.totalLinhasDeDados, 'linhas de dados lidas').to.equal(linhasLidas);
            expect(
              relatorio.registros.length + relatorio.linhasRejeitadas.length,
              'aceitas + rejeitadas = lidas',
            ).to.equal(relatorio.totalLinhasDeDados);

            // 2. Comportamento observado do site: aceita o arquivo, pois não
            //    lê o conteúdo (G01). Um sistema real deveria recusar.
            uploadPage.selecionarArquivo(caminhoFixture(arquivo));
            validarArquivoSelecionado(arquivo, bytes.length);
            uploadPage.enviar().then((interceptacao) => {
              validarArquivoRecebido(interceptacao, {
                nomeArquivo: arquivo,
                conteudo: binario ? undefined : new TextDecoder('utf-8').decode(bytes),
              });
            });
          });
          validarUploadExibido(arquivo);
        },
      );
    });

    it(
      'CT-UP-06 - Deve registrar o erro 500 do site ao enviar o formulário sem arquivo (defeito D01)',
      { tags: ['@e2e', '@upload', '@negativo'] },
      () => {
        uploadPage.elements.campoArquivo().should(($campo) => {
          expect($campo[0].files, 'nenhum arquivo selecionado').to.have.length(0);
        });

        // Esperado em um sistema real: mensagem de validação ("selecione um
        // arquivo") sem erro no servidor. Observado: HTTP 500.
        uploadPage.enviar().then((interceptacao) => {
          expect(interceptacao.response.statusCode, 'status do POST /upload').to.equal(
            STATUS_ERRO_INTERNO,
          );
          const enviado = lerArquivoEnviado(
            interceptacao.request.body,
            interceptacao.request.headers['content-type'],
          );
          expect(enviado.nomeArquivo, 'nome do arquivo enviado').to.equal('');
          expect(enviado.conteudo, 'conteúdo enviado').to.equal('');
        });
        uploadPage.elements.tituloErro().should('have.text', 'Internal Server Error');
        uploadPage.elements.arquivosEnviados().should('not.exist');
      },
    );
  });
});
