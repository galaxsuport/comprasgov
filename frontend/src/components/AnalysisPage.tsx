import { useEffect, useState } from 'react';
import { copyText } from '../copyText';
import { formatDateTime } from '../format';
import TimeRemaining from './TimeRemaining';
import { beginAnalysis, fetchAnalyses, getFavoriteKey, refreshAnalysis, removeAnalysis, restartAnalysis, type AnalysisJob } from '../api';

const POLL_INTERVAL_MS = 5000;

function isFinished(job: AnalysisJob) {
  if (job.status === 'pendente') return true;
  if (/erro|falha|fail|cancel/i.test(job.status)) return true;
  return /conclu|finaliz|pronto|sucesso|complet|done/i.test(job.status) && job.hasReport;
}

function isFailed(status: string) {
  return /erro|falha|fail|cancel/i.test(status);
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
  registeredKeys = new Set(),
  onRunAll,
  onJobsChange,
  onRegisterProposal,
  onOpenCalendar,
  onBack
}: {
  focusJobId: string | null;
  batchRunning: boolean;
  batchError: string | null;
  registeredKeys?: Set<string>;
  onRunAll: () => void;
  onJobsChange: (jobs: AnalysisJob[]) => void;
  onRegisterProposal?: (job: AnalysisJob) => Promise<void> | void;
  onOpenCalendar?: () => void;
  onBack: () => void;
}) {
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registeringJobId, setRegisteringJobId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedProposalJobId, setCopiedProposalJobId] = useState<string | null>(null);
  const [copyErrorJobId, setCopyErrorJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedProposalJobId) return;
    const timeoutId = window.setTimeout(() => setCopiedProposalJobId(null), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [copiedProposalJobId]);

  const handleToggleRegister = async (job: AnalysisJob) => {
    if (!onRegisterProposal || registeringJobId) return;
    setRegisteringJobId(job.jobId);
    setError(null);
    try {
      const key = getFavoriteKey(job.proposal);
      const wasRegistered = Boolean(key && registeredKeys.has(key));
      await onRegisterProposal(job);
      setSuccessMessage(
        wasRegistered
          ? 'Proposta desmarcada da agenda de cadastradas.'
          : 'Proposta enviada para a lista de propostas cadastradas!'
      );
      window.setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cadastrar a proposta.');
    } finally {
      setRegisteringJobId(null);
    }
  };

  const copyProposalLink = async (job: AnalysisJob) => {
    if (!job.proposal.cadastroProposta) return;
    try {
      await copyText(job.proposal.cadastroProposta);
      setCopiedProposalJobId(job.jobId);
      setCopyErrorJobId(null);
    } catch {
      setCopyErrorJobId(job.jobId);
    }
  };

  const startJob = async (job: AnalysisJob) => {
    setError(null);
    try {
      const started = await beginAnalysis(job.jobId);
      setJobs(current => current.map(item => (item.jobId === job.jobId ? started : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar a análise.');
    }
  };

  const [restarting, setRestarting] = useState<string | null>(null);

  const restartJob = async (job: AnalysisJob) => {
    setError(null);
    setRestarting(job.jobId);
    try {
      const restarted = await restartAnalysis(job.jobId);
      setJobs(current => current.map(item => (item.jobId === job.jobId ? restarted : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível refazer a análise.');
    } finally {
      setRestarting(null);
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

  const jobsByDeadline = [...jobs].sort((a, b) => {
    const timeA = a.proposal.dataEncerramentoProposta ? Date.parse(a.proposal.dataEncerramentoProposta) : NaN;
    const timeB = b.proposal.dataEncerramentoProposta ? Date.parse(b.proposal.dataEncerramentoProposta) : NaN;
    if (Number.isNaN(timeA) && Number.isNaN(timeB)) return 0;
    if (Number.isNaN(timeA)) return 1;
    if (Number.isNaN(timeB)) return -1;
    return timeA - timeB;
  });

  return (
    <section className="settings-page analysis-page">
      <h2>Análises</h2>
      {batchError ? <div className="status-card status-error" role="alert">{batchError}</div> : null}
      {error ? <div className="status-card status-error" role="alert">{error}</div> : null}
      {successMessage ? (
        <div className="status-card status-success-banner" role="status">
          <span>{successMessage}</span>
          {onOpenCalendar ? (
            <button
              type="button"
              className="discard-toggle calendar-banner-btn"
              onClick={onOpenCalendar}
            >
              Ver na agenda
            </button>
          ) : null}
        </div>
      ) : null}
      {loading ? <div className="status-card">Carregando análises...</div> : null}
      {!loading && jobs.length === 0 ? <div className="status-card">Nenhuma análise solicitada.</div> : null}
      <div className="analysis-list">
        {jobsByDeadline.map(job => {
          const proposalLink = job.proposal.linkContratacao ?? job.proposal.linkSistemaOrigem;
          const proposalLinkLabel = job.proposal.linkContratacao ? 'Ver no PNCP' : 'Ver proposta';
          const pKey = getFavoriteKey(job.proposal);
          const isRegistered = Boolean(pKey && registeredKeys.has(pKey));
          return (
          <article
            key={job.jobId}
            className={`analysis-card${job.jobId === focusJobId ? ' is-focused' : ''}`}
          >
            <header>
              <span className={`analysis-status analysis-${statusTone(job.status)}`}>{job.status}</span>
              {isRegistered ? <span className="analysis-status analysis-registered-badge">Cadastrada</span> : null}
              <strong>{job.proposal.unidadeCompradora ?? job.proposal.orgao ?? 'Proposta'}</strong>
              <span>{job.proposal.numeroCompra}</span>
            </header>
            <dl>
              <dt>job_id</dt>
              <dd>{job.jobId}</dd>
              <dt>resumo do objeto</dt>
              <dd className="analysis-object" title={job.proposal.objeto ?? undefined}>{job.proposal.objeto ?? '—'}</dd>
              <dt>valor do edital</dt>
              <dd className="analysis-value">{job.proposal.valor ?? '—'}</dd>
              <dt>abertura da sessão</dt>
              <dd>{formatDateTime(job.proposal.dataEncerramentoProposta)}</dd>
              <dt>tempo restante</dt>
              <dd><TimeRemaining deadline={job.proposal.dataEncerramentoProposta} /></dd>
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
              {!batchRunning && proposalLink ? (
                <a
                  className="discard-toggle pncp-link"
                  href={proposalLink}
                  target="_blank"
                  rel="noreferrer"
                  title={proposalLinkLabel}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <path d="M15 3h6v6" />
                    <path d="M10 14L21 3" />
                  </svg>
                  <span>{proposalLinkLabel}</span>
                </a>
              ) : null}
              {!batchRunning && job.proposal.cadastroProposta ? (
                <button
                  type="button"
                  className="discard-toggle action-link"
                  onClick={() => void copyProposalLink(job)}
                  aria-label={copiedProposalJobId === job.jobId ? 'Link copiado' : 'Copiar link da proposta'}
                  title={copiedProposalJobId === job.jobId ? 'Link copiado' : 'Copiar link da proposta'}
                >
                  {copiedProposalJobId === job.jobId ? 'Copiado' : 'Link da proposta'}
                </button>
              ) : null}
              {copyErrorJobId === job.jobId ? <span role="alert">Não foi possível copiar o link.</span> : null}
              {!batchRunning && onRegisterProposal ? (
                <button
                  type="button"
                  className={`discard-toggle register-toggle-btn${isRegistered ? ' is-registered' : ''}`}
                  disabled={registeringJobId === job.jobId}
                  onClick={() => void handleToggleRegister(job)}
                  title={isRegistered ? 'Remover da agenda de propostas cadastradas' : 'Adicionar à agenda de propostas cadastradas'}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                    {isRegistered ? <path d="M9 16l2 2 4-4" /> : null}
                  </svg>
                  <span>
                    {registeringJobId === job.jobId
                      ? 'Salvando...'
                      : isRegistered
                      ? 'Cadastrada'
                      : 'Proposta cadastrada'}
                  </span>
                </button>
              ) : null}
              {!batchRunning && isRegistered && onOpenCalendar ? (
                <button
                  type="button"
                  className="discard-toggle calendar-toggle"
                  onClick={onOpenCalendar}
                  title="Abrir agenda de propostas cadastradas"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span>Ver na agenda</span>
                </button>
              ) : null}
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
              {isFailed(job.status) ? (
                <button
                  type="button"
                  className="discard-toggle result-link"
                  onClick={() => void restartJob(job)}
                  disabled={batchRunning || restarting === job.jobId}
                  title="Iniciar uma nova análise com novo job_id"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                  <span>{restarting === job.jobId ? 'Refazendo…' : 'Refazer análise'}</span>
                </button>
              ) : (
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
              )}
            </div>
          </article>
          );
        })}
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
