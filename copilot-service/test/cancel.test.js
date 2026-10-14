import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCopilotServer } from '../app.js';

test('deletes extractor data, aborts the active SDK session and rejects late restarts', async () => {
  const jobId = 'a'.repeat(32);
  const key = 'k'.repeat(32);
  let exists = true;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let aborts = 0;
  let disconnects = 0;
  const client = {
    getAuthStatus: async () => ({ isAuthenticated: true }),
    listModels: async () => [{ id: 'gpt-5.4' }],
    createSession: async () => ({
      sendAndWait: () => { started(); return new Promise(() => {}); },
      abort: async () => { aborts++; },
      disconnect: async () => { disconnects++; }
    })
  };
  const calls = [];
  const server = createCopilotServer({
    client, apiKey: key, model: 'gpt-5.4', extractorUrl: 'http://extractor', extractorApiKey: 'extractor-key',
    fetchImpl: async (url, init) => {
      calls.push(init.method);
      assert.equal(url.pathname, `/jobs/${jobId}`);
      assert.equal(init.headers['X-API-Key'], 'extractor-key');
      if (init.method === 'DELETE') {
        exists = false;
        return Response.json({ job_id: jobId, cancelled: true });
      }
      return exists ? Response.json({ status: 'pronto_para_agente' }) : Response.json({}, { status: 404 });
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-API-Key': key, 'Content-Type': 'application/json' };
  const analyze = () => fetch(`${base}/analyze`, {
    method: 'POST', headers, body: JSON.stringify({ job_id: jobId, prompt: 'fixture', systemMessage: 'fixture' })
  });
  try {
    const analysis = analyze();
    await ready;
    assert.equal((await fetch(`${base}/jobs/${jobId}/cancel`, { method: 'POST' })).status, 401);
    const cancelled = await fetch(`${base}/jobs/${jobId}/cancel`, { method: 'POST', headers });
    assert.deepEqual(await cancelled.json(), { job_id: jobId, cancelled: true });
    assert.equal((await analysis).status, 502);
    assert.ok(aborts >= 1);
    assert.equal(disconnects, 1);
    assert.deepEqual(calls, ['GET', 'DELETE']);
    assert.equal((await analyze()).status, 502);
    assert.equal(disconnects, 1);
    assert.equal((await fetch(`${base}/jobs/${jobId}/cancel`, { method: 'POST', headers })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('does not acknowledge cancellation if the extractor fails', async () => {
  const server = createCopilotServer({
    client: {}, apiKey: 'k'.repeat(32), model: 'gpt-5.4', extractorUrl: 'http://extractor', extractorApiKey: 'key',
    fetchImpl: async () => Response.json({}, { status: 503 })
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/jobs/${'a'.repeat(32)}/cancel`, {
      method: 'POST', headers: { 'X-API-Key': 'k'.repeat(32) }
    });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /HTTP 503/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('cancellation during session creation never sends the prompt', async () => {
    const jobId = 'b'.repeat(32);
    let creating;
    let created;
    let deleted;
    const ready = new Promise(resolve => { creating = resolve; });
    const deletion = new Promise(resolve => { deleted = resolve; });
    const session = { sendAndWait: () => assert.fail('A cancelled session must not send a prompt'), abort: async () => {}, disconnect: async () => {} };
    const server = createCopilotServer({
      client: {
        getAuthStatus: async () => ({ isAuthenticated: true }),
        listModels: async () => [{ id: 'gpt-5.4' }],
        createSession: () => { creating(); return new Promise(resolve => { created = () => resolve(session); }); }
      },
      apiKey: 'k'.repeat(32), model: 'gpt-5.4', extractorUrl: 'http://extractor', extractorApiKey: 'key',
      fetchImpl: async (url, init) => {
        if (init.method === 'DELETE') {
          deleted();
          return Response.json({ job_id: jobId, cancelled: true });
        }
        return Response.json({});
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'X-API-Key': 'k'.repeat(32), 'Content-Type': 'application/json' };
    try {
      const analysis = fetch(`${base}/analyze`, {
        method: 'POST', headers, body: JSON.stringify({ job_id: jobId, prompt: 'fixture', systemMessage: 'fixture' })
      });
      await ready;
      const cancellation = fetch(`${base}/jobs/${jobId}/cancel`, { method: 'POST', headers });
      await deletion;
      await new Promise(resolve => setImmediate(resolve));
      created();
      assert.equal((await cancellation).status, 200);
      assert.equal((await analysis).status, 502);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
});
