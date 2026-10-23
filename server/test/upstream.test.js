import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';

test('reports upstream HTML errors, connection failures and timeouts without losing active jobs', async () => {
  let mode = 'html';
  const upstream = createServer((request, response) => {
    if (mode === 'timeout') return;
    if (mode === 'stream') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('[');
      setTimeout(() => response.destroy(), 5);
      return;
    }
    if (mode === 'invalid') {
      response.end('not json');
      return;
    }
    if (mode === 'json') {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Task execution timed out after 60 seconds' }));
      return;
    }
    response.writeHead(502, { 'Content-Type': 'text/html' });
    response.end('<html>Bad Gateway</html>');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${upstream.address().port}`;
  const db = new Database(':memory:');
  const api = createApiServer({
    db, authDisabled: true, webhookUrl: `${url}/search`, analysisWebhookUrl: `${url}/start`,
    upstreamTimeoutMs: 50, analysisTimeoutMs: 50, analysisStartTimeoutMs: 50
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${api.address().port}`;
  const start = () => fetch(`${base}/api/analysis`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposal: { tipoSaida: 'oportunidade', idContratacaoPNCP: '40176679000199-1-1/2027', uasg: '985825', numeroCompra: '1/2027' } })
  });
  try {
    let response = await fetch(`${base}/api/pregoes`);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /pesquisa n8n respondeu HTTP 502/);
    response = await start();
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /análise n8n respondeu HTTP 502/);
    mode = 'json';
    response = await start();
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Task execution timed out after 60 seconds/);
    response = await fetch(`${base}/api/pregoes`);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).message, 'Task execution timed out after 60 seconds');
    mode = 'invalid';
    response = await start();
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /JSON inválido/);
    mode = 'stream';
    response = await fetch(`${base}/api/pregoes`);
    await assert.rejects(response.text());
    assert.equal((await fetch(`${base}/api/auth/session`)).status, 200);
    mode = 'timeout';
    response = await start();
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /Tempo limite excedido.*antes de tentar novamente/);
    response = await fetch(`${base}/api/pregoes`);
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /Tempo limite excedido/);
    db.prepare(`INSERT INTO analysis_jobs
      (owner,job_id,proposal_key,proposal_json,status,consult_path,report_path,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('homologacao','active','id:test','{}','processando',`${url}/status`,`${url}/report`,1,1);
    response = await fetch(`${base}/api/analysis/active/refresh`, { method: 'POST' });
    assert.equal(response.status, 504);
    assert.equal(db.prepare('SELECT status FROM analysis_jobs').get().status, 'processando');
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    response = await fetch(`${base}/api/pregoes`);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /ECONNREFUSED/);
  } finally {
    upstream.closeAllConnections();
    if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
    await new Promise(resolve => api.close(resolve));
    db.close();
  }
});
