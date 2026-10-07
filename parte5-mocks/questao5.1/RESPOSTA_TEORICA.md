# Questão 5.1 - Mocks de APIs Externas

Questão teórica: não há implementação de mock server, código nem schemas nesta parte.

## Premissa: o que se testa é o nosso lado da fronteira

O comportamento do Mercado Livre e da Amazon não pode ser controlado nem é responsabilidade do sistema. O que precisa ser provado é como **o nosso sistema** monta o que envia, interpreta o que recebe e reage quando o outro lado falha, demora ou limita. As operações têm riscos diferentes:

| Operação          | Direção                                | Risco se falhar                                               | Criticidade |
| ----------------- | -------------------------------------- | ------------------------------------------------------------- | ----------- |
| Processar pedidos | Entrada (notificação, depois consulta) | Pedido perdido ou importado duas vezes                        | Crítica     |
| Atualizar estoque | Saída, alta frequência                 | Venda sem estoque, cancelamento e penalidade de reputação     | Crítica     |
| Atualizar preços  | Saída, alta frequência                 | Preço errado; atualização antiga sobrescrevendo uma mais nova | Alta        |
| Publicar produtos | Saída, menor frequência                | Anúncio recusado, incompleto ou duplicado                     | Média/Alta  |

Pedidos e estoque recebem os cenários de falha mais completos; publicação recebe mais validação de formato. O princípio é o das Partes 1 a 3: **separar a regra de decisão da chamada de rede**.

---

## 5.1.a) Como testar sem afetar os ambientes reais dos marketplaces

**1. Integração substituível por configuração.** Cada marketplace tem um adaptador próprio, com URL base, credenciais e timeouts vindos do ambiente. Em teste, a URL aponta para o mock server ou para o sandbox do marketplace.

**2. Barreiras contra produção**, independentes entre si: ambientes de teste sem credenciais de produção (uma chamada indevida falha em vez de publicar); lista de hosts permitidos e bloqueio de saída para os hosts de produção; dados com prefixo identificável no SKU e no título (por exemplo `E2E-`), para localizar e limpar o que o teste criou.

**3. Camadas.**

| Camada                     | Para quê                                                               | Frequência            |
| -------------------------- | ---------------------------------------------------------------------- | --------------------- |
| Unitário do adaptador      | Tradução de modelos, classificação de erros, cálculo de espera e retry | Todo PR               |
| Integração com mock server | Reação do sistema a sucesso, erros, timeout, 429 e payloads incomuns   | Todo PR               |
| Schema e contrato          | Garantir que o mock continua fiel à API real (5.1.d e 5.1.e)           | Todo PR e noturno     |
| Sandbox do marketplace     | Autenticação real e fluxo de ponta a ponta em poucos cenários          | Noturno e pré-release |

**4. Sandboxes como última camada, não a principal.** O Mercado Livre permite criar usuários de teste por API e avisa mudanças por notificações por tópico, que trazem a referência do recurso a ser consultado. A Amazon SP-API tem sandbox estático (respostas fixas para requisições pré-definidas) e dinâmico (em parte das operações). Servem para autenticação e formato, mas não permitem provocar falhas, latência ou limites.

**5. Entrada simulada.** O teste faz o papel do marketplace: envia a notificação ao webhook do sistema (ou publica na fila simulada com LocalStack, no caso das notificações da Amazon por SQS) e o mock responde à consulta seguinte. Assim dá para testar notificação duplicada, fora de ordem, para pedido inexistente e com assinatura inválida, o que nenhum sandbox permite.

---

## 5.1.b) Estratégia de mock e escolha de ferramenta

**Minha escolha: WireMock em container como mock das APIs dos marketplaces, com Toxiproxy para falhas de rede. MSW ou `cy.intercept` só na interface.**

O ponto decisivo é **quem faz a chamada**: as chamadas saem do backend, não do navegador, e a linguagem do backend não é informada.

| Critério                        | WireMock                                             | MSW                                               | JSON Server                    |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------- | ------------------------------ |
| Onde atua                       | Servidor HTTP; qualquer linguagem chama              | Dentro do processo JavaScript (navegador ou Node) | Servidor HTTP de CRUD genérico |
| Falhas (500, atraso, conexão)   | Nativo (`status`, `fixedDelayMilliseconds`, `fault`) | Status e atraso, em código                        | Não                            |
| Estado e verificação do enviado | Scenarios e request journal                          | Em código                                         | CRUD sim; verificação não      |
| Uso indicado                    | APIs externas em integração e E2E                    | Interface e unitário de código JS                 | Protótipo de front-end         |

**1. Agnóstico de linguagem.** O sistema roda sem alteração além da URL base, exercitando o cliente HTTP real (timeout, pool, serialização).

**2. Falhas, estado e verificação nativos.** 500, atraso e conexão resetada são configuração; scenarios simulam sequências (500, 500, 200); o journal responde "o sistema chamou o estoque uma vez, com quantidade 7?"; stubs podem casar por JSON Schema (5.1.d).

**3. JSON Server descartado:** não simula falhas nem verifica requisições, o que daria falsa sensação de cobertura. **MSW e `cy.intercept`** simulam o nosso backend para a tela do lojista, como nas Partes 2 e 3, e não o marketplace.

**4. Organização dos stubs.**

- versionados por marketplace, junto com o código de teste;
- respostas gravadas no sandbox (modo record do WireMock) e limpas de dados pessoais e tokens. Resposta escrita "de cabeça" é a principal causa de mock irreal;
- um conjunto base para o caminho feliz, e stubs específicos registrados por cada teste pela API administrativa do WireMock;
- isolamento em execução paralela por SKUs e ids próprios de cada teste, gerados com seed;
- fixtures dos stubs validadas contra o schema (5.1.d), para o mock não divergir da API real.

---

## 5.1.c) Como simular 500, timeout e 429 e o que validar

O sistema precisa **distinguir** os três, porque cada um pede uma reação diferente (o mesmo cuidado da Parte 1.1, que separa o 403 de rate limit do 403 de permissão). No WireMock, a simulação é feita assim:

- **500**: `status: 500` (e 502/503), com um scenario 500, 500, 200 para testar a recuperação;
- **timeout**: atraso maior que o timeout de leitura (`fixedDelayMilliseconds`) e `fault` para conexão resetada ou resposta vazia. O Toxiproxy corta a conexão no meio da resposta;
- **429**: `status: 429`, com e sem o header `Retry-After`.

O tempo não é esperado de verdade: backoff e `Retry-After` são testados com o "agora" injetado como parâmetro, então o teste não fica parado aguardando.

**1. 500: falha provavelmente temporária.** O que valido:

- nova tentativa com **backoff exponencial com jitter** e limite de tentativas, conferindo no journal o número exato de chamadas;
- esgotadas as tentativas, a mensagem vai para DLQ ou para um status de erro visível ao lojista, nunca é descartada em silêncio;
- a falha no produto A não trava os produtos B e C;
- o **circuit breaker** abre após falhas consecutivas e volta a liberar aos poucos.

Como contraste, 400/422 **não** é repetido: um payload inválido nunca vai passar.

**2. Timeout: resultado desconhecido.** É o caso mais perigoso, porque o marketplace pode ter processado a requisição. O cliente precisa de timeout finito para liberar o worker. O teste simula "gravou, mas respondeu depois do timeout" e valida que:

- a publicação **não duplica o anúncio** (consulta por SKU antes de repetir, ou chave de idempotência quando a API oferece);
- estoque e preço são enviados como valores absolutos, seguros de repetir;
- um reenvio atrasado de R$ 100 não sobrescreve o R$ 90 enviado depois;
- o pedido cuja consulta falhou volta para a fila.

**3. 429: o marketplace pediu para esperar.** O que valido:

- respeita o `Retry-After` quando presente e usa backoff com jitter quando ausente;
- controla o ritmo **por operação**, já que a SP-API define limites por operação no modelo de token bucket. Um 429 em preço não pode parar pedidos;
- prioriza pedidos e estoque sobre preço e publicação;
- não conta como falha para o circuit breaker nem para a DLQ.

| Erro    | Repete?                                            | Principal risco validado                    |
| ------- | -------------------------------------------------- | ------------------------------------------- |
| 500     | Sim, com backoff e limite; depois DLQ              | Laço infinito ou perda silenciosa           |
| Timeout | Só de forma idempotente ou após consultar o estado | Duplicidade e ordem errada                  |
| 429     | Sim, após `Retry-After` ou backoff, por operação   | Bloqueio em cascata e prioridade errada     |
| 400/422 | Não                                                | Repetir indefinidamente um payload inválido |

---

## 5.1.d) Como validar o formato do payload (schema validation)

**1. Fonte do schema.** A Amazon publica os modelos da SP-API em OpenAPI e oferece as definições de tipo de produto em JSON Schema. No Mercado Livre, os atributos obrigatórios variam por categoria e são consultáveis por API; o schema é montado a partir da documentação e de respostas reais gravadas. Os schemas ficam versionados com a versão de origem.

**2. Ferramenta: AJV** (com `ajv-formats`), rápido e compatível com JSON Schema/OpenAPI 3.1, usável no teste e em tempo de execução.

**3. Estrito no envio, tolerante no recebimento.** O que o sistema monta é validado com obrigatórios, tipos, enums e `additionalProperties: false`, porque qualquer desvio é defeito nosso. O que o marketplace devolve é validado só nos campos que o sistema usa, porque campos novos chegam sem aviso e não podem parar a integração. Regras de negócio ficam fora do schema: preço maior que zero, estoque inteiro e não negativo, SKU do anúncio igual ao do produto.

**4. Ponto no pipeline.**

| Ponto                        | O que valida                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Unitário do adaptador (PR)   | Payload de cada operação, com valores de borda e acentos. O mais barato e o que mais pega        |
| Fixtures do mock (PR)        | Toda resposta dos stubs é válida no schema: o mock não pode "mentir"                             |
| Integração com WireMock (PR) | Stub casa por JSON Schema; payload fora do formato recebe 400 e o teste mostra o que foi enviado |
| Sandbox (noturno)            | Respostas reais contra o schema versionado; divergência indica **drift de contrato**             |
| Produção (monitoramento)     | Resposta fora do schema vira log e métrica, sem bloquear o fluxo                                 |

---

## 5.1.e) Testes com mock versus testes de contrato

**1. Mock** responde "dado que o marketplace responde X, o sistema faz a coisa certa?". É rápido, determinístico e simula qualquer falha, mas se o marketplace passar a responder Y, o teste continua verde: é o **drift do mock**. **Contrato** responde "X ainda é o que o marketplace responde?". Um dá cobertura de comportamento; o outro, confiança de que essa cobertura é real.

**2. O provedor não colabora.** No Pact clássico, orientado ao consumidor, o provedor executa o contrato no pipeline dele, e Mercado Livre e Amazon não vão rodar os contratos da Magazord. Para eles, uso **contrato bidirecional / baseado em schema**: as interações registradas a partir dos nossos mocks são comparadas com a especificação do provedor (o OpenAPI da Amazon, o schema montado para o Mercado Livre), sem exigir nada do marketplace (o PactFlow oferece esse modelo). Complemento com verificação agendada no sandbox, que pega mudanças de comportamento que o schema não mostra.

**3. Onde o Pact clássico se aplica:** entre os serviços internos (núcleo de catálogo, estoque e pedidos, serviço de integração, receptor de webhooks), onde os dois lados são nossos. O núcleo não muda o evento "estoque alterado" sem que o próprio pipeline acuse a quebra.

| Necessidade                                   | Tipo de teste                                           |
| --------------------------------------------- | ------------------------------------------------------- |
| Comportamento com sucesso, erro, timeout, 429 | Mock (unitário e integração com WireMock)               |
| Payload enviado conforme a especificação      | Schema (5.1.d), no PR                                   |
| Mocks ainda fiéis às APIs reais               | Contrato bidirecional + verificação agendada no sandbox |
| Serviços internos sem quebrar uns aos outros  | Pact orientado ao consumidor                            |

**Pirâmide.** Base de testes com mock, muitos e rápidos; acima, schema e contrato, que sustentam os mocks; no topo, poucos testes no sandbox. Testar tudo contra o sandbox daria uma suíte lenta, limitada pelo rate limit dos marketplaces e incapaz de provocar os erros que mais importam.

---

### Premissas adotadas

O enunciado não detalha alguns pontos que mudam a estratégia. Para responder, assumi:

1. **Arquitetura da integração**: assíncrona, com fila e workers. É o que torna possível retry, DLQ e prioridade entre operações.
2. **Fonte da verdade do estoque**: o sistema da loja, e não o marketplace. O estoque enviado a cada canal já desconta as reservas de pedidos ainda não confirmados.
3. **Após esgotar as tentativas**: a mensagem vai para a DLQ, o lojista é alertado no painel e o reprocessamento é manual.
4. **Contas de teste**: disponíveis nos sandboxes dos dois marketplaces, o que viabiliza a camada de sandbox da estratégia.
