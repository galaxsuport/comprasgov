import { useEffect, useState } from 'react';
import { beginAnalysis, fetchAnalyses, refreshAnalysis, removeAnalysis, type AnalysisJob } from '../api';

const POLL_INTERVAL_MS = 5000;

function isFinished(job: AnalysisJob) {
  if (job.status === 'pendente') return true;
  if (/erro|falha|fail|cancel/i.test(job.status)) return true;
  return /conclu|finaliz|pronto|sucesso|complet|done/i.test(job.status) && job.hasReport;
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours ? `${hours} h` : '', hours || minutes ? `${minutes} min` : '', `${seconds} s`].filter(Boolean).join(' ');
}

function statusTone(status: string) {
  if (/erro|falha|fail|cancel/i.test(status)) return 'failed';
  if (/conclu|finaliz|pronto|sucesso|complet|done/i.test(status)) return 'done';
  if (status === 'pendente') return 'pending';
  return 'running';
}

export default function AnalysisPage({
  focusJobId,
  batchRunning,
  batchError,
  onRunAll,
  onJobsChange,
  onBack
}: {
  focusJobId: string | null;
  batchRunning: boolean;
  batchError: string | null;
  onRunAll: () => void;
  onJobsChange: (jobs: AnalysisJob[]) => void;
  onBack: () => void;
}) {
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startJob = async (job: AnalysisJob) => {
    setError(null);
    try {
      const started = await beginAnalysis(job.jobId);
      setJobs(current => current.map(item => (item.jobId === job.jobId ? started : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar a análise.');
    }
  };

  const [confirmJob, setConfirmJob] = useState<AnalysisJob | null>(null);

  const requestRemove = (job: AnalysisJob) => {
    if (job.status === 'pendente') void removeJob(job);
    else setConfirmJob(job);
  };

  const removeJob = async (job: AnalysisJob) => {
    setConfirmJob(null);
    setError(null);
    try {
      await removeAnalysis(job.jobId);
      const remaining = jobs.filter(item => item.jobId !== job.jobId);
      setJobs(remaining);
      onJobsChange(remaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover a tarefa.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const merge = (updated: AnalysisJob) =>
      setJobs(current => current.map(job => (job.jobId === updated.jobId ? updated : job)));

    const tick = async (jobList: AnalysisJob[]) => {
      for (const job of jobList.filter(item => !isFinished(item))) {
        try {
          const updated = await refreshAnalysis(job.jobId);
          if (!cancelled) merge(updated);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao consultar a análise.');
        }
      }
    };

    const loop = async () => {
      try {
        const list = await fetchAnalyses();
        if (cancelled) return;
        setJobs(list);
        onJobsChange(list);
        setLoading(false);
        setError(null);
        await tick(list);
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Não foi possível carregar as análises.');
      }
      if (!cancelled) timer = window.setTimeout(loop, POLL_INTERVAL_MS);
    };

    void loop();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <section className="settings-page analysis-page">
      <h2>Análises</h2>
      {batchError ? <div className="status-card status-error" role="alert">{batchError}</div> : null}
      {error ? <div className="status-card status-error" role="alert">{error}</div> : null}
      {loading ? <div className="status-card">Carregando análises...</div> : null}
      {!loading && jobs.length === 0 ? <div className="status-card">Nenhuma análise solicitada.</div> : null}
      <div className="analysis-list">
        {jobs.map(job => (
          <article
            key={job.jobId}
            className={`analysis-card${job.jobId === focusJobId ? ' is-focused' : ''}`}
          >
            <header>
              <span className={`analysis-status analysis-${statusTone(job.status)}`}>{job.status}</span>
              <strong>{job.proposal.unidadeCompradora ?? job.proposal.orgao ?? 'Proposta'}</strong>
              <span>{job.proposal.numeroCompra}</span>
            </header>
            <dl>
              <dt>job_id</dt>
              <dd>{job.jobId}</dd>
              <dt>mensagem</dt>
              <dd>{job.message ?? '—'}</dd>
              {job.completedAt ? (
                <>
                  <dt>concluída em</dt>
                  <dd>{new Date(job.completedAt).toLocaleString('pt-BR')}</dd>
                  <dt>tempo de análise</dt>
                  <dd>{formatDuration(job.completedAt - job.startedAt)}</dd>
                </>
              ) : null}
            </dl>
            <div className="card-discard-row analysis-actions">
              {batchRunning ? null : job.status === 'pendente' ? (
                <>
                  <button type="button" className="discard-toggle analyze-link" onClick={() => void startJob(job)}>
                    Iniciar análise
                  </button>
                  <button type="button" className="discard-toggle" onClick={() => requestRemove(job)}>
                    Remover
                  </button>
                </>
              ) : (
                <button type="button" className="discard-toggle" onClick={() => requestRemove(job)}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                  <span>Excluir</span>
                </button>
              )}
              <button
                type="button"
                className="discard-toggle result-link"
                onClick={() => window.open(`/api/analysis/${encodeURIComponent(job.jobId)}/report`, '_blank', 'noopener')}
                disabled={!job.hasReport}
                title={job.hasReport ? 'Abrir resultado' : 'Disponível após a conclusão da análise'}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5" />
                  <path d="M9 13h6M9 17h6" />
                </svg>
                <span>Resultado</span>
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="analysis-footer">
        <button type="button" className="logout-button" onClick={onBack}>Voltar aos resultados</button>
        <button
          type="button"
          className="btn-apply-filters"
          onClick={onRunAll}
          disabled={batchRunning || !jobs.some(job => job.status === 'pendente')}
          title={batchRunning ? 'Análise em sequência em andamento' : 'Analisar todos os pendentes, um por um'}
        >
          {batchRunning ? 'Analisando…' : 'Analisar todos'}
        </button>
      </div>
      {confirmJob ? (
        <div className="webhook-popup-backdrop" onClick={() => setConfirmJob(null)}>
          <section
            className="webhook-popup"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            aria-describedby="confirm-delete-message"
            onClick={event => event.stopPropagation()}
            onKeyDown={event => { if (event.key === 'Escape') setConfirmJob(null); }}
          >
            <p className="eyebrow">Confirmação</p>
            <h2 id="confirm-delete-title">Excluir análise?</h2>
            <p id="confirm-delete-message">
              A análise {confirmJob.proposal.numeroCompra ?? ''} e o relatório salvo serão removidos do banco de dados. Esta ação não pode ser desfeita.
            </p>
            <div className="confirm-actions">
              <button autoFocus type="button" className="logout-button" onClick={() => setConfirmJob(null)}>Cancelar</button>
              <button type="button" className="btn-apply-filters confirm-danger" onClick={() => void removeJob(confirmJob)}>Excluir</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
