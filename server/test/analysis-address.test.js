import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';

test('invalid stored analysis addresses stop polling explicitly without deleting jobs or reports', async () => {
  let calls = 0;
  const upstream = createServer((req, res) => {
    calls++;
    res.end(JSON.stringify({ status: 'concluido' }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const db = new Database(':memory:');
  const server = createApiServer({
    db, authDisabled: true, analysisWebhookUrl: `http://127.0.0.1:${upstream.address().port}/start`
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const insert = db.prepare(`INSERT INTO analysis_jobs
    (owner,job_id,proposal_key,proposal_json,status,consult_path,report_path,report_html,created_at,updated_at)
    VALUES ('homologacao',?,?, '{}','processando',?,?,?,?,?)`);
  try {
    for (const [id, consult, report, html] of [
      ['empty-consult', '', '/report', null],
      ['empty-report', '/status', '', null],
      ['invalid-url', 'https://[', '/report', null],
      ['foreign-url', 'https://example.com/status', '/report', '<h1>Preserve</h1>']
    ]) {
      insert.run(id, `id:${id}`, consult, report, html, 1, 1);
      const refresh = () => fetch(`${base}/api/analysis/${id}/refresh`, { method: 'POST' });
      const response = await refresh();
      assert.equal(response.status, 200);
      const failed = await response.json();
      assert.equal(failed.status, 'erro');
      assert.ok(failed.completedAt);
      assert.match(failed.message, /n8n|ANALYSIS_WEBHOOK_URL/);
      assert.equal(failed.hasReport, Boolean(html));
      const stored = db.prepare('SELECT * FROM analysis_jobs WHERE job_id=?').get(id);
      assert.equal(stored.consult_path, consult);
      assert.equal(stored.report_path, report);
      assert.equal(stored.report_html, html);
      const before = calls;
      assert.equal((await (await refresh()).json()).status, 'erro');
      assert.equal(calls, before);
    }
    assert.equal(calls, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM analysis_jobs').get().count, 4);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    db.close();
  }
});

test('missing webhook configuration is actionable and does not mark existing jobs as failed', async () => {
  const db = new Database(':memory:');
  const server = createApiServer({ db, authDisabled: true });
  db.prepare(`INSERT INTO analysis_jobs
    (owner,job_id,proposal_key,proposal_json,status,consult_path,report_path,created_at,updated_at)
    VALUES ('homologacao','real-job','id:fixture','{}','processando','/status','/report',1,1)`).run();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analysis/real-job/refresh`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /ANALYSIS_WEBHOOK_URL/);
    assert.equal(db.prepare('SELECT status FROM analysis_jobs').get().status, 'processando');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
