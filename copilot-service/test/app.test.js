import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCopilotServer, createExtractorTools } from '../app.js';

const apiKey = 'a'.repeat(32);
const payload = { job_id: 'job1', prompt: 'Dossiê para análise', systemMessage: 'Analise somente as evidências.' };

test('preserves extractor research and document tools with constrained endpoints', async () => {
  const calls = [];
  const tools = createExtractorTools({
    baseUrl: 'http://extractor:8080', apiKey: 'extractor-key', jobId: 'job1',
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      return { ok: true, json: async () => ({ evidencia: 'teste' }) };
    }
  });
  await tools[0].handler({ consulta: 'situação da sessão' });
  await tools[1].handler({ consulta: 'manual do fabricante' });
  await tools[2].handler({ documento_id: 'doc1', inicio: 24 });
  assert.equal(JSON.parse(calls[0].options.body).escopo, 'oficial');
  assert.equal(JSON.parse(calls[1].options.body).escopo, 'fabricante');
  assert.equal(calls[2].url, 'http://extractor:8080/jobs/job1/documentos/doc1?inicio=24&tamanho=24000');
  assert.equal(calls[2].options.headers['X-API-Key'], 'extractor-key');
  assert.equal(calls[2].options.redirect, 'error');
  await assert.rejects(tools[2].handler({ documento_id: '../other', inicio: 0 }), /inválido/);
  await assert.rejects(tools[2].handler({ documento_id: 'doc1', inicio: -1 }), /inválido/);
  await assert.rejects(tools[0].handler({ consulta: '' }), /inválida/);
  const failedTools = createExtractorTools({
    baseUrl: 'http://extractor:8080', apiKey: 'key', jobId: 'job1',
    fetchImpl: async () => ({ ok: false, status: 503 })
  });
  await assert.rejects(failedTools[0].handler({ consulta: 'teste' }), /HTTP 503/);
});

test('authenticates requests, disables built-in tools and returns real nonempty output', async () => {
  let config;
  let response = { data: { content: 'Relatório confirmado' } };
  let disconnected = 0;
  let aborted = 0;
  const client = {
    getAuthStatus: async () => ({ isAuthenticated: true }),
    listModels: async () => [{ id: 'gpt-5.4' }],
    createSession: async value => {
      config = value;
      return {
        sendAndWait: async () => response,
        disconnect: async () => { disconnected++; },
        abort: async () => { aborted++; }
      };
    }
  };
  const server = createCopilotServer({
    client, apiKey, model: 'gpt-5.4', extractorUrl: 'http://extractor:8080', extractorApiKey: 'key'
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(`${url}/health`)).status, 401);
    assert.equal((await fetch(`${url}/health`, { headers })).status, 200);
    assert.equal((await fetch(`${url}/analyze`, { method: 'POST', headers, body: '{}' })).status, 400);
    const result = await fetch(`${url}/analyze`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).output, 'Relatório confirmado');
    assert.equal(config.model, 'gpt-5.4');
    assert.equal(config.systemMessage.content, payload.systemMessage);
    assert.deepEqual(config.availableTools, ['pesquisar_fontes_oficiais', 'pesquisar_fabricantes', 'ler_documento']);
    assert.equal((await config.onPermissionRequest({ kind: 'shell' })).kind, 'reject');
    assert.equal((await config.onPermissionRequest({ kind: 'custom-tool', toolName: 'ler_documento' })).kind, 'approve-once');
    assert.equal((await config.onPermissionRequest({ kind: 'custom-tool', toolName: 'outro' })).kind, 'reject');
    assert.equal((await config.onPermissionRequest({ kind: 'custom-tool', toolName: 'ler_documento', managedApprovalRequired: true })).kind, 'reject');
    assert.equal(disconnected, 1);
    response = { data: { content: ' ' } };
    const empty = await fetch(`${url}/analyze`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(empty.status, 502);
    assert.match((await empty.json()).error, /relatório vazio/);
    assert.equal(disconnected, 2);
    assert.equal(aborted, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('rejects concurrent analyses and releases the slot after SDK failure', async () => {
  let release;
  let disconnected = 0;
  let authenticated = true;
  const client = {
    getAuthStatus: async () => ({ isAuthenticated: authenticated }),
    listModels: async () => [{ id: 'gpt-5.4' }],
    createSession: async () => ({
      sendAndWait: () => new Promise((resolve, reject) => { release = reject; }),
      abort: async () => {},
      disconnect: async () => { disconnected++; }
    })
  };
  const server = createCopilotServer({
    client, apiKey, model: 'gpt-5.4', extractorUrl: 'http://extractor:8080', extractorApiKey: 'key'
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };
  try {
    const first = fetch(`${url}/analyze`, { method: 'POST', headers, body: JSON.stringify(payload) });
    while (!release) await new Promise(resolve => setImmediate(resolve));
    const second = await fetch(`${url}/analyze`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(second.status, 429);
    release(new Error('Timeout do SDK'));
    assert.equal((await first).status, 502);
    assert.equal(disconnected, 1);
    authenticated = false;
    assert.equal((await fetch(`${url}/health`, { headers })).status, 503);
    const unauthenticated = await fetch(`${url}/analyze`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(unauthenticated.status, 502);
    assert.match((await unauthenticated.json()).error, /não autenticado/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
