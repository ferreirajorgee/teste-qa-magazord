import { PAGINAS, urlSauce } from '../utils/routes';

class LoginPage {
  elements = {
    usuario: () => cy.get('[data-test="username"]'),
    senha: () => cy.get('[data-test="password"]'),
    botaoLogin: () => cy.get('[data-test="login-button"]'),
    erro: () => cy.get('[data-test="error"]'),
  };

  visitar() {
    cy.visit(urlSauce(PAGINAS.LOGIN));
  }

  /** A senha é digitada com `log: false` para não aparecer no Command Log. */
  entrar(usuario, senha) {
    this.elements.usuario().clear().type(usuario);
    this.elements.senha().clear().type(senha, { log: false });
    this.elements.botaoLogin().click();
  }

  /** Login pela interface com as credenciais de `cy.env`. */
  entrarComUsuarioPadrao() {
    cy.env(['SAUCE_USERNAME', 'SAUCE_PASSWORD']).then(({ SAUCE_USERNAME, SAUCE_PASSWORD }) => {
      this.entrar(SAUCE_USERNAME, SAUCE_PASSWORD);
    });
  }

  validarAberta() {
    cy.location('pathname').should('eq', PAGINAS.LOGIN);
    this.elements.botaoLogin().should('be.visible');
  }
}

export default new LoginPage();
