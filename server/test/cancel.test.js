import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';

test('cancels during startup, clears all proposal history and preserves it on upstream failure', async () => {
  let startReceived;
  let releaseStart;
  const received = new Promise(resolve => { startReceived = resolve; });
  const waitStart = new Promise(resolve => { releaseStart = resolve; });
  let failure = false;
  const cancelled = [];
  const upstream = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    assert.equal(request.headers['x-workflow-key'], 'fixture-key');
    if (request.url === '/webhook/pncp-analise') {
      startReceived();
      await waitStart;
      response.end(JSON.stringify({ job_id: 'fixture-job', consultar: '/status', relatorioHtml: '/report' }));
    } else {
      assert.equal(request.url, '/webhook/pncp-cancelar');
      const { job_id } = JSON.parse(text);
      if (failure) {
        response.writeHead(503);
        response.end();
      } else {
        cancelled.push(job_id);
        response.end(JSON.stringify({ job_id, cancelled: true }));
      }
    }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const db = new Database(':memory:');
  const api = createApiServer({
    db, authDisabled: true, analysisWorkflowKey: 'fixture-key',
    analysisWebhookUrl: `http://127.0.0.1:${upstream.address().port}/webhook/pncp-analise`
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${api.address().port}`;
  const headers = { 'Content-Type': 'application/json' };
  const cancel = (proposalKey, extra = {}) => fetch(`${base}/api/analysis/cancel`, {
    method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ proposalKey })
  });
  const insert = (owner, id) => db.prepare(`INSERT INTO analysis_jobs
    (owner,job_id,proposal_key,proposal_json,status,report_html,consult_path,report_path,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(owner, id, 'id:fixture', '{}', 'processando', 'old data', '/status', '/report', 1, 1);
  try {
    const starting = fetch(`${base}/api/analysis`, {
      method: 'POST', headers, body: JSON.stringify({
        proposal: { tipoSaida: 'oportunidade', idContratacaoPNCP: 'fixture', uasg: '985825', numeroCompra: '1/2027' }
      })
    });
    await received;
    const cancellation = cancel('id:fixture');
    await new Promise(resolve => setTimeout(resolve, 20));
    releaseStart();
    assert.equal((await starting).status, 409);
    assert.equal((await cancellation).status, 200);
    assert.deepEqual(cancelled, ['fixture-job']);
    assert.equal(db.prepare('SELECT count(*) AS n FROM analysis_jobs').get().n, 0);
    insert('homologacao', 'old1');
    insert('homologacao', 'old2');
    insert('another', 'other');
    assert.equal((await cancel('id:fixture', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await cancel('')).status, 400);
    failure = true;
    assert.equal((await cancel('id:fixture')).status, 502);
    assert.equal(db.prepare('SELECT count(*) AS n FROM analysis_jobs').get().n, 3);
    failure = false;
    assert.equal((await cancel('id:fixture')).status, 200);
    assert.deepEqual(db.prepare('SELECT job_id FROM analysis_jobs').all(), [{ job_id: 'other' }]);
    assert.equal((await cancel('id:fixture')).status, 404);
  } finally {
    releaseStart();
    await new Promise(resolve => api.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    db.close();
  }
});
