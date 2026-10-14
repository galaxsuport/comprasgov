import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer } from './app.js';
import { startProposalStatusCron } from './proposal-status-cron.js';

const serverDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(serverDir, '../frontend/.env') });

const dataDir = process.env.DATA_DIR ?? resolve(serverDir, 'data');
mkdirSync(dataDir, { recursive: true });
const database = new Database(resolve(dataDir, 'comprasgov.sqlite'));
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');

const deadlineFromEnv = Number(process.env.DEADLINE_DEFAULT_DAYS);

const server = createApiServer({
  db: database,
  defaultDeadlineDays: Number.isInteger(deadlineFromEnv) && deadlineFromEnv >= 1 && deadlineFromEnv <= 15
    ? deadlineFromEnv
    : undefined,
  // Em homologação (APP_ENV=homologacao) o acesso é liberado sem login.
  authDisabled: process.env.APP_ENV === 'homologacao',
  username: process.env.AUTH_USERNAME,
  password: process.env.AUTH_PASSWORD,
  staticDir: process.env.STATIC_DIR ?? resolve(serverDir, '../frontend/dist'),
  webhookUrl: process.env.VITE_API_BASE_URL,
  analysisWebhookUrl: process.env.ANALYSIS_WEBHOOK_URL,
  analysisWorkflowKey: process.env.ANALYSIS_WORKFLOW_KEY
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4174);
let statusCron;
server.listen(port, '0.0.0.0', () => {
  statusCron = startProposalStatusCron({ db: database });
  console.log(`ComprasGov API listening on port ${port}`);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await statusCron?.stop();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
