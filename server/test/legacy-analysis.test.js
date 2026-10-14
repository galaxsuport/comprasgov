import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';

test('removes only unstarted legacy placeholders across accounts and is idempotent', () => {
  const db = new Database(':memory:');
  try {
    createApiServer({ db, authDisabled: true });
    const insert = db.prepare(`INSERT INTO analysis_jobs
      (owner,job_id,proposal_key,proposal_json,status,consult_path,report_path,report_html,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const owner of ['first', 'second']) {
      insert.run(owner, 'pendente-obsolete', 'id:obsolete', '{}', 'pendente', '', '', null, 1, 1);
    }
    insert.run('first', 'external-job', 'id:real', '{}', 'pendente', '', '', null, 1, 1);
    insert.run('first', 'pendente-with-path', 'id:path', '{}', 'pendente', '/status', '', null, 1, 1);
    insert.run('first', 'pendente-with-report', 'id:report', '{}', 'pendente', '', '', '<h1>Preserve</h1>', 1, 1);
    insert.run('first', 'pendente-running', 'id:running', '{}', 'processando', '', '', null, 1, 1);
    createApiServer({ db, authDisabled: true });
    const remaining = db.prepare('SELECT job_id FROM analysis_jobs ORDER BY job_id').all();
    assert.deepEqual(remaining.map(row => row.job_id), [
      'external-job', 'pendente-running', 'pendente-with-path', 'pendente-with-report'
    ]);
    createApiServer({ db, authDisabled: true });
    assert.deepEqual(db.prepare('SELECT job_id FROM analysis_jobs ORDER BY job_id').all(), remaining);
  } finally {
    db.close();
  }
});
