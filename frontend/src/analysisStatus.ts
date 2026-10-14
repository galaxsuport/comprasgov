import type { AnalysisJob } from './api';

export function isTerminalAnalysis(job: AnalysisJob): boolean {
  return /erro|falha|fail|cancel/i.test(job.status)
    || (/^(conclu[ií]d[oa]|finalizad[oa]|pront[oa]|sucesso|success|completed?|done|ready)$/i.test(job.status.trim()) && job.hasReport);
}
