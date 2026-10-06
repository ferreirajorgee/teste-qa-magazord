/**
 * Página "File Uploader" do the-internet (https://the-internet.herokuapp.com/upload).
 *
 * O formulário é um POST multipart tradicional para /upload: o servidor
 * responde com uma página nova ("File Uploaded!"), sem JavaScript. Por isso
 * a sincronização é pelo alias da requisição, e não por tempo.
 */
const ROTA_UPLOAD = '**/upload';

// O Heroku do the-internet responde 503 de forma intermitente (observado em
// 06/10/2026). Isso é indisponibilidade do ambiente, não resultado do teste.
const STATUS_INDISPONIVEL = 503;
const STATUS_OK = 200;

/**
 * Lança a falha INCONCLUSIVO quando o the-internet respondeu 503, para não
 * confundir indisponibilidade do ambiente com defeito do site ou do teste.
 * Qualquer outro status segue para as asserções de quem chamou.
 */
export function falharSeIndisponivel(interceptacao) {
  if (interceptacao.response?.statusCode === STATUS_INDISPONIVEL) {
    throw new Error(
      `INCONCLUSIVO: o the-internet respondeu 503 em ${interceptacao.request.method} ` +
        `${interceptacao.request.url} (Heroku indisponível). ` +
        'Não é defeito da aplicação nem do teste; execute novamente.',
    );
  }
  return interceptacao;
}

class UploadPage {
  elements = {
    titulo: () => cy.get('#content h3'),
    campoArquivo: () => cy.get('#file-upload'),
    botaoEnviar: () => cy.get('#file-submit'),
    arquivosEnviados: () => cy.get('#uploaded-files'),
    // Página de erro do servidor (resposta 500 do POST /upload sem arquivo).
    tituloErro: () => cy.get('h1'),
  };

  /**
   * Abre /upload. `failOnStatusCode: false` só deixa o 503 chegar ao
   * falharSeIndisponivel; qualquer outro status diferente de 200 continua
   * falhando na asserção logo em seguida.
   */
  visitar() {
    cy.intercept('GET', ROTA_UPLOAD).as('paginaUpload');
    cy.visit(Cypress.expose('UPLOAD_URL'), { failOnStatusCode: false });
    cy.wait('@paginaUpload')
      .then(falharSeIndisponivel)
      .its('response.statusCode')
      .should('eq', STATUS_OK);
  }

  validarAberta() {
    cy.location('pathname').should('eq', '/upload');
    this.elements.titulo().should('have.text', 'File Uploader');
    this.elements.campoArquivo().should('be.visible');
  }

  /**
   * Seleciona o arquivo no input nativo. `arquivo` é o caminho de uma fixture
   * ou `{ contents, fileName, mimeType }` para um arquivo gerado em memória.
   */
  selecionarArquivo(arquivo) {
    this.elements.campoArquivo().selectFile(arquivo);
  }

  /**
   * Envia o formulário e devolve a interceptação do POST /upload, já com a
   * resposta do servidor. 503 vira falha INCONCLUSIVO, para não ser
   * confundido com defeito do site nem do teste.
   */
  enviar() {
    cy.intercept('POST', ROTA_UPLOAD).as('upload');
    this.elements.botaoEnviar().click();

    return cy.wait('@upload').then(falharSeIndisponivel);
  }

  /** Página de resultado carregada (mesma URL /upload, agora com o resultado). */
  validarResultadoAberto() {
    cy.location('pathname').should('eq', '/upload');
    this.elements.titulo().should('have.text', 'File Uploaded!');
  }
}

export default new UploadPage();
