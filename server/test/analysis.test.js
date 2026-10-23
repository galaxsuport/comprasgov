import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';

test('starts analyses directly, resumes progress and replaces reports only after a successful restart', async () => {
  let starts = 0;
  let state = 'pronto_para_agente';
  let failStart = false;
  let failRefresh = false;
  let emptyReport = false;
  let invalidUrl = false;
  let message = 'Iniciada';
  const upstream = createServer(async (req, res) => {
    assert.equal(req.headers['x-workflow-key'], 'fixture-key');
    if (req.url === '/start') {
      let text = '';
      for await (const chunk of req) text += chunk;
      assert.deepEqual(JSON.parse(text), { idContratacaoPNCP: '40176679000199-1-326/2027' });
      await new Promise(resolve => setTimeout(resolve, 20));
      if (failStart) { res.writeHead(503); res.end(); return; }
      starts++;
      res.end(JSON.stringify({
        job_id: `job-${starts}`, status: 'fila', mensagem: message,
        consultar: invalidUrl ? 'https://invalid.example/status' : `GET /status?job_id=job-${starts}`,
        relatorioHtml: `GET /report?job_id=job-${starts}`
      }));
    } else if (req.url.startsWith('/status')) {
      if (failRefresh) { res.writeHead(503); res.end(); return; }
      res.end(JSON.stringify({
        status: state, progresso: message === 'Iniciada' ? 'Dossiê pronto para o agente' : message,
        limitacoes: state === 'erro' ? ['Pesquisa indisponível'] : [],
        ...(state === 'erro' ? { relatorio_html: '<h1>Falha explícita</h1>' } : {})
      }));
    } else {
      res.end(emptyReport ? ' ' : '<h1>Relatório completo</h1>');
    }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const db = new Database(':memory:');
  const api = createApiServer({
    db, username: 'user', password: 'password',
    analysisWebhookUrl: `http://127.0.0.1:${upstream.address().port}/start`,
    analysisWorkflowKey: 'fixture-key'
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${api.address().port}`;
  const proposal = { tipoSaida: 'oportunidade', idContratacaoPNCP: '40176679000199-1-326/2027', uasg: '985825', numeroCompra: '326/2027' };
  try {
    assert.equal((await fetch(`${base}/api/analysis`)).status, 401);
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user', password: 'password' })
    });
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    const start = () => fetch(`${base}/api/analysis`, { method: 'POST', headers, body: JSON.stringify({ proposal }) });
    const refresh = id => fetch(`${base}/api/analysis/${id}/refresh`, { method: 'POST', headers });
    assert.equal((await fetch(`${base}/api/analysis`, {
      method: 'POST', headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ proposal })
    })).status, 403);
    assert.equal((await fetch(`${base}/api/analysis`, { method: 'POST', headers, body: '{}' })).status, 400);
    assert.equal((await fetch(`${base}/api/analysis`, {
      method: 'POST', headers, body: JSON.stringify({ proposal: { ...proposal, idContratacaoPNCP: 'invalid' } })
    })).status, 400);
    const simultaneous = await Promise.all([start(), start()]);
    assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
    assert.equal(starts, 1);
    const initial = await simultaneous.find(r => r.status === 200).json();
    assert.equal(initial.proposalKey, 'id:40176679000199-1-326/2027');
    assert.equal(initial.hasReport, false);
    assert.equal((await (await start()).json()).jobId, initial.jobId);
    assert.equal(starts, 1);
    for (state of ['pronto_para_agente', 'nao_concluido', 'finalizando', 'completando']) {
      const progress = await (await refresh(initial.jobId)).json();
      assert.equal(progress.status, state);
      assert.equal(progress.completedAt, null);
      assert.equal(progress.hasReport, false);
    }
    failRefresh = true;
    assert.equal((await refresh(initial.jobId)).status, 502);
    assert.equal(db.prepare('SELECT status FROM analysis_jobs').get().status, 'completando');
    failRefresh = false;
    state = 'concluido';
    emptyReport = true;
    assert.equal((await refresh(initial.jobId)).status, 502);
    emptyReport = false;
    const done = await (await refresh(initial.jobId)).json();
    assert.equal(done.hasReport, true);
    assert.ok(done.completedAt >= done.startedAt);
    assert.equal(done.message, 'Análise concluída.');
    const report = await fetch(`${base}/api/analysis/${initial.jobId}/report`, { headers });
    assert.match(report.headers.get('content-security-policy'), /sandbox/);
    assert.match(await report.text(), /Relatório completo/);
    db.prepare('UPDATE analysis_jobs SET owner = ?').run('another-user');
    assert.equal((await refresh(initial.jobId)).status, 404);
    assert.equal((await fetch(`${base}/api/analysis/${initial.jobId}/report`, { headers })).status, 404);
    db.prepare('UPDATE analysis_jobs SET owner = ?').run('user');
    failStart = true;
    assert.equal((await start()).status, 502);
    assert.equal((await (await fetch(`${base}/api/analysis`, { headers })).json())[0].hasReport, true);
    failStart = false;
    invalidUrl = true;
    assert.equal((await start()).status, 502);
    assert.equal(db.prepare('SELECT job_id FROM analysis_jobs').get().job_id, initial.jobId);
    invalidUrl = false;
    message = 'x'.repeat(300);
    const restarted = await (await start()).json();
    assert.equal(restarted.message.length, 255);
    assert.equal(db.prepare('SELECT length(message) AS length FROM analysis_jobs').get().length, 255);
    assert.notEqual(restarted.jobId, initial.jobId);
    assert.equal(restarted.hasReport, false);
    assert.equal(db.prepare('SELECT count(*) AS count FROM analysis_jobs').get().count, 1);
    assert.equal((await fetch(`${base}/api/analysis/${initial.jobId}/report`, { headers })).status, 404);
    state = 'processando';
    const longProgress = await (await refresh(restarted.jobId)).json();
    assert.equal(longProgress.message.length, 255);
    assert.equal(longProgress.completedAt, null);
    assert.equal(db.prepare('SELECT length(message) AS length FROM analysis_jobs').get().length, 255);
    message = 'Iniciada';
    state = 'erro';
    const failed = await (await refresh(restarted.jobId)).json();
    assert.equal(failed.hasReport, true);
    assert.match(failed.message, /A análise falhou.*Pesquisa indisponível/);
  } finally {
    await new Promise(resolve => api.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    db.close();
  }
});
