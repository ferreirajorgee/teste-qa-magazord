# Questão 3.1 - Importação de CSV

Implementação: [`testes/csv-upload.spec.js`](testes/csv-upload.spec.js), [`testes/utils/csv-generator.js`](testes/utils/csv-generator.js) e [`testes/utils/csv-validador.js`](testes/utils/csv-validador.js).
Casos de teste, prioridades e rastreabilidade: [`CASOS_DE_TESTE.txt`](CASOS_DE_TESTE.txt).

## Premissa: o site do teste prático não importa nada

O contexto da questão descreve um importador que lê CSVs de 1000+ linhas e valida formato, regras de negócio, duplicatas e relacionamentos. O site do teste prático (`the-internet.herokuapp.com/upload`) é um **upload genérico**: recebe qualquer arquivo, responde "File Uploaded!" com o nome e não lê o conteúdo.

| Elemento do contexto            | No the-internet                                       | Onde é tratado              |
| ------------------------------- | ----------------------------------------------------- | --------------------------- |
| Recebimento do arquivo          | Existe (POST multipart para `/upload`)                | CT-UP-03 a CT-UP-06         |
| Contagem de linhas processadas  | Não existe: o site não devolve nenhum resumo          | 3.1.a (esta resposta) e G01 |
| Validação de formato e de dados | Não existe: aceita vazio, binário e CSV malformado    | 3.1.b, CT-UP-05 e G01       |
| Duplicatas e relacionamentos    | Não existe                                            | 3.1.a, 3.1.b e G02          |
| Mensagem de erro para o usuário | Não existe; sem arquivo, o servidor responde HTTP 500 | CT-UP-06 e defeito D01      |

Por isso a automação separa duas perguntas, e nunca as mistura em uma asserção:

1. **O arquivo é o que o cenário diz ser?** Respondida pelo validador de referência (`csv-validador.js`), que implementa o que um importador real deveria verificar e serve de oráculo: o CSV gerado tem exatamente N linhas válidas e e-mails únicos; a fixture "malformada" tem exatamente os 8 defeitos esperados, nas linhas esperadas.
2. **O que o site faz com ele?** Respondida pelo upload real. Para os válidos, o teste prova que o arquivo **saiu íntegro do navegador** (o corpo multipart capturado pelo proxy do Cypress, no `cy.intercept`, é idêntico no texto ao CSV gerado) e que o servidor respondeu 200 exibindo o nome. O que o servidor fez com o conteúdo não é observável: o site não o devolve. Para os inválidos, registra o comportamento observado (aceita sem validar) como comportamento observado, e não como acerto do site.

As respostas abaixo descrevem a estratégia para um importador real e indicam o que foi aplicado no teste prático.

---

## 3.1.a) Como validar que todas as 1000 linhas foram processadas corretamente

"Upload concluído" não prova importação. O risco real de um importador é a **perda silenciosa**: o arquivo é aceito, a tela diz sucesso, e 3 das 1000 linhas somem (quebra de linha dentro de campo entre aspas, encoding, timeout de um lote, duplicata descartada sem aviso). A validação precisa provar contagem, identidade e conteúdo, nessa ordem.

**1. Arquivo com resultado esperado conhecido (pré-condição).**
O teste gera o próprio arquivo, com dados determinísticos e rastreáveis:

- seed registrada no log: a mesma seed regenera o mesmo arquivo para reproduzir uma falha (`--expose FAKER_SEED=<seed>`);
- chave única por linha, derivada do número da linha (no gerador: `nome.sobrenome.0042@example.com`). Isso garante zero duplicatas acidentais e permite saber, para qualquer registro, de qual linha ele veio;
- dados com acentos e campos com vírgula e aspas, que são exatamente os pontos em que parsers erram;
- antes do upload, o próprio teste confere o arquivo (CT-UP-01): 1001 linhas físicas, cabeçalho, 1000 registros válidos, 1000 e-mails distintos, UTF-8 com mais bytes que caracteres. Se o arquivo de entrada estiver errado, o teste falha ali, e não depois, com uma divergência impossível de diagnosticar.

**2. Reconciliação de contagens (a asserção principal).**
Todo importador sério devolve um resumo do processamento (na resposta da API, em um job de importação ou em um relatório). O teste valida a equação de fechamento:

```text
lidas = inseridas + atualizadas + rejeitadas + ignoradas
lidas = 1000 (o que o teste gerou)
```

Para um arquivo 100% válido: `lidas = 1000`, `inseridas = 1000`, `rejeitadas = 0`. Para um arquivo com defeitos plantados (por exemplo 990 válidas + 10 inválidas em linhas conhecidas): `inseridas = 990` e `rejeitadas = 10`, e o relatório de erros aponta **exatamente** aquelas 10 linhas, com o motivo certo. A reconciliação é o que pega a perda silenciosa: um importador que perde 3 linhas fecha a conta em 997.

O validador de referência do projeto já produz esse formato (`totalLinhasDeDados`, `registros`, `linhasRejeitadas`, `erros` com tipo e linha), e o CT-UP-05 verifica `aceitas + rejeitadas = lidas` em cada fixture inválida. É o mesmo contrato que eu cobraria do importador real.

**3. Identidade e conteúdo na fonte da verdade (banco ou API).**
Contagem certa com dados errados ainda é defeito. Depois da importação, o teste consulta o sistema (`cy.request` na API de consulta, ou `cy.task` com uma query no banco), filtrando pelo lote do teste (prefixo ou id de importação):

- `COUNT(*)` do lote = 1000;
- conjunto de chaves importadas = conjunto de chaves geradas (diferença vazia nos dois sentidos: nenhuma faltando, nenhuma sobrando);
- comparação campo a campo dos 1000 registros com os dados gerados, em memória, no Node (`cy.task`), e não 1000 asserções no navegador. Na comparação, atenção a acentos (UTF-8 preservado), espaços nas bordas, números (idade como inteiro, não "30.0") e datas/fusos;
- amostragem estratificada visível na interface (primeira, última, uma do meio e as linhas com caracteres especiais), para confirmar que a tela reflete o banco.

A última linha merece atenção especial: arquivo sem `\n` final, BOM no início e `\r\n` do Windows são causas clássicas de perder ou corromper a primeira ou a última linha.

**4. Processamento assíncrono sem `cy.wait` fixo.**
Importações de 1000+ linhas costumam rodar em fila. O teste captura o id do job na resposta do upload (`cy.intercept(...).as('importar')`) e consulta o status por polling com tempo limite (requisição repetida até `concluido` ou `erro`), nunca com espera fixa. O tempo de processamento vira métrica: um teste de volume maior (10 mil, 100 mil linhas) fica em uma suíte de performance separada, não no E2E.

**5. Idempotência e duplicatas.**
Reimportar o mesmo arquivo deve seguir a regra definida (atualizar, ignorar ou recusar) sem duplicar registros: depois da segunda importação, `COUNT(*)` continua 1000. Duplicatas **dentro** do arquivo (mesmo e-mail em duas linhas, inclusive variando maiúsculas) devem ser apontadas na segunda ocorrência, com referência à primeira; o validador de referência faz isso (`EMAIL_DUPLICADO@9 (já usado na linha 2)`).

**6. Relacionamentos.**
Se uma coluna referencia outra entidade (cidade, categoria, cliente), o teste cria por API as entidades referenciadas antes do upload e inclui, de propósito, linhas com referência inexistente. Valida que as válidas foram vinculadas ao registro certo (id, não só nome) e que as órfãs foram rejeitadas com o motivo, sem criar a entidade relacionada por acidente. Também vale testar a ordem: linha que referencia algo definido mais abaixo no mesmo arquivo.

**Pirâmide.** As regras de linha (formato, e-mail, idade, duplicata, referência) devem ser cobertas principalmente em **teste unitário do parser/validador** e em **teste de API do endpoint de importação**, com arquivos pequenos e um caso por regra. O E2E fica com o fluxo do usuário (selecionar, enviar, ver o resumo e o relatório de erros) e com um arquivo grande que prova a reconciliação de ponta a ponta.

**No the-internet.** O site não processa linhas, então a reconciliação só é aplicável ao lado do arquivo. O que foi automatizado (CT-UP-01 e CT-UP-03): o CSV de 10, 100 e 1000 linhas é conferido antes do envio e, depois do envio, o corpo multipart capturado no `cy.intercept` é comparado com o gerado (mesma quantidade de linhas e conteúdo idêntico). Isso prova que **as 1000 linhas saíram do navegador íntegras, sem perda nem alteração de encoding** (corpo capturado no proxy do Cypress, a caminho do servidor), e que o servidor respondeu 200 exibindo o nome do arquivo. É o máximo verificável aqui: o site não devolve o conteúdo recebido. O "processadas corretamente" no servidor fica registrado como G01.

---

## 3.1.b) Como testar cenários de erro (arquivo corrompido, dados inválidos)

Separo os erros em três níveis, porque cada um exige uma resposta diferente do sistema:

| Nível     | Exemplos                                                                                                        | Comportamento esperado de um importador real                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Arquivo   | vazio, sem arquivo, binário/corrompido, encoding inválido, extensão ou MIME errados, acima do limite de tamanho | Recusa o arquivo inteiro antes de processar, com mensagem clara; nenhum registro gravado; sem erro 500                    |
| Estrutura | cabeçalho errado ou ausente, separador `;`, colunas a mais/menos, aspas não fechadas, linha em branco           | Recusa o arquivo (cabeçalho/separador) ou a linha (colunas, aspas), apontando linha e motivo                              |
| Dados     | e-mail inválido, idade não numérica, campo obrigatório vazio, duplicata, referência inexistente                 | Rejeita só a linha, importa as demais (ou recusa tudo, conforme a regra de negócio, que precisa estar definida) e reporta |

**1. Uma fixture por defeito, com o defeito provado.**
Cada arquivo inválido é pequeno, versionado e tem um único propósito. Antes de usá-lo para testar o sistema, o teste prova que ele contém o defeito que diz conter (o validador de referência devolve exatamente os erros esperados). Sem isso, um teste de erro pode passar porque a fixture estava "certa" por acidente. No projeto:

| Fixture                 | Defeito                                                     | Erros esperados (validador de referência)                                                                                                        |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vazio.csv`             | 0 bytes                                                     | `ARQUIVO_VAZIO`                                                                                                                                  |
| `formato-incorreto.csv` | separador `;` em vez de `,`                                 | `CABECALHO_INVALIDO@1` (arquivo inteiro recusado)                                                                                                |
| `malformado.csv`        | 8 defeitos, um por linha, nas linhas 3 a 10                 | colunas a menos/a mais, e-mail inválido, idade "trinta", nome vazio, linha em branco, e-mail duplicado (variando maiúsculas), aspas não fechadas |
| `corrompido.csv`        | início de CSV válido seguido de bytes binários (0x00, 0xFF) | `CODIFICACAO_INVALIDA`                                                                                                                           |

O `malformado.csv` tem uma linha válida (linha 2), o que permite validar a regra "rejeita a linha, importa as demais" e a reconciliação `1 aceita + 8 rejeitadas = 9 lidas`.

**2. Asserções de um cenário de erro.**
Para cada fixture, em um importador real, o teste verifica:

- **resposta**: status de erro de cliente (400/422), nunca 500. Um 500 em entrada inválida é defeito, mesmo que a tela "não quebre";
- **mensagem**: texto exibido ao usuário, com linha e motivo quando for erro de linha (por exemplo "Linha 5: e-mail inválido");
- **efeito colateral**: nada gravado quando o arquivo é recusado (`COUNT(*)` do lote = 0), ou só as linhas válidas quando a regra é parcial. É a asserção mais importante e a mais esquecida: um importador que mostra o erro **e** grava metade do arquivo está errado;
- **atomicidade**: em caso de falha no meio (arquivo truncado, erro na linha 600 de 1000), ou tudo é desfeito ou o resumo diz exatamente até onde foi. Nunca um estado parcial sem registro;
- **recuperação**: depois do erro, a tela aceita um novo arquivo válido sem recarregar (estado limpo).

**3. Arquivo corrompido: variações que valem um caso cada.**
Binário renomeado para `.csv` (como a fixture), arquivo truncado no meio de uma linha, encoding Latin-1 com acentos (deve ser recusado ou convertido, conforme a regra, mas nunca gravar "SÃ£o Paulo"), BOM UTF-8 (deve ser aceito, o validador já ignora o BOM), `\r\n` do Windows (deve ser aceito) e arquivo acima do limite de tamanho (erro de limite, sem estourar memória). Arquivos grandes inválidos são gerados no teste, não versionados.

**4. Erros que não dependem do arquivo.**
Com `cy.intercept`, a interface é testada contra respostas de erro controladas (500, timeout, 413 de payload grande), para garantir que a tela mostra uma mensagem útil e libera o botão de reenvio. Isso valida a **interface**, não a regra do backend, e complementa (não substitui) os testes com o backend real.

**5. Camadas.** Os casos de dados inválidos ficam majoritariamente no teste do parser/validador (rápidos, um por regra) e no teste de API do endpoint (`cy.request` com multipart). No E2E entram um arquivo recusado inteiro, um com rejeição parcial e o de erro de servidor, para provar que a interface reflete cada tipo de resposta.

**No the-internet (comportamento observado em 06/10/2026).**
Conferido com o upload real, pelo navegador e por requisição direta:

1. **Arquivo vazio é aceito**: 0 bytes responde 200, "File Uploaded!" e exibe `vazio.csv`. O enunciado menciona que o vazio poderia gerar Internal Server Error; isso **não** se confirmou. O 500 acontece em outro caso (item 3).
2. **Formato incorreto, malformado e corrompido são aceitos**: 200, "File Uploaded!" e o nome exibido. O site não lê o conteúdo (G01). O CT-UP-05 registra isso como comportamento observado e, no mesmo teste, prova com o validador de referência que cada arquivo deveria ter sido recusado, e com quais erros.
3. **Enviar o formulário sem selecionar arquivo gera HTTP 500** ("Internal Server Error"). Em um sistema real o esperado é uma mensagem de validação, sem erro no servidor; aqui isso é um defeito do site (D01), documentado no CT-UP-06. O teste afirma o 500 para caracterizar o comportamento atual: se o site for corrigido, o teste falha e sinaliza a mudança.
4. **Nome de arquivo com acento** é exibido com a codificação errada (ex.: "acentuação.csv" aparece com caracteres trocados). Por isso os nomes gerados são só ASCII; o conteúdo continua com acentos.
5. **Indisponibilidade intermitente**: o Heroku responde 503 de vez em quando. O Page Object (`falharSeIndisponivel`) transforma esse caso em falha `INCONCLUSIVO` (ambiente), tanto ao abrir a página quanto no POST `/upload`; qualquer outro status de erro continua falhando normalmente, para não ser confundido com defeito do site nem do teste. Com `retries: 0`, uma nova execução é a ação esperada.
6. **Primeiro acesso lento**: de forma intermitente, o primeiro carregamento da página na execução leva cerca de 30 s (os seguintes, cerca de 2 s). Medido por requisição, não há recurso específico travando: é latência do ambiente. Fica dentro do `pageLoadTimeout` padrão (60 s), sem espera fixa e sem simular nenhuma resposta do site.
