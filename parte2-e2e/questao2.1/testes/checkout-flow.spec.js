/**
 * Questão 2.1 - Fluxo de checkout no SauceDemo (https://www.saucedemo.com).
 *
 * Os casos de teste, prioridades e a rastreabilidade com o enunciado estão em
 * parte2-e2e/questao2.1/CASOS_DE_TESTE.txt (os IDs abaixo são os mesmos).
 *
 * Estratégia:
 * - CT-CK-01 e CT-CK-02 percorrem o fluxo inteiro pela interface (login ->
 *   produtos -> checkout -> finalizar). Os demais cenários abrem direto a
 *   etapa testada, com sessão e carrinho gravados no navegador
 *   (prepararSessao), porque login e inclusão de produtos não são o objeto
 *   deles.
 * - Dados do comprador gerados com faker a cada teste. A seed vai para o
 *   Command Log e para o relatório; para reproduzir uma falha:
 *   `npx cypress run --expose FAKER_SEED=<seed>`.
 * - Dois blocos com desenhos de limpeza diferentes:
 *   1. Checkout (CT-CK-*): limparNavegador no beforeEach (defensivo) e no
 *      afterEach (item I4 do enunciado), sem verificações nos hooks.
 *   2. Isolamento (CT-IS-*), com testIsolation desligado: só o afterEach
 *      limpa, e em seguida verifica a limpeza. Assim, cada teste desse bloco
 *      começa limpo apenas pelo afterEach do anterior, que é o que se quer
 *      provar.
 *   cy.session não é usado: a sessão do SauceDemo é um único cookie, e
 *   restaurá-la entre testes iria contra a limpeza exigida.
 * - Page Objects só verificam navegação e sincronização (página aberta, botão
 *   trocado, itens carregados). As regras de negócio são verificadas aqui.
 *
 * Fora da automação (não existem no SauceDemo, ver Gaps G01 a G05):
 * cupom de desconto, processamento de pagamento, e-mail/número do pedido e
 * os comportamentos sem regra definida (checkout com carrinho vazio, campos
 * só com espaços, formato do CEP).
 */
import cabecalho from './pages/cabecalho';
import cartPage from './pages/cart-page';
import checkoutPage from './pages/checkout-page';
import inventoryPage from './pages/inventory-page';
import loginPage from './pages/login-page';
import {
  CAMPOS_COMPRADOR,
  compradorSemCampos,
  gerarComprador,
  gerarSenhaInvalida,
} from './fixtures/checkout-data';
import { PRODUTOS, TOTAIS_REFERENCIA } from './fixtures/produtos';
import {
  limparNavegador,
  prepararSessao,
  validarCarrinhoArmazenado,
  validarNavegadorLimpo,
} from './utils/checkout-helper';
import { COOKIE_SESSAO, PAGINAS, urlSauce } from './utils/rotas';
import { calcularTotais, formatarCentavos } from './utils/valores';

const PAGAMENTO = 'SauceCard #31337';
const ENTREGA = 'Free Pony Express Delivery!';
const CONFIRMACAO_CABECALHO = 'Thank you for your order!';
const CONFIRMACAO_TEXTO =
  'Your order has been dispatched, and will arrive just as fast as the pony can get there!';
const USUARIO_BLOQUEADO = 'locked_out_user';

/**
 * Seed de `--expose FAKER_SEED`, para reproduzir uma falha. Sem o parâmetro,
 * retorna `undefined` e cada comprador recebe uma seed nova.
 */
function seedInformada() {
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

/** Registra a seed no Command Log e no relatório do mochawesome. */
function registrarSeed(comprador, titulo = 'Seed do comprador (FAKER_SEED)') {
  cy.log(`${titulo}: ${comprador.seed}`);
  cy.addTestContext({ title: titulo, value: comprador.seed });
}

/** Comprador deste teste, com a seed registrada. */
function compradorDoTeste() {
  const comprador = gerarComprador(seedInformada());
  registrarSeed(comprador);
  return comprador;
}

/** Your Information -> Overview com os dados do comprador. */
function avancarAteOResumo(comprador) {
  checkoutPage.validarInformacoesAberta();
  checkoutPage.preencherComprador(comprador);
  checkoutPage.continuar();
  checkoutPage.validarResumoAberto();
}

/**
 * Regra RI06 sobre os valores exibidos: Item total = soma dos preços do
 * resumo, Tax = 8% do Item total e Total = Item total + Tax.
 */
function validarTotaisCoerentes(quantidadeDeItens) {
  checkoutPage.lerItensDoResumo(quantidadeDeItens).then((itens) => {
    const esperado = calcularTotais(itens.map((item) => item.preco));

    checkoutPage.lerTotais().then((exibido) => {
      expect(formatarCentavos(exibido.itemTotal), 'Item total = soma dos itens').to.equal(
        formatarCentavos(esperado.itemTotal),
      );
      expect(formatarCentavos(exibido.tax), 'Tax = 8% do Item total').to.equal(
        formatarCentavos(esperado.tax),
      );
      expect(formatarCentavos(exibido.total), 'Total = Item total + Tax').to.equal(
        formatarCentavos(exibido.itemTotal + exibido.tax),
      );
    });
  });
}

/** Nomes exibidos na ordem da tela. A leitura é refeita até a asserção passar. */
function validarNomesExibidos(elementos, nomesEsperados) {
  elementos.should(($nomes) => {
    expect(
      Cypress._.map($nomes, (elemento) => elemento.innerText.trim()),
      'itens exibidos',
    ).to.deep.equal(nomesEsperados);
  });
}

function validarConfirmacaoDoPedido() {
  checkoutPage.validarConfirmacaoAberta();
  checkoutPage.elements.cabecalhoConfirmacao().should('have.text', CONFIRMACAO_CABECALHO);
  checkoutPage.elements.textoConfirmacao().should('have.text', CONFIRMACAO_TEXTO);
  checkoutPage.elements.imagemConfirmacao().should('be.visible');
}

/** Página interna aberta sem sessão válida volta ao login com a mensagem (RI02). */
function validarAcessoNegado(pagina) {
  cy.visit(urlSauce(pagina));
  loginPage.validarAberta();
  loginPage.elements
    .erro()
    .should('have.text', `Epic sadface: You can only access '${pagina}' when you are logged in.`);
}

describe('Questão 2.1 - Fluxo de checkout (SauceDemo)', () => {
  // Limpeza defensiva antes e limpeza do enunciado (I4) depois de cada teste.
  // A verificação de que a limpeza funciona fica no bloco de isolamento.
  beforeEach(() => {
    limparNavegador();
  });

  afterEach(() => {
    limparNavegador();
  });

  // -------------------------------------------------------------------------
  // Fluxo completo pela interface (I1, I2, I3)
  // -------------------------------------------------------------------------
  describe('Fluxo completo pela interface', () => {
    it(
      'CT-CK-01 - Deve finalizar a compra de um produto com dados dinâmicos',
      { tags: ['@smoke', '@e2e', '@checkout'] },
      () => {
        const comprador = compradorDoTeste();

        loginPage.visitar();
        loginPage.entrarComUsuarioPadrao();
        inventoryPage.validarAberta();

        inventoryPage.adicionar(PRODUTOS.BACKPACK);
        cabecalho.validarQuantidadeNoCarrinho(1);

        cabecalho.abrirCarrinho();
        cartPage.validarAberta();
        cartPage.iniciarCheckout();
        avancarAteOResumo(comprador);

        checkoutPage.lerItensDoResumo(1).then((itens) => {
          expect(
            itens.map((item) => item.nome),
            'itens do resumo',
          ).to.deep.equal([PRODUTOS.BACKPACK.nome]);
        });
        checkoutPage.elements.pagamento().should('have.text', PAGAMENTO);
        checkoutPage.elements.entrega().should('have.text', ENTREGA);
        validarTotaisCoerentes(1);

        checkoutPage.finalizar();
        validarConfirmacaoDoPedido();
      },
    );

    it(
      'CT-CK-02 - Deve finalizar a compra de vários produtos com nome e preço iguais aos da vitrine',
      { tags: ['@e2e', '@checkout'] },
      () => {
        const comprador = compradorDoTeste();
        const produtos = [PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT, PRODUTOS.BOLT_TSHIRT];
        const precosNaVitrine = [];

        loginPage.visitar();
        loginPage.entrarComUsuarioPadrao();
        inventoryPage.validarAberta();

        produtos.forEach((produto) => {
          inventoryPage.lerPreco(produto).then((preco) => {
            precosNaVitrine.push({ nome: produto.nome, preco });
          });
          inventoryPage.adicionar(produto);
        });
        cabecalho.validarQuantidadeNoCarrinho(produtos.length);

        cabecalho.abrirCarrinho();
        cartPage.validarAberta();
        cartPage.iniciarCheckout();
        avancarAteOResumo(comprador);

        checkoutPage.lerItensDoResumo(produtos.length).then((itens) => {
          expect(itens, 'itens do resumo (nome e preço da vitrine)').to.deep.equal(precosNaVitrine);

          const esperado = calcularTotais(precosNaVitrine.map((item) => item.preco));
          checkoutPage.lerTotais().then((exibido) => {
            expect(
              formatarCentavos(exibido.itemTotal),
              'Item total = soma dos preços da vitrine',
            ).to.equal(formatarCentavos(esperado.itemTotal));
          });
        });
        validarTotaisCoerentes(produtos.length);

        checkoutPage.finalizar();
        validarConfirmacaoDoPedido();
      },
    );
  });

  // -------------------------------------------------------------------------
  // Resumo do pedido (Checkout: Overview)
  // -------------------------------------------------------------------------
  describe('Resumo do pedido', () => {
    Object.values(TOTAIS_REFERENCIA).forEach(({ descricao, produtos, itemTotal, tax, total }) => {
      it(
        `CT-CK-03 - Deve calcular os totais do resumo para ${descricao}`,
        { tags: ['@checkout'] },
        () => {
          prepararSessao({ produtos, pagina: PAGINAS.INFORMACOES });
          avancarAteOResumo(compradorDoTeste());

          checkoutPage.elements.itensDoResumo().should('have.length', produtos.length);
          checkoutPage.elements.itemTotal().should('have.text', `Item total: $${itemTotal}`);
          checkoutPage.elements.tax().should('have.text', `Tax: $${tax}`);
          checkoutPage.elements.total().should('have.text', `Total: $${total}`);
          validarTotaisCoerentes(produtos.length);
        },
      );
    });

    it(
      'CT-CK-08 - Deve remover um item no carrinho e refletir a remoção no resumo',
      { tags: ['@carrinho', '@checkout'] },
      () => {
        const restante = TOTAIS_REFERENCIA.BACKPACK;

        prepararSessao({
          produtos: [PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT],
          pagina: PAGINAS.CARRINHO,
        });
        cartPage.validarAberta();

        cartPage.remover(PRODUTOS.BIKE_LIGHT);
        validarNomesExibidos(cartPage.elements.nomesDosItens(), [PRODUTOS.BACKPACK.nome]);
        cabecalho.validarQuantidadeNoCarrinho(1);

        cartPage.iniciarCheckout();
        avancarAteOResumo(compradorDoTeste());

        checkoutPage.lerItensDoResumo(restante.produtos.length).then((itens) => {
          expect(
            itens.map((item) => item.nome),
            'itens do resumo',
          ).to.deep.equal(restante.produtos.map((produto) => produto.nome));
        });
        checkoutPage.elements.itemTotal().should('have.text', `Item total: $${restante.itemTotal}`);
        validarTotaisCoerentes(restante.produtos.length);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Confirmação do pedido (I3)
  // -------------------------------------------------------------------------
  describe('Confirmação do pedido', () => {
    it(
      'CT-CK-04 - Deve esvaziar o carrinho após finalizar o pedido',
      { tags: ['@checkout', '@carrinho'] },
      () => {
        prepararSessao({
          produtos: [PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT],
          pagina: PAGINAS.INFORMACOES,
        });
        avancarAteOResumo(compradorDoTeste());
        checkoutPage.finalizar();

        validarConfirmacaoDoPedido();
        cabecalho.validarQuantidadeNoCarrinho(0);
        validarCarrinhoArmazenado(null);

        checkoutPage.voltarParaProdutos();
        inventoryPage.validarAberta();
        inventoryPage.elements.itens().should('have.length', Object.keys(PRODUTOS).length);
        inventoryPage.elements.itens().each(($item) => {
          cy.wrap($item).find('button').should('have.text', 'Add to cart');
        });
        cabecalho.validarQuantidadeNoCarrinho(0);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Dados do comprador (I2) e formulário "Your Information"
  // -------------------------------------------------------------------------
  describe('Dados do comprador', () => {
    it(
      'CT-CK-05 - Deve usar dados de comprador diferentes a cada geração e reproduzíveis pela seed',
      { tags: ['@formulario'] },
      () => {
        // Dois compradores com seeds novas representam duas execuções distintas.
        const primeiro = gerarComprador();
        const segundo = gerarComprador();
        registrarSeed(primeiro, 'Seed do 1º comprador');
        registrarSeed(segundo, 'Seed do 2º comprador');

        expect(
          CAMPOS_COMPRADOR.every((campo) => primeiro[campo] === segundo[campo]),
          'nome, sobrenome e CEP todos iguais entre os compradores',
        ).to.equal(false);
        expect(gerarComprador(primeiro.seed), 'mesma seed, mesmo comprador').to.deep.equal(
          primeiro,
        );

        prepararSessao({ produtos: [PRODUTOS.BACKPACK], pagina: PAGINAS.INFORMACOES });
        checkoutPage.validarInformacoesAberta();

        [primeiro, segundo].forEach((comprador) => {
          checkoutPage.preencherComprador(comprador);
          CAMPOS_COMPRADOR.forEach((campo) => {
            checkoutPage.elements.campo(campo).should('have.value', comprador[campo]);
          });
        });

        checkoutPage.continuar();
        checkoutPage.validarResumoAberto();
      },
    );

    [
      { camposVazios: ['firstName'], mensagem: 'Error: First Name is required' },
      { camposVazios: ['lastName'], mensagem: 'Error: Last Name is required' },
      { camposVazios: ['postalCode'], mensagem: 'Error: Postal Code is required' },
      // Todos vazios: confirma a ordem de validação (RI05).
      { camposVazios: CAMPOS_COMPRADOR, mensagem: 'Error: First Name is required' },
    ].forEach(({ camposVazios, mensagem }) => {
      it(
        `CT-CK-06 - Deve impedir o avanço sem ${camposVazios.join(', ')}`,
        { tags: ['@formulario', '@negativo'] },
        () => {
          prepararSessao({ produtos: [PRODUTOS.BACKPACK], pagina: PAGINAS.INFORMACOES });
          checkoutPage.validarInformacoesAberta();

          checkoutPage.preencherComprador(compradorSemCampos(compradorDoTeste(), camposVazios));
          checkoutPage.continuar();

          checkoutPage.elements.erro().should('be.visible').and('have.text', mensagem);
          checkoutPage.validarInformacoesAberta();
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Carrinho e navegação durante o checkout
  // -------------------------------------------------------------------------
  describe('Carrinho e navegação', () => {
    it(
      'CT-CK-07 - Deve atualizar o badge do carrinho ao incluir e remover produtos',
      { tags: ['@carrinho'] },
      () => {
        prepararSessao();
        inventoryPage.validarAberta();
        cabecalho.validarQuantidadeNoCarrinho(0);

        inventoryPage.adicionar(PRODUTOS.BACKPACK);
        inventoryPage.adicionar(PRODUTOS.BIKE_LIGHT);
        cabecalho.validarQuantidadeNoCarrinho(2);
        [PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT].forEach((produto) => {
          inventoryPage.elements.botaoRemover(produto).should('have.text', 'Remove');
        });

        inventoryPage.remover(PRODUTOS.BIKE_LIGHT);
        cabecalho.validarQuantidadeNoCarrinho(1);
        validarCarrinhoArmazenado([PRODUTOS.BACKPACK]);
      },
    );

    it(
      'CT-CK-09 - Deve cancelar o preenchimento dos dados e voltar ao carrinho mantendo o produto',
      { tags: ['@carrinho'] },
      () => {
        prepararSessao({ produtos: [PRODUTOS.BACKPACK], pagina: PAGINAS.INFORMACOES });
        checkoutPage.validarInformacoesAberta();

        checkoutPage.cancelar();

        cartPage.validarAberta();
        validarNomesExibidos(cartPage.elements.nomesDosItens(), [PRODUTOS.BACKPACK.nome]);
        cabecalho.validarQuantidadeNoCarrinho(1);
      },
    );

    it(
      'CT-CK-10 - Deve cancelar no resumo sem finalizar o pedido e manter o carrinho',
      { tags: ['@checkout', '@carrinho'] },
      () => {
        const produtos = [PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT];
        prepararSessao({ produtos, pagina: PAGINAS.INFORMACOES });
        avancarAteOResumo(compradorDoTeste());

        checkoutPage.cancelar();

        // Finalizar esvazia o carrinho (CT-CK-04); com os 2 itens ainda
        // gravados, o pedido não foi finalizado.
        inventoryPage.validarAberta();
        cabecalho.validarQuantidadeNoCarrinho(2);
        validarCarrinhoArmazenado(produtos);
      },
    );

    it(
      'CT-CK-11 - Deve continuar comprando e incluir mais um produto no carrinho',
      { tags: ['@carrinho'] },
      () => {
        prepararSessao({ produtos: [PRODUTOS.BACKPACK], pagina: PAGINAS.CARRINHO });
        cartPage.validarAberta();

        cartPage.continuarComprando();
        inventoryPage.validarAberta();
        inventoryPage.adicionar(PRODUTOS.BIKE_LIGHT);
        cabecalho.validarQuantidadeNoCarrinho(2);

        cabecalho.abrirCarrinho();
        cartPage.validarAberta();
        validarNomesExibidos(cartPage.elements.nomesDosItens(), [
          PRODUTOS.BACKPACK.nome,
          PRODUTOS.BIKE_LIGHT.nome,
        ]);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Login inválido
  // -------------------------------------------------------------------------
  describe('Login inválido', () => {
    it('CT-CK-12 - Deve recusar o login com senha inválida', { tags: ['@negativo'] }, () => {
      loginPage.visitar();
      cy.env(['SAUCE_USERNAME', 'SAUCE_PASSWORD']).then(({ SAUCE_USERNAME, SAUCE_PASSWORD }) => {
        loginPage.entrar(SAUCE_USERNAME, gerarSenhaInvalida(SAUCE_PASSWORD));
      });

      loginPage.elements
        .erro()
        .should(
          'have.text',
          'Epic sadface: Username and password do not match any user in this service',
        );
      loginPage.validarAberta();
      cy.getCookie(COOKIE_SESSAO).should('be.null');
      validarAcessoNegado(PAGINAS.PRODUTOS);
    });

    it('CT-CK-12 - Deve recusar o login de usuário bloqueado', { tags: ['@negativo'] }, () => {
      loginPage.visitar();
      cy.env(['SAUCE_PASSWORD']).then(({ SAUCE_PASSWORD }) => {
        loginPage.entrar(USUARIO_BLOQUEADO, SAUCE_PASSWORD);
      });

      loginPage.elements
        .erro()
        .should('have.text', 'Epic sadface: Sorry, this user has been locked out.');
      loginPage.validarAberta();

      // O SauceDemo grava o cookie "session-username" antes de checar o
      // bloqueio, então ele existe. O critério é ele não valer como sessão.
      validarAcessoNegado(PAGINAS.PRODUTOS);
    });
  });
});

// ---------------------------------------------------------------------------
// Isolamento e limpeza entre testes (I4)
// ---------------------------------------------------------------------------
// testIsolation desligado: o Cypress deixa de limpar o navegador sozinho entre
// os testes, e não há beforeEach de limpeza. Cada teste começa limpo apenas
// pelo afterEach do teste anterior, que limpa e verifica a limpeza. Se a
// verificação falhar, o Mocha pula o restante deste bloco, sem afetar o de
// checkout. Os testes "deixa estado" e "começa limpo" de cada caso precisam
// ficar em sequência.
describe('Questão 2.1 - Isolamento e limpeza entre testes', { testIsolation: false }, () => {
  afterEach(() => {
    limparNavegador();
    validarNavegadorLimpo();
  });

  it(
    'CT-IS-01 - Deve terminar o teste com sessão e 2 produtos no carrinho (estado a ser limpo)',
    { tags: ['@smoke', '@isolamento'] },
    () => {
      loginPage.visitar();
      loginPage.entrarComUsuarioPadrao();
      inventoryPage.validarAberta();
      inventoryPage.adicionar(PRODUTOS.BACKPACK);
      inventoryPage.adicionar(PRODUTOS.BIKE_LIGHT);

      cabecalho.validarQuantidadeNoCarrinho(2);
      cy.getCookie(COOKIE_SESSAO).should('exist');
      validarCarrinhoArmazenado([PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT]);
    },
  );

  it(
    'CT-IS-01 - Deve começar o teste seguinte sem sessão e sem carrinho',
    { tags: ['@smoke', '@isolamento'] },
    () => {
      // Depende só do afterEach, não do resultado do teste anterior.
      validarNavegadorLimpo();

      loginPage.visitar();
      loginPage.entrarComUsuarioPadrao();
      inventoryPage.validarAberta();
      cabecalho.validarQuantidadeNoCarrinho(0);
      validarCarrinhoArmazenado(null);
    },
  );

  it(
    'CT-IS-03 - Deve terminar o teste com um checkout em andamento e sessionStorage gravado (estado a ser limpo)',
    { tags: ['@isolamento'] },
    () => {
      prepararSessao({
        produtos: [PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT],
        pagina: PAGINAS.INFORMACOES,
      });
      avancarAteOResumo(compradorDoTeste());

      // O SauceDemo não usa sessionStorage; o item é gravado aqui para provar
      // que a limpeza também o remove.
      cy.window().then((win) => {
        win.sessionStorage.setItem('checkout-em-andamento', 'true');
      });
      cy.window()
        .its('sessionStorage')
        .invoke('getItem', 'checkout-em-andamento')
        .should('eq', 'true');
      cy.getCookie(COOKIE_SESSAO).should('exist');
      validarCarrinhoArmazenado([PRODUTOS.BACKPACK, PRODUTOS.BIKE_LIGHT]);
    },
  );

  it(
    'CT-IS-03 - Deve começar o teste seguinte sem sessão, carrinho nem sessionStorage do checkout abandonado',
    { tags: ['@isolamento'] },
    () => {
      validarNavegadorLimpo();

      // Sem a sessão, o resumo abandonado não pode ser retomado.
      validarAcessoNegado(PAGINAS.RESUMO);
      validarCarrinhoArmazenado(null);
    },
  );

  it(
    'CT-IS-02 - Deve voltar ao login ao abrir o checkout sem sessão',
    { tags: ['@isolamento', '@negativo'] },
    () => {
      // Começa limpo pelo afterEach do teste anterior (não há beforeEach aqui).
      cy.getCookie(COOKIE_SESSAO).should('be.null');

      validarAcessoNegado(PAGINAS.INFORMACOES);
      cy.getCookie(COOKIE_SESSAO).should('be.null');
    },
  );
});
