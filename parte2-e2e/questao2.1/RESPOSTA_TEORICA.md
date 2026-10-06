# Questão 2.1 - Fluxo de Checkout

Casos de teste, prioridades e rastreabilidade: [`CASOS_DE_TESTE.txt`](CASOS_DE_TESTE.txt).

## Premissa: o SauceDemo não tem cupom, pagamento real nem e-mail

O contexto da questão descreve um checkout com cupom de uso único, processamento de pagamento e confirmação do pedido. O site do teste prático (SauceDemo) cobre só parte disso:

| Elemento do contexto       | No SauceDemo                                                               | Onde é tratado              |
| -------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| Adicionar produtos         | Existe (carrinho no localStorage `cart-contents`)                          | CT-CK-01 a CT-CK-11         |
| Cupom de desconto          | Não existe                                                                 | 2.1.a (esta resposta) e G01 |
| Processamento de pagamento | Não existe: "SauceCard #31337" é texto fixo no resumo                      | G02                         |
| Confirmação do pedido      | Só na interface ("Checkout: Complete!"), sem número de pedido e sem e-mail | 2.1.b, CT-CK-01 e CT-CK-04  |

Por isso as respostas abaixo descrevem a estratégia para um checkout real (como o de uma loja da plataforma), e indicam o que se aplica ao SauceDemo.

---

## 2.1.a) Como garantir que cada execução use um cupom válido diferente

O problema central: um cupom de uso único é **estado consumível**. Se o teste usa um código fixo, a primeira execução passa e todas as seguintes falham com "cupom já utilizado". Se dois testes paralelos usam o mesmo cupom, um deles falha dependendo de quem chegou primeiro. A solução é o teste **criar o próprio cupom**, e não procurar um que esteja livre.

**1. Criar o cupom por API no `beforeEach` (minha escolha).**
Cada teste cria um cupom novo pela API administrativa (ou endpoint de seed do ambiente de teste) e usa o código retornado:

- código com sufixo único: prefixo do teste + identificador da execução + timestamp ou UUID (por exemplo `E2E-CHK-<runId>-<uuid curto>`). O prefixo facilita encontrar e limpar cupons de teste;
- regras do cupom definidas pelo próprio teste (tipo, valor, validade curta, uso único, valor mínimo), para que o resultado esperado seja conhecido e não dependa de configuração manual;
- a chamada é feita com `cy.request`, fora da interface: a criação do cupom não é o objeto do teste e não deve custar tempo de tela;
- o código fica em uma variável do teste (alias `cy.wrap(...).as('cupom')`), nunca em fixture compartilhada.

Assim o teste é independente da ordem, pode rodar em paralelo e pode ser reexecutado sem preparação manual.

**2. Validar o "uso único" com o cupom criado.**
Com o cupom sob controle, a regra de negócio vira dois cenários:

- primeiro uso: desconto aplicado e total recalculado (`Item total - desconto + impostos`);
- segundo uso do **mesmo** código (em outro pedido): recusado com a mensagem de cupom já utilizado, sem desconto no total.

O segundo cenário não deve depender do primeiro teste ter rodado. Ele cria o cupom e o consome por API (finalizando um pedido ou marcando como usado), e só então tenta usá-lo pela interface.

**3. Limpeza.**
No `afterEach`, o cupom criado é removido ou desativado por API. Como reforço, um job periódico do ambiente de teste apaga cupons com o prefixo `E2E-` mais antigos que algumas horas, cobrindo execuções interrompidas.

**Alternativas consideradas:**

| Alternativa                                                     | Quando usar / por que não foi a escolha                                                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pool de cupons pré-cadastrados, reservado por `cy.task` no Node | Útil quando não há API de criação. Exige controle de reserva para não haver dois testes com o mesmo cupom em paralelo, e o pool acaba e precisa ser reabastecido. |
| Reset do banco (seed) antes da suíte                            | Garante estado conhecido, mas é lento, não funciona com execuções paralelas no mesmo ambiente e não serve em ambientes compartilhados (homologação).              |
| Cupom reutilizável (sem limite de uso) só para testes           | Mais simples, mas deixa de testar exatamente a regra de uso único.                                                                                                |
| `cy.intercept` respondendo a validação do cupom                 | Bom para testar a interface (mensagens, total exibido, estados de erro) de forma determinística, mas não prova a regra no backend. Complementa, não substitui.    |
| Cupom fixo em fixture                                           | Descartado: quebra na segunda execução.                                                                                                                           |

**Pirâmide.** A regra de uso único deve ser validada principalmente em **teste de API ou integração** (aplicar o cupom duas vezes, concorrência de dois pedidos simultâneos com o mesmo cupom, cupom expirado, valor mínimo). No E2E fica um cenário de aplicação com sucesso e um de recusa, para garantir que a interface reflete a regra.

**No SauceDemo.** Não há cupom, então nada disso é implementável no teste prático (gap G01). O mesmo princípio, porém, é aplicado aos dados do comprador: nome, sobrenome e CEP são gerados com `@faker-js/faker` a cada teste, com a seed registrada no log para reproduzir uma falha (CT-CK-05).

---

## 2.1.b) Como validar a confirmação do pedido sem depender de e-mail real

O e-mail é **consequência** do pedido, não o pedido. O teste de checkout deve provar que o pedido foi criado corretamente; o envio do e-mail é outro comportamento, validado em outra camada. Depender de uma caixa de e-mail real traria atraso de entrega, filtros de spam, credenciais pessoais no teste e falhas que não têm relação com o checkout.

A validação é feita em camadas:

**1. Interface (sempre).**
Após finalizar, o teste valida a página de confirmação: URL, título, mensagem de sucesso e, em um sistema real, o número do pedido exibido. Também valida o efeito colateral visível: carrinho esvaziado.

**2. API ou banco (fonte da verdade).**
Com o número do pedido capturado da tela (ou da resposta da requisição de finalização, via `cy.intercept(...).as('finalizarPedido')` e `cy.wait('@finalizarPedido')`), o teste consulta o pedido por `cy.request` na API e confirma:

- status do pedido (por exemplo "aguardando pagamento" ou "pago");
- itens, quantidades e valores iguais aos do carrinho;
- desconto do cupom aplicado e cupom marcado como usado;
- dados do comprador gerados para aquele teste.

Se não houver API de consulta, uma consulta ao banco por `cy.task` cumpre o mesmo papel. É essa verificação que prova que o pedido existe, e não apenas que a tela de sucesso apareceu.

**3. E-mail sem caixa real (quando o e-mail faz parte do requisito).**

| Abordagem                                        | Como funciona                                                                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor SMTP de teste (Mailpit, MailHog)        | O ambiente de teste aponta o SMTP para o servidor de teste. Ele captura tudo e expõe uma API HTTP; o teste busca a mensagem pelo destinatário gerado e valida assunto, número do pedido e valores. |
| Serviço de caixa de teste (Mailosaur, Mailslurp) | Endereços descartáveis por teste (`<uuid>@<servidor>.mailosaur.net`). Útil em ambientes compartilhados, onde não se controla o SMTP.                                                               |
| Fila ou tabela de saída de e-mails               | Se o sistema grava a mensagem em fila/tabela antes de enviar, o teste confirma que o evento "pedido confirmado" foi gerado para o pedido certo, sem passar pelo SMTP.                              |
| `cy.intercept` da chamada ao serviço de e-mail   | Só vale se o navegador chamar o serviço diretamente (raro; normalmente o envio é do backend). Valida o payload, não a entrega.                                                                     |

Detalhes que tornam isso confiável:

- o e-mail do comprador é gerado por teste (como o cupom em 2.1.a), então a busca na caixa de teste não confunde mensagens de execuções diferentes;
- a busca é feita por polling com tempo limite (consulta repetida até a mensagem chegar ou o tempo acabar), nunca com `cy.wait` de tempo fixo;
- a validação do conteúdo do e-mail (layout, textos, links) fica em um teste próprio, de prioridade menor que o checkout. Uma falha no e-mail não deve esconder se o pedido foi criado ou não.

**No SauceDemo.** Não há e-mail, número de pedido nem backend: o pedido é montado no navegador, o carrinho é removido do localStorage e a confirmação é renderizada no cliente (gap G03). A validação possível, e a especificada, é pela interface (CT-CK-01 e CT-CK-04):

- URL `/checkout-complete.html` e título "Checkout: Complete!";
- `data-test="complete-header"` com "Thank you for your order!" e `data-test="complete-text"` com a mensagem de despacho;
- badge do carrinho ausente e `cart-contents` removido do localStorage, prova de que o pedido "consumiu" o carrinho;
- antes de finalizar, o resumo com itens e totais (`Item total + Tax = Total`), que é o que o pedido confirmado representa.

`cy.intercept` não se aplica ao checkout do SauceDemo: o fluxo não faz requisição de rede para criar o pedido.

---

### Comportamento atual do SauceDemo (observado em 06/10/2026)

Conferido no código publicado da aplicação, para que os cenários usem textos e seletores reais:

1. **Sessão e carrinho no navegador**: a sessão é o cookie `session-username` (validade de 10 minutos) e o carrinho é o localStorage `cart-contents` (lista de IDs). Por isso a limpeza entre testes é `cy.clearCookies()`, `cy.clearLocalStorage()` e limpeza do sessionStorage, no `afterEach` (pedido do enunciado) e também no `beforeEach`, para cobrir execuções interrompidas. Pelo mesmo motivo, os cenários que não testam login nem inclusão de produtos podem começar com o cookie e o carrinho já gravados, sem repetir esses passos pela interface.
2. **Validação do formulário**: First Name, Last Name e Postal Code são obrigatórios, verificados nessa ordem e com uma mensagem por vez (`Error: First Name is required` etc.). Não há validação de formato do CEP, e campos com apenas espaços são aceitos; como não há regra definida para isso, ficam como exploratório (G05), sem asserção.
3. **Totais**: Tax é 8% do Item total, arredondado em 2 casas, e Total = Item total + Tax. Os valores de referência do CT-CK-03 foram calculados com os preços atuais do catálogo.
4. **Checkout com carrinho vazio**: a aplicação permite chegar à confirmação sem nenhum item.
