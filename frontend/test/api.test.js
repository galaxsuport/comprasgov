import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 }
});
const api = await import(`data:text/javascript;base64,${Buffer.from(`${outputText}\n//# sourceURL=frontend-api-under-test.js`).toString('base64')}`);

test('forwards purchase number with UASG or region search filters', async () => {
  const original = globalThis.fetch;
  let requestedUrl;
  try {
    globalThis.fetch = async url => {
      requestedUrl = new URL(url, 'http://localhost');
      return Response.json([]);
    };
    await api.fetchResultados({ uasg: '985825', numeroCompra: '123/2026' });
    assert.equal(requestedUrl.searchParams.get('uasg'), '985825');
    assert.equal(requestedUrl.searchParams.get('numeroCompra'), '123/2026');
    assert.equal(requestedUrl.searchParams.has('ufs'), false);

    await api.fetchResultados({ ufs: 'SP,RJ', numeroCompra: '456' });
    assert.equal(requestedUrl.searchParams.get('ufs'), 'SP,RJ');
    assert.equal(requestedUrl.searchParams.get('numeroCompra'), '456');

    await api.fetchResultados({ numeroCompra: '789/2026' });
    assert.equal(requestedUrl.searchParams.get('numeroCompra'), '789/2026');

    await api.fetchResultados({ uasg: '153162', numeroCompra: '592026' });
    assert.equal(requestedUrl.searchParams.get('numeroCompra'), '59/2026');

    await api.fetchResultados({ numeroCompra: ' 59 / 2026 ' });
    assert.equal(requestedUrl.searchParams.get('numeroCompra'), '59/2026');
  } finally {
    globalThis.fetch = original;
  }
});

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

test('cancellation stays distinguishable from a timeout and analysis parameters use the PNCP contract ID', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(api.fetchResultados({}, controller.signal), error => error.name === 'AbortError');
    await assert.rejects(api.fetchResultados(), /Tempo limite excedido/);
    assert.deepEqual(api.getAnalysisParams({ idContratacaoPNCP: '40176679000199-1-000042/2026' }),
      { idContratacaoPNCP: '40176679000199-1-000042/2026' });
    assert.deepEqual(api.getAnalysisParams({
      linkContratacao: 'https://pncp.gov.br/app/editais/40176679000199/2026/42'
    }), { idContratacaoPNCP: '40176679000199-1-42/2026' });
    assert.equal(api.getProposalKey({
      idContratacaoPNCP: 'invalid',
      linkContratacao: 'https://pncp.gov.br/app/editais/40176679000199/2026/42'
    }), 'id:40176679000199-1-42/2026');
    assert.equal(api.getAnalysisParams({ uasg: '928552', numeroCompra: '1/2026' }), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('status refresh forwards PNCP identifiers and abort signal and rejects invalid responses', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  const proposal = { idContratacaoPNCP: '12345678000199-1-31/2026', linkContratacao: 'https://pncp.gov.br/app/editais/12345678000199/2026/31' };
  try {
    globalThis.fetch = async (url, init) => {
      const target = new URL(url, 'http://localhost');
      assert.equal(target.pathname, '/api/proposals/status');
      assert.equal(target.searchParams.get('id'), proposal.idContratacaoPNCP);
      assert.equal(target.searchParams.get('link'), proposal.linkContratacao);
      assert.equal(init.signal, controller.signal);
      return Response.json({
        situacao: 'Suspensa',
        tipoInstrumentoConvocatorio: 'Aviso de Contratação Direta',
        numeroCompra: '45/2026'
      });
    };
    assert.deepEqual(await api.fetchProposalStatus(proposal, controller.signal), {
      situacao: 'Suspensa',
      tipoInstrumentoConvocatorio: 'Aviso de Contratação Direta',
      numeroCompra: '45/2026'
    });
    globalThis.fetch = async () => Response.json({ error: 'PNCP indisponível' }, { status: 502 });
    await assert.rejects(api.fetchProposalStatus(proposal), /PNCP indisponível/);
    for (const body of [{}, { situacao: null }, { situacao: ' ' }]) {
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(api.fetchProposalStatus(proposal), /Resposta inválida/);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('normalizes the PNCP instrument type and purchase number', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json([{
      tipoSaida: 'oportunidade',
      numeroCompra: '45',
      anoCompra: 2026,
      tipoInstrumentoConvocatorioNome: 'Edital'
    }]);
    const { resultados } = await api.fetchResultados();
    assert.equal(resultados[0].tipoInstrumentoConvocatorio, 'Edital');
    assert.equal(resultados[0].numeroCompra, '45/2026');

    globalThis.fetch = async () => Response.json([{
      tipoSaida: 'oportunidade',
      numeroCompra: '46',
      anoCompra: 2026,
      tipoInstrumentoConvocatorio: 2
    }]);
    const [directPurchaseNotice] = (await api.fetchResultados()).resultados;
    assert.equal(directPurchaseNotice.tipoInstrumentoConvocatorio, 'Aviso de Contratação Direta');
    assert.equal(directPurchaseNotice.numeroCompra, '46/2026');

    globalThis.fetch = async () => Response.json([{
      tipoSaida: 'oportunidade',
      tipoInstrumentoConvocatorioCodigo: 1,
      numeroCompra: '47/2026'
    }]);
    const [noticeFromCode] = (await api.fetchResultados()).resultados;
    assert.equal(noticeFromCode.tipoInstrumentoConvocatorio, 'Edital');

    globalThis.fetch = async () => Response.json([{
      tipoSaida: 'oportunidade',
      tipoInstrumentoConvocatorio: '2',
      numeroCompra: '48/2026'
    }]);
    const [otherType] = (await api.fetchResultados()).resultados;
    assert.equal(otherType.tipoInstrumentoConvocatorio, 'Aviso de Contratação Direta');
  } finally {
    globalThis.fetch = original;
  }
});

test('search workflow preserves the instrument type through to the frontend', async () => {
  const workflow = JSON.parse(readFileSync(
    new URL('../../workflows/PNCP - Pesquisa.json', import.meta.url), 'utf8'
  ));
  const code = workflow.nodes.find(node => node.name === 'Preparar resultado').parameters.jsCode;
  const prepare = new Function('$json', '$', code);
  const original = globalThis.fetch;
  try {
    for (const fields of [
      { tipoInstrumentoConvocatorioNome: 'Aviso de Contratação Direta' },
      { tipoInstrumentoConvocatorio: 2 },
      { tipoInstrumentoConvocatorioCodigo: 2 },
      { tipoInstrumentoConvocatorioId: 2 }
    ]) {
      const output = prepare({
        oportunidades: [{ numeroCompra: '400', anoCompra: 2026, ...fields }]
      }, () => ({ first: () => ({ json: { config: { iniciadoEmMs: Date.now() } } }) }));
      globalThis.fetch = async () => Response.json(output.map(item => item.json));
      const [result] = (await api.fetchResultados()).resultados;
      assert.equal(result.tipoInstrumentoConvocatorio, 'Aviso de Contratação Direta');
      assert.equal(result.numeroCompra, '400/2026');
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('normalizes all official PNCP instrument types and preserves supplied names', async () => {
  const original = globalThis.fetch;
  const types = [
    [1, 'Edital'],
    [2, 'Aviso de Contratação Direta'],
    [3, 'Ato que autoriza a Contratação Direta'],
    [4, 'Edital de Chamamento Público'],
    [5, 'Não se Aplica']
  ];
  try {
    for (const [id, nome] of types) {
      for (const fields of [
        { tipoInstrumentoConvocatorio: id },
        { tipoInstrumentoConvocatorio: String(id) },
        { tipoInstrumentoConvocatorioCodigo: id },
        { tipoInstrumentoConvocatorioId: id },
        { tipoInstrumentoConvocatorio: { id } }
      ]) {
        globalThis.fetch = async () => Response.json([{
          tipoSaida: 'oportunidade', numeroCompra: '400/2026', ...fields
        }]);
        const [result] = (await api.fetchResultados()).resultados;
        assert.equal(result.tipoInstrumentoConvocatorio, nome);
      }
    }
    globalThis.fetch = async () => Response.json([{
      tipoSaida: 'oportunidade',
      tipoInstrumentoConvocatorioCodigo: 99,
      tipoInstrumentoConvocatorioNome: 'Novo tipo informado pelo PNCP'
    }]);
    const [named] = (await api.fetchResultados()).resultados;
    assert.equal(named.tipoInstrumentoConvocatorio, 'Novo tipo informado pelo PNCP');
  } finally {
    globalThis.fetch = original;
  }
});

test('status requests are serialized, stop during Retry-After and recover after cooldown', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active--;
    return calls === 1
      ? Response.json({ error: 'PNCP respondeu HTTP 429. Tente novamente em aproximadamente 7 s.' },
        { status: 429, headers: { 'Retry-After': '7' } })
      : Response.json({ situacao: 'Suspensa' });
  });
  const requests = Array.from({ length: 14 }, (_, index) =>
    api.fetchProposalStatus({ idContratacaoPNCP: `12345678000199-1-${index + 1}/2026` }));
  const results = await Promise.allSettled(requests);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /PNCP respondeu HTTP 429/);
  }
  assert.equal(calls, 1);
  now += 6999;
  await assert.rejects(api.fetchProposalStatus({ idContratacaoPNCP: 'next' }), /HTTP 429/);
  assert.equal(calls, 1);
  now += 1;
  const recovered = await Promise.all(Array.from({ length: 3 }, (_, index) =>
    api.fetchProposalStatus({ idContratacaoPNCP: `recovered-${index}` })));
  assert.equal(calls, 4);
  assert.equal(maxActive, 1);
  assert.ok(recovered.every(details => details.situacao === 'Suspensa'));
});

test('aborted status requests leave the queue without calling the API or blocking later requests', async t => {
  let completeFirst;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) await new Promise(resolve => { completeFirst = resolve; });
    return Response.json({ situacao: 'Divulgada' });
  });
  const first = api.fetchProposalStatus({ idContratacaoPNCP: 'first' });
  const controller = new AbortController();
  const cancelled = api.fetchProposalStatus({ idContratacaoPNCP: 'cancelled' }, controller.signal);
  const last = api.fetchProposalStatus({ idContratacaoPNCP: 'last' });
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  await Promise.resolve();
  controller.abort();
  completeFirst();
  await Promise.all([first, rejected, last]);
  assert.equal(calls, 2);
});
