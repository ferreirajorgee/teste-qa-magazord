# Questão 4.1 - Automação Mobile

Questão teórica: não há implementação, configuração de ambiente nem casos automatizados nesta parte. Comandos citados são **ilustrativos**.

## Premissa: o enunciado não informa a tecnologia do app

O app é iOS e Android, com geolocalização, câmera, push, storage offline e sincronização, mas não se sabe se é nativo, React Native ou Flutter. Isso muda a escolha de ferramenta, então as respostas indicam o que depende da stack.

| Elemento do contexto | Por que é difícil de automatizar                                                  | Onde é tratado |
| -------------------- | --------------------------------------------------------------------------------- | -------------- |
| Geolocalização       | Depende de GPS, permissão do sistema e movimento real                             | 4.1.b          |
| Câmera               | Simulador iOS não tem câmera; a do emulador Android é uma cena virtual            | 4.1.b          |
| Notificações push    | Entrega depende de APNs/FCM, permissão e estado do app (aberto, fundo, encerrado) | 4.1.b          |
| Offline e sync       | Estado persistido no aparelho; depende de rede, tempo e backend; gera conflitos   | 4.1.e          |
| iOS e Android        | Dois sistemas, dois diálogos de permissão, dois toolchains de build e de CI       | 4.1.c, 4.1.d   |

O princípio é o mesmo das Partes 1 a 3: **separar a regra de decisão do recurso externo**. A regra (quando sincronizar, como resolver conflito) é testada barata e deterministicamente; o recurso real (GPS, câmera, APNs, rede) entra em poucos testes, nas camadas mais altas.

---

## 4.1.a) Que ferramenta escolher e por quê

**Minha escolha: Appium com WebdriverIO (JavaScript) como E2E principal, com testes nativos (Espresso, XCUITest) ou Detox nas camadas mais baixas, conforme a stack.**

| Critério                           | Appium (WebdriverIO)                                           | Detox                                                   | Maestro                                        |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| Stack do app                       | Qualquer, por drivers (`XCUITest`, `UiAutomator2`, `Espresso`) | React Native                                            | Qualquer                                       |
| Modelo e estabilidade              | Caixa-preta; exige espera por estado bem feita                 | Caixa-cinza: sincroniza com o app ocioso, menos flaky   | Caixa-preta em YAML, esperas embutidas         |
| Localização, permissões, deep link | Comandos do driver e `simctl`/`adb`                            | Nativo da API (`setLocation`, `permissions`, `openURL`) | Nativo (`setLocation`, permissões, `openLink`) |
| Dispositivo real e device farm     | Melhor suporte, inclusive injeção de imagem na câmera          | Focado em simulador e emulador                          | Android real; iOS real com suporte restrito    |
| Linguagem                          | JS/TS, com o mesmo padrão deste projeto                        | JS/TS                                                   | YAML; limitado para lógica e massa de dados    |

**1. Stack não informada.** Só o Appium serve para qualquer stack; escolher Detox sem saber se o app é React Native seria uma aposta.

**2. Câmera e push exigem dispositivo real em algum momento**, e as device farms são construídas sobre Appium. Outra ferramenta obrigaria manter uma segunda suíte para aparelho real.

**3. Mesma base do projeto.** Page Objects, massa com faker e seed, lint proibindo espera fixa (`driver.pause` no papel do `cy.wait`) e `retries: 0`. A instabilidade maior do Appium é tratada com accessibility id, espera por estado, animações desligadas no build de teste e estado preparado por API ou deep link.

**Quando eu mudaria:** app em React Native testado só em simulador/emulador no curto prazo, Detox como E2E principal; time com pouca experiência em código, Maestro para o smoke.

**Pirâmide.** Unitário para o motor de sync, a fila offline e as regras sobre localização; integração no app para persistência local e cliente HTTP contra mock server; instrumentado nativo para telas e permissão negada; E2E Appium só para fluxos críticos; device farm para câmera, push e GPS reais, em poucos cenários agendados; exploratório para UX de permissões e rede real instável.

---

## 4.1.b) Como mockar geolocalização, câmera e notificações push

Cada recurso tem duas perguntas: o app reage certo ao que o recurso entrega (testado com o recurso simulado) e o app consegue obter o recurso de verdade (poucos testes em dispositivo real). Para a primeira, o app acessa os três recursos por **interfaces próprias** (`LocationProvider`, `CameraService`, `PushHandler`) com implementação de teste: é um requisito de testabilidade combinado com o desenvolvimento.

**1. Geolocalização.** Permissão concedida antes do teste (`xcrun simctl privacy <device> grant location <bundleId>`; `adb shell pm grant <pacote> android.permission.ACCESS_FINE_LOCATION`) e posição simulada no sistema, não no app: `xcrun simctl location <device> set <lat>,<long>` (aceita rota, para simular movimento), `adb emu geo fix <longitude> <latitude>` (longitude primeiro) ou `driver.setGeoLocation` do Appium. Casos: dentro e fora da área de interesse, mudança de posição com o app aberto, permissão negada ou "aproximada" e GPS sem resposta. Cálculos sobre a posição (distância, área, frete por região) ficam em teste unitário com coordenadas de borda.

**2. Câmera.** Três níveis:

| Nível                          | Como funciona                                                                               | O que prova                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Câmera falsa no build de teste | O `CameraService` de teste devolve uma imagem de fixture escolhida pelo teste               | Fluxo após a captura: recorte, compressão, upload |
| Galeria preparada              | Imagens incluídas antes do teste (`xcrun simctl addmedia`; `adb push` + varredura de mídia) | Seleção pela galeria e permissão de fotos         |
| Device farm                    | Injeção de imagem na câmera de dispositivo real                                             | Câmera, permissão e SDK reais                     |

As fixtures têm propósito único, como as da Parte 3 (válida, grande demais, formato não suportado, código ilegível), e permissão negada é caso obrigatório.

**3. Push.** Três partes, testadas separadamente: o **backend** gera o payload certo, com APNs e FCM substituídos por mock server (Parte 5); o **app** trata o payload, via `xcrun simctl push <device> <bundleId> payload.apns` no iOS e envio pelo FCM ao emulador com Google Play Services (ou receptor de teste acionado por `adb shell am broadcast`) no Android; a **entrega real** fica em poucos cenários em dispositivo real. No app, para cada estado (aberto, fundo, encerrado), valido conteúdo exibido, toque abrindo a tela certa (deep link testado também isolado, por `simctl openurl` ou `adb shell am start -d`), payload incompleto sem derrubar o app e permissão negada (`POST_NOTIFICATIONS` no Android 13+).

---

## 4.1.c) Como rodar os mesmos testes em iOS e Android com mínima duplicação

**1. Um spec, a plataforma como parâmetro.** O mesmo teste roda nas duas; muda só a configuração do WebdriverIO (capabilities escolhidas por variável `PLATAFORMA`). Nenhum `if (ios)` dentro do cenário.

**2. Accessibility id como contrato de testabilidade.** O desenvolvimento define o mesmo identificador nas duas plataformas (`accessibilityIdentifier`, `resource-id`/`testTag`, ou `testID` no React Native), e o seletor `~botao-sincronizar` serve para ambas. É o equivalente mobile do `data-test` da Parte 2. XPath fica proibido por convenção.

**3. Screen Objects compartilhados**, com subclasse por plataforma só para telas realmente diferentes, escolhida por uma fábrica. Os specs conhecem apenas a classe base.

**4. Adaptador de dispositivo** com a mesma interface nas duas plataformas:

| Ação                 | iOS (simulador)        | Android (emulador)                     |
| -------------------- | ---------------------- | -------------------------------------- |
| `concederPermissao`  | `simctl privacy grant` | `adb shell pm grant`                   |
| `definirLocalizacao` | `simctl location set`  | `adb emu geo fix`                      |
| `enviarPush`         | `simctl push`          | FCM / receptor de teste                |
| `abrirDeepLink`      | `simctl openurl`       | `adb shell am start -d`                |
| `definirRede`        | Toxiproxy (4.1.e)      | `adb` (modo avião, Wi-Fi) ou Toxiproxy |

Os diálogos de permissão do sistema também ficam nele. Massa, payloads de push e respostas do mock são únicos para as duas plataformas, e o que só existe em uma vira tag (`@ios`, `@android`), como o `@smoke` deste projeto.

---

## 4.1.d) Setup de ambiente local e em CI/CD

**1. Local.** Node fixado, JDK, Android SDK com imagem Google APIs (para FCM) e, para iOS, macOS com Xcode. Appium com versão fixa no `package.json` e drivers instalados por comando (`appium driver install xcuitest`, `appium driver install uiautomator2`, verificados com `appium driver doctor`). AVD e simulador criados por script com modelo e versão definidos. Build de teste do app (flavor Android e `xcodebuild -sdk iphonesimulator`) apontando para o mock server, com câmera e push de teste e animações desligadas. Mock server (WireMock) por `docker compose`; o emulador acessa o host por `10.0.2.2`. Configuração por variável de ambiente, como os `CYPRESS_*` daqui.

**2. CI/CD.**

| Etapa                    | Onde                                              | Quando                |
| ------------------------ | ------------------------------------------------- | --------------------- |
| Unitário e integração    | Linux (Android) e macOS (iOS)                     | Todo PR               |
| Build de teste           | Idem; APK e `.app` viram artefatos reaproveitados | Todo PR               |
| E2E `@smoke`             | Emulador em Linux com KVM; simulador em macOS     | Todo PR               |
| E2E completo, com shards | Mesmos runners                                    | Merge e noturno       |
| Dispositivos reais       | Device farm, matriz pequena de aparelhos          | Noturno e pré-release |

**3. Na prática:** runners macOS são caros, por isso o iOS no PR roda só o smoke; cache de Gradle, Pods, `node_modules` e snapshot do AVD; dispositivo limpo a cada job, porque storage offline que vaza entre testes é a maior causa de falha intermitente; screenshot, vídeo, logs do dispositivo e do Appium e journal do mock no relatório; `retries: 0` com quarentena para teste instável; segredos de device farm e de FCM/APNs só no CI.

---

## 4.1.e) Como validar sincronização e offline sem backend real

O risco central é o da Parte 3: **perda silenciosa**. A tela diz "salvo" e o dado nunca chega, chega duas vezes ou sobrescreve uma alteração mais nova.

**1. Mock server com estado.** WireMock com scenarios (5.1.b) faz o papel do backend, responde conforme o estado e registra cada requisição. O teste verifica **o que o servidor recebeu**, não só a tela: é a reconciliação da Parte 3.

**2. Rede cortada fora do app.** Toxiproxy entre o app e o mock corta a conexão, adiciona latência ou derruba no meio da resposta, nas duas plataformas. É o mecanismo principal no iOS, porque o simulador não tem modo avião próprio. No Android também valem `adb shell cmd connectivity airplane-mode enable` e `adb shell svc wifi disable`.

**3. Cenários.**

| Cenário                                   | O que validar                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Criar e editar offline                    | Dado salvo e marcado como pendente; nenhuma requisição no journal                                |
| Voltar a ficar online                     | Fila enviada em ordem, journal com exatamente as operações esperadas, pendências zeradas         |
| Encerrar o app com fila pendente          | Fila persistida após reabrir e enviada                                                           |
| Queda no meio da sync ou resposta perdida | Nada já confirmado é reenviado; reenvio com a mesma chave de idempotência gera uma única criação |
| Conflito (alterado no servidor e no app)  | Aplica a regra definida pelo PO e avisa o usuário quando necessário                              |
| 500, 429 e 401 durante a sync             | Backoff sem perder a fila; respeita `Retry-After` (Parte 1.1); renova sessão uma vez             |
| Alteração e exclusão feitas no servidor   | Refletidas no app após a sync                                                                    |

**4. A lógica vem antes do dispositivo.** Fila, ordenação, idempotência, backoff e conflitos são testados em unitário com rede falsa e relógio controlado (`criarRelogioControlado`, da Parte 1.1). No E2E ficam os cenários que provam storage real, rede do sistema e interface, sempre esperando por estado (pendências zeradas, journal com N requisições), nunca por tempo fixo.

---

### Pontos não informados no enunciado

1. **Stack do app**: define se Detox é opção e qual framework nativo cobre a camada intermediária.
2. **Regra de conflito na sincronização**: sem ela, o cenário de conflito não tem resultado esperado.
3. **Uso da câmera** (foto livre, documento, código de barras): define fixtures e validações de imagem.
4. **Matriz de dispositivos e versões de SO**: define a device farm e o custo da execução noturna.
