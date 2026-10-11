import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer } from './app.js';

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
  username: process.env.AUTH_USERNAME,
  password: process.env.AUTH_PASSWORD,
  staticDir: process.env.STATIC_DIR ?? resolve(serverDir, '../frontend/dist'),
  webhookUrl: process.env.VITE_API_BASE_URL,
  analysisWebhookUrl: process.env.ANALYSIS_WEBHOOK_URL,
  analysisWorkflowKey: process.env.ANALYSIS_WORKFLOW_KEY
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4174);
server.listen(port, '0.0.0.0', () => {
  console.log(`ComprasGov API listening on port ${port}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
