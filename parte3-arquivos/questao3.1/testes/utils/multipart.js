/**
 * Leitura do corpo multipart/form-data capturado por `cy.intercept`: função
 * pura, sem `cy`.
 *
 * O site não devolve o conteúdo recebido, só o nome do arquivo. Ler o corpo
 * da requisição é a forma de provar que o arquivo enviado pelo navegador é
 * exatamente o arquivo gerado (todas as linhas, com acentos).
 */

/** Boundary do header Content-Type: "multipart/form-data; boundary=...". */
function lerBoundary(contentType = '') {
  const encontrado = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!encontrado) {
    throw new Error(`Requisição sem boundary multipart: "${contentType}"`);
  }
  return encontrado[1] ?? encontrado[2].trim();
}

/**
 * Primeiro arquivo do corpo multipart: `{ campo, nomeArquivo, tipo, conteudo }`.
 * O corpo chega como texto (o Cypress o decodifica em UTF-8), então
 * `conteudo` só é fiel para arquivos de texto; bytes inválidos em UTF-8
 * (arquivo corrompido) chegam substituídos.
 */
export function lerArquivoEnviado(corpo, contentType) {
  if (typeof corpo !== 'string') {
    throw new Error(`Corpo multipart em formato inesperado: ${typeof corpo}`);
  }

  const delimitador = `--${lerBoundary(contentType)}`;
  const parte = corpo.split(delimitador).find((trecho) => /filename="/.test(trecho));
  if (!parte) {
    throw new Error('Nenhum arquivo encontrado no corpo multipart');
  }

  const fimDosHeaders = parte.indexOf('\r\n\r\n');
  const headers = parte.slice(0, fimDosHeaders);
  // A parte termina com o "\r\n" que antecede o próximo delimitador.
  const conteudo = parte.slice(fimDosHeaders + 4).replace(/\r\n$/, '');

  return {
    campo: /name="([^"]*)"/.exec(headers)?.[1] ?? null,
    nomeArquivo: /filename="([^"]*)"/.exec(headers)?.[1] ?? null,
    tipo: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1].trim() ?? null,
    conteudo,
  };
}
