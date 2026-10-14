import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCopilotServer } from '../app.js';

const key = 'k'.repeat(32);
const jobId = 'a'.repeat(32);
const payload = { job_id: jobId, prompt: 'Evidências', systemMessage: 'Não invente.', purpose: 'summary' };

test('uses the configured model for tool-free summaries and evidence-backed web research', async () => {
  let config;
  let emitEvidence = true;
  let success = true;
  let source = 'https://pncp.gov.br/app/editais/12345678000199/2026/1';
  let listeners;
  let disconnected = 0;
  const server = createCopilotServer({
    apiKey: key, model: 'configured-model', extractorUrl: 'http://extractor', extractorApiKey: 'extractor-key',
    fetchImpl: async () => Response.json({ status: 'analisando_anexos' }),
    client: {
      getAuthStatus: async () => ({ isAuthenticated: true }),
      listModels: async () => [{ id: 'configured-model' }],
      createSession: async value => {
        config = value;
        listeners = {};
        return {
          on: (name, callback) => { listeners[name] = callback; },
          sendAndWait: async () => {
            if (emitEvidence && listeners['tool.execution_start']) {
              listeners['tool.execution_start']({ data: { toolCallId: 'web1', toolName: 'web_fetch', arguments: { url: source } } });
              listeners['tool.execution_complete']({ data: {
                toolCallId: 'web1', success, result: { content: 'Conteúdo recuperado sem repetir a URL' }
              } });
            }
            return { data: { content: 'Resultado' } };
          },
          abort: async () => {},
          disconnect: async () => { await new Promise(resolve => setTimeout(resolve, 10)); disconnected++; }
        };
      }
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-API-Key': key, 'Content-Type': 'application/json' };
  const complete = body => fetch(`${base}/complete`, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/complete`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await complete({ ...payload, purpose: 'unknown' })).status, 400);
    const summary = await complete(payload);
    assert.equal(summary.status, 200);
    assert.equal(disconnected, 1);
    assert.equal((await summary.json()).model, 'configured-model');
    assert.deepEqual(config.tools, []);
    assert.deepEqual(config.availableTools, []);
    assert.equal((await config.onPermissionRequest({ kind: 'shell' })).kind, 'reject');
    const research = { ...payload, purpose: 'research', scope: 'oficial' };
    assert.equal((await complete({ ...research, scope: 'unknown' })).status, 400);
    const result = await complete(research);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).evidence_urls, [source]);
    assert.deepEqual(config.availableTools, ['web_search', 'web_fetch']);
    for (const url of ['https://pncp.gov.br/path', 'https://comprasnet.gov.br/path']) {
      assert.equal((await config.onPermissionRequest({ kind: 'url', url })).kind, 'approve-once');
    }
    for (const url of ['http://pncp.gov.br', 'https://pncp.gov.br.evil.com', 'https://example.com', 'https://localhost']) {
      assert.equal((await config.onPermissionRequest({ kind: 'url', url })).kind, 'reject');
    }
    assert.equal((await config.onPermissionRequest({ kind: 'url', url: source, managedApprovalRequired: true })).kind, 'reject');
    emitEvidence = false;
    assert.equal((await complete(research)).status, 502);
    emitEvidence = true;
    success = false;
    assert.equal((await complete(research)).status, 502);
    success = true;
    source = 'https://unofficial.example.com';
    assert.equal((await complete(research)).status, 502);
    assert.equal((await complete({ ...research, scope: 'fabricante' })).status, 200);
    assert.equal((await config.onPermissionRequest({ kind: 'url', url: 'https://127.0.0.1' })).kind, 'reject');
    assert.equal((await config.onPermissionRequest({ kind: 'url', url: 'https://vendor.example.com/manual' })).kind, 'approve-once');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('allows nested research during analysis and cancellation aborts both sessions', async () => {
  const started = [];
  let aborts = 0;
  let disconnects = 0;
  const server = createCopilotServer({
    apiKey: key, model: 'configured-model', extractorUrl: 'http://extractor', extractorApiKey: 'key',
    fetchImpl: async (url, init) => Response.json(init.method === 'DELETE' ? { job_id: jobId, cancelled: true } : {}),
    client: {
      getAuthStatus: async () => ({ isAuthenticated: true }),
      listModels: async () => [{ id: 'configured-model' }],
      createSession: async () => ({
        on: () => {},
        sendAndWait: () => { started.push(true); return new Promise(() => {}); },
        abort: async () => { aborts++; },
        disconnect: async () => { disconnects++; }
      })
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-API-Key': key, 'Content-Type': 'application/json' };
  const post = (path, body = payload) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const analysis = post('/analyze');
    while (started.length < 1) await new Promise(resolve => setImmediate(resolve));
    const research = post('/complete', { ...payload, purpose: 'research', scope: 'oficial' });
    while (started.length < 2) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await post('/complete')).status, 429);
    const cancelled = await post(`/jobs/${jobId}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal((await analysis).status, 502);
    assert.equal((await research).status, 502);
    assert.equal(aborts, 2);
    assert.equal(disconnects, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('disconnecting an extractor request aborts and disconnects its SDK session', async () => {
  let ready;
  let cleaned;
  let aborted = false;
  const started = new Promise(resolve => { ready = resolve; });
  const finished = new Promise(resolve => { cleaned = resolve; });
  const server = createCopilotServer({
    apiKey: key, model: 'configured-model', extractorUrl: 'http://extractor', extractorApiKey: 'key',
    fetchImpl: async () => Response.json({}),
    client: {
      getAuthStatus: async () => ({ isAuthenticated: true }),
      listModels: async () => [{ id: 'configured-model' }],
      createSession: async () => ({
        sendAndWait: () => { ready(); return new Promise(() => {}); },
        abort: async () => { aborted = true; },
        disconnect: async () => { cleaned(); }
      })
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  try {
    const request = fetch(`http://127.0.0.1:${server.address().port}/complete`, {
      method: 'POST', headers: { 'X-API-Key': key }, body: JSON.stringify(payload), signal: controller.signal
    });
    const rejected = assert.rejects(request, { name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    await finished;
    assert.equal(aborted, true);
  } finally {
    controller.abort();
    await new Promise(resolve => server.close(resolve));
  }
});
