import cron from 'node-cron';
import { setTimeout } from 'node:timers/promises';
import { lookupProposalStatus, proposalIdentity } from './app.js';

export const STATUS_CRON_EXPRESSION = '0 * * * *';
export const STATUS_CRON_TIMEZONE = 'America/Sao_Paulo';

export function startProposalStatusCron({ db, fetchImpl = fetch }) {
  const controller = new AbortController();
  const list = db.prepare('SELECT owner, proposal_key, value_json FROM registered_proposals');
  const get = db.prepare('SELECT value_json FROM registered_proposals WHERE owner = ? AND proposal_key = ?');
  const update = db.prepare('UPDATE registered_proposals SET value_json = ? WHERE owner = ? AND proposal_key = ?');
  let running = null;

  async function refresh() {
    const groups = new Map();
    const result = { updated: 0, failed: 0 };
    for (const row of list.all()) {
      try {
        const proposal = JSON.parse(row.value_json);
        const identity = proposalIdentity(proposal.idContratacaoPNCP, proposal.linkContratacao);
        const key = JSON.stringify(identity);
        if (!groups.has(key)) groups.set(key, { proposal, rows: [] });
        groups.get(key).rows.push(row);
      } catch (error) {
        result.failed++;
        console.error(`Cron de situação: proposta ${row.proposal_key} inválida:`, error.message);
      }
    }
    for (const { proposal, rows } of groups.values()) {
      controller.signal.throwIfAborted();
      try {
        const situacao = await lookupProposalStatus(
          proposal.idContratacaoPNCP, proposal.linkContratacao, fetchImpl, controller.signal
        );
        controller.signal.throwIfAborted();
        db.transaction(() => {
          for (const row of rows) {
            const stored = get.get(row.owner, row.proposal_key);
            if (!stored) continue;
            const current = JSON.parse(stored.value_json);
            const changes = update.run(JSON.stringify({ ...current, situacao }), row.owner, row.proposal_key);
            result.updated += changes.changes;
          }
        })();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        result.failed += rows.length;
        console.error(`Cron de situação: falha na proposta ${rows[0].proposal_key}:`, error.message);
        if (error.statusCode === 429) {
          console.warn('Cron de situação pausado porque o PNCP aplicou limite de requisições.');
          break;
        }
      }
      await setTimeout(500, undefined, { signal: controller.signal });
    }
    console.log(`Cron de situação concluído: ${result.updated} propostas atualizadas; ${result.failed} falhas.`);
    return result;
  }

  const task = cron.schedule(STATUS_CRON_EXPRESSION, async () => {
    if (controller.signal.aborted) throw new Error('Cron de situação encerrado.');
    if (running) {
      console.warn('Cron de situação: execução anterior ainda em andamento; nova execução ignorada.');
      return;
    }
    running = refresh();
    try {
      return await running;
    } finally {
      running = null;
    }
  }, { timezone: STATUS_CRON_TIMEZONE, noOverlap: true, name: 'proposal-status' });
  task.on('execution:failed', context => {
    if (!controller.signal.aborted) console.error('Cron de situação interrompido:', context.execution?.error?.message);
  });
  task.on('execution:overlap', () => {
    console.warn('Cron de situação: execução anterior ainda em andamento.');
  });

  return {
    task,
    async stop() {
      await task.destroy();
      controller.abort(new Error('Cron de situação encerrado durante desligamento.'));
      if (running) {
        try {
          await running;
        } catch (error) {
          console.warn('Cron de situação interrompido no desligamento:', error.message);
        }
      }
    }
  };
}
