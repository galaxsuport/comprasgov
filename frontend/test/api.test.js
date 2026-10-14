import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 }
});
const api = await import(`data:text/javascript;base64,${Buffer.from(`${outputText}\n//# sourceURL=frontend-api-under-test.js`).toString('base64')}`);

test('shows actionable 502 errors and preserves upstream diagnostic messages', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>Bad Gateway</html>', { status: 502 });
    await assert.rejects(api.fetchAnalyses(), /HTTP 502.*API.*n8n/);
    await assert.rejects(api.fetchResultados({ uasg: '985825' }), error =>
      error instanceof api.WebhookPopupError && /HTTP 502.*API.*n8n/.test(error.message));
    globalThis.fetch = async () => Response.json({ message: 'Task execution timed out after 60 seconds' }, { status: 502 });
    await assert.rejects(api.fetchResultados(), /Task execution timed out after 60 seconds/);
    globalThis.fetch = async () => Response.json({ error: 'O serviço de análise n8n respondeu HTTP 503.' }, { status: 502 });
    await assert.rejects(api.startAnalysis({}), /análise n8n respondeu HTTP 503/);
    globalThis.fetch = async () => new Response('not json', { status: 200 });
    await assert.rejects(api.fetchResultados(), /resposta inválida/);
    for (const body of [null, {}, { data: [null] }]) {
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(api.fetchResultados(), /inválid/);
    }
    globalThis.fetch = async () => new Response('', { status: 200 });
    await assert.rejects(api.fetchResultados(), /resposta inválida/);
    globalThis.fetch = async () => Response.json([]);
    assert.deepEqual(await api.fetchResultados(), { resultados: [], aviso: null });
    globalThis.fetch = async () => Response.json([{ registros: [], popupErro: { exibir: true, titulo: 'Alerta', mensagem: 'Consulta parcial' } }]);
    assert.deepEqual(await api.fetchResultados(), {
      resultados: [], aviso: { title: 'Alerta', message: 'Consulta parcial', sample: null }
    });
    globalThis.fetch = async () => Response.json({ registros: [], erro: 'LIMITE_REQUISICOES_EXCEDIDO' });
    await assert.rejects(api.fetchResultados(), /LIMITE_REQUISICOES_EXCEDIDO/);
    globalThis.fetch = async () => Response.json({
      registros: [{ tipoSaida: 'oportunidade', objeto: 'Servidor' }],
      erro: 'LIMITE_REQUISICOES_EXCEDIDO',
      popupErro: { exibir: true, titulo: 'Limite de requisições', mensagem: 'Consulta parcial' }
    });
    const partial = await api.fetchResultados();
    assert.equal(partial.resultados.length, 1);
    assert.match(partial.aviso.message, /resultados recebidos.*continuam disponíveis/);
  } finally {
    globalThis.fetch = original;
  }
});

test('cancellation stays distinguishable from a timeout and analysis parameters use existing purchase links', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(api.fetchResultados({}, controller.signal), error => error.name === 'AbortError');
    await assert.rejects(api.fetchResultados(), /Tempo limite excedido/);
    assert.deepEqual(api.getAnalysisParams({ cadastroProposta: 'https://compras.gov.br?compra=98582505003262027' }),
      { uasg: '985825', numeroCompra: '326/2027' });
    assert.equal(api.getAnalysisParams({ uasg: 'bad', numeroCompra: '326/2027' }), null);
  } finally {
    globalThis.fetch = original;
  }
});
