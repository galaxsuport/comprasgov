import { useEffect, useState } from 'react';
import { copyText } from '../copyText';
import { formatDateTime, formatDuration } from '../format';
import { getAnalysisParams, type AnalysisJob } from '../api';
import { isTerminalAnalysis } from '../analysisStatus';
import TimeRemaining from './TimeRemaining';
import type { PregaoResultado, OportunidadeResultado, ResumoResultado } from '../types';

interface ResultCardProps {
  result: PregaoResultado;
  isRegistered?: boolean;
  isRegistering?: boolean;
  onToggleRegister?: (result: OportunidadeResultado) => void;
  onOpenCalendar?: () => void;
  isDiscarded?: boolean;
  onToggleDiscard?: (result: OportunidadeResultado) => void;
  onAnalyze?: (result: OportunidadeResultado) => void;
  onCancelAnalysis?: (result: OportunidadeResultado) => void;
  analysisCancelling?: boolean;
  analysisStarting?: boolean;
  analysisJob?: AnalysisJob;
  statusLoading?: boolean;
  statusError?: string | null;
}

function isResumo(result: PregaoResultado): result is ResumoResultado {
  return result.tipoSaida === 'resumo';
}

export default function ResultCard({
  result,
  isRegistered = false,
  isRegistering = false,
  onToggleRegister,
  onOpenCalendar,
  isDiscarded = false,
  onToggleDiscard,
  onAnalyze,
  onCancelAnalysis,
  analysisCancelling = false,
  analysisStarting = false,
  analysisJob,
  statusLoading = false,
  statusError = null
}: ResultCardProps) {
  const [proposalLinkCopied, setProposalLinkCopied] = useState(false);
  const [proposalLinkError, setProposalLinkError] = useState(false);
  const analysisFinished = Boolean(analysisJob && isTerminalAnalysis(analysisJob));
  const analysisRunning = analysisStarting || analysisCancelling || Boolean(analysisJob && !analysisFinished);
  useEffect(() => {
    if (!proposalLinkCopied) return;
    const timeoutId = window.setTimeout(() => setProposalLinkCopied(false), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [proposalLinkCopied]);

  const copyProposalLink = async (link: string) => {
    try {
      await copyText(link);
      setProposalLinkError(false);
      setProposalLinkCopied(true);
    } catch {
      setProposalLinkError(true);
    }
  };

  // Se for resumo, mostra apenas o diagnóstico
  if (isResumo(result)) {
    return (
      <article className="card card-resumo">
        <div className="card-header">
          <h2>Resumo da Consulta</h2>
          <p className="subline">
            {result.encontrouOportunidades ? 'Oportunidades encontradas' : 'Nenhuma oportunidade encontrada'}
          </p>
        </div>
        <div className="card-grid">
          <div><span>Páginas consultadas</span><strong>{result.diagnostico.paginas}</strong></div>
          <div><span>Registros recebidos</span><strong>{result.diagnostico.recebidos}</strong></div>
          <div><span>Não TIC</span><strong>{result.diagnostico.naoTIC}</strong></div>
          <div><span>Score insuficiente</span><strong>{result.diagnostico.scoreInsuficiente}</strong></div>
          <div><span>Prazo vencido</span><strong>{result.diagnostico.prazo}</strong></div>
          <div><span>Status inválido</span><strong>{result.diagnostico.status}</strong></div>
          <div><span>Excluídos</span><strong>{result.diagnostico.excluidos}</strong></div>
          <div><span>Aprovados (antes dedup)</span><strong>{result.diagnostico.aprovadosAntesDedup}</strong></div>
          <div><span>Duplicados</span><strong>{result.diagnostico.duplicados}</strong></div>
        </div>
      </article>
    );
  }

  const proposalLink = result.linkContratacao ?? result.linkSistemaOrigem;
  const proposalLinkLabel = result.linkContratacao ? 'Ver no PNCP' : 'Ver proposta';

  const unidadeCompradora = result.unidadeCompradora;
  const tipoInstrumentoConvocatorio = result.tipoInstrumentoConvocatorio;
  const rawNumeroCompra = result.numeroCompra?.trim();
  const anoCompra = result.idContratacaoPNCP?.match(/\/(\d{4})$/)?.[1];
  const numeroCompra = rawNumeroCompra && !rawNumeroCompra.includes('/') && anoCompra
    ? `${rawNumeroCompra}/${anoCompra}`
    : rawNumeroCompra;
  const edital = numeroCompra
    ? `${tipoInstrumentoConvocatorio ? `${tipoInstrumentoConvocatorio} ` : ''}nº ${numeroCompra}`
    : null;
  const situacao = result.situacao;
  const suspended = situacao?.trim().toLocaleLowerCase('pt-BR') === 'suspensa';
  const scorePercent = Number.isFinite(result.score)
    ? Math.min(100, Math.max(0, result.score))
    : 0;

  // Renderização para oportunidade
  return (
    <article className={`card${isDiscarded ? ' card-discarded' : ''}`}>
      <div className="card-content" {...(isDiscarded ? ({ inert: '' } as object) : {})} aria-hidden={isDiscarded || undefined}>
      <div className="card-header card-opportunity-header">
        <div>
          <div className="score-meter-block">
            <div
              className="score-meter-track"
              role="progressbar"
              aria-label="Score de relevância"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(scorePercent)}
            >
              <span className="score-meter-fill" style={{ width: `${scorePercent}%` }} />
              <span className="score-meter-value">Score {Math.round(scorePercent)}%</span>
            </div>
          </div>
          <h2>{result.local ?? 'Local não informado'}</h2>
          {edital ? <p className="subline">{edital}</p> : null}
          {unidadeCompradora ? (
            <p className="subline">{unidadeCompradora}</p>
          ) : null}
          <div className="card-badges">
            {result.modalidade ? <span className="badge">{result.modalidade}</span> : null}
            {result.registroPreco === true ? <span className="badge badge-srp">SRP</span> : null}
            {result.modoDisputa ? <span className="badge">{result.modoDisputa}</span> : null}
            <span className={`badge${suspended ? ' badge-suspended' : ''}`} aria-busy={statusLoading} aria-label={`Situação do edital: ${situacao ?? 'Não informada'}`}>
              {situacao ?? '—'}
            </span>
            {statusLoading ? <span className="badge" role="status">Atualizando situação...</span> : null}
            {statusError ? <span className="badge" role="status" title={statusError}>Situação não atualizada</span> : null}
          </div>
        </div>
        <div className="card-header-actions">
          {isRegistered && onOpenCalendar ? (
            <button
              type="button"
              className="calendar-card-toggle"
              onClick={onOpenCalendar}
              disabled={isDiscarded}
              aria-label="Abrir propostas agendadas"
              title="Abrir propostas agendadas"
            >
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 10h18" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <div className="card-grid">
        <div>
          <span>Modalidade</span>
          <strong>{result.modalidade ?? '—'}</strong>
        </div>
        <div>
          <span>Valor</span>
          <strong>{result.valor ?? '—'}</strong>
        </div>
        <div>
          <span>UF</span>
          <strong>{result.uf ?? '—'}</strong>
        </div>
        <div>
          <span>Município</span>
          <strong>{result.municipio ?? '—'}</strong>
        </div>
        <div>
          <span>Data publicação</span>
          <strong>{result.dataPublicacao ? new Date(result.dataPublicacao).toLocaleDateString('pt-BR') : '—'}</strong>
        </div>
        <div>
          <span>Data fim</span>
          <strong>
            {result.dataEncerramentoProposta ? (
              new Date(result.dataEncerramentoProposta).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              })
            ) : '—'}
          </strong>
        </div>
        <div>
          <span>Abertura da sessão</span>
          <strong>{formatDateTime(result.dataEncerramentoProposta)}</strong>
        </div>
        <TimeRemaining deadline={result.dataEncerramentoProposta} />
      </div>

      <div className="card-meta">
        {result.palavrasChaveEncontradas && result.palavrasChaveEncontradas.length > 0 && (
          <div className="keywords">
            <span className="keywords-label">Palavras-chave:</span>
            {result.palavrasChaveEncontradas.map((keyword: string, index: number) => (
              <span key={index} className="keyword-tag">{keyword}</span>
            ))}
          </div>
        )}
      </div>

      <div className="card-section">
        <p className="section-label">Objeto da contratação</p>
        <p className="object-text">{result.objeto ?? 'Descrição não disponível'}</p>
      </div>
      </div>

      {analysisJob && !analysisStarting ? (
        <section className="card-section" aria-label="Acompanhamento da análise">
          <p className="section-label">Análise do edital</p>
          <div className="card-grid card-analysis-progress">
            <div><span>job_id</span><strong>{analysisJob.jobId}</strong></div>
            {analysisFinished && analysisJob.completedAt !== null ? (
              <div><span>Tempo de análise</span><strong>{formatDuration(analysisJob.completedAt - analysisJob.startedAt)}</strong></div>
            ) : null}
            <div aria-live="polite"><span>Status da análise</span><strong>{analysisJob.status}</strong></div>
            <div aria-live="polite"><span>Mensagem de progresso</span><strong>{analysisJob.message?.slice(0, 255) ?? 'Sem mensagem de progresso'}</strong></div>
          </div>
        </section>
      ) : null}

      <div className="card-discard-row">
        {onAnalyze ? (
          <button
            type="button"
            className={`discard-toggle${!analysisRunning && !analysisCancelling ? analysisFinished ? ' reanalyze-btn' : ' analyze-btn' : ''}`}
            onClick={() => analysisRunning ? onCancelAnalysis?.(result) : onAnalyze(result)}
            disabled={isDiscarded || analysisCancelling || (analysisRunning && !onCancelAnalysis)}
            title={analysisRunning ? 'Cancelar análise e excluir os dados gerados'
              : !getAnalysisParams(result) ? 'Id contratação PNCP indisponível'
              : analysisFinished ? 'Iniciar uma nova análise' : 'Analisar edital'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m16 16 5 5" />
            </svg>
            <span>{analysisCancelling ? 'Cancelando...' : analysisRunning ? 'Cancelar análise' : analysisFinished ? 'Refazer análise' : 'Analisar'}</span>
          </button>
        ) : null}
        {analysisJob?.hasReport && !analysisStarting ? (
          <a
            className="discard-toggle report-link"
            href={isDiscarded ? undefined : `/api/analysis/${encodeURIComponent(analysisJob.jobId)}/report`}
            aria-disabled={isDiscarded || undefined}
            tabIndex={isDiscarded ? -1 : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="8" y="3" width="8" height="4" rx="1" />
              <path d="M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <path d="M8 12h8M8 16h8" />
            </svg>
            <span>Resultado</span>
          </a>
        ) : null}
        {onToggleRegister ? (
          <button
            type="button"
            className={`discard-toggle register-toggle-btn${isRegistered ? ' is-registered' : ''}`}
            onClick={() => onToggleRegister(result)}
            disabled={isDiscarded || isRegistering}
            title={isRegistered ? 'Remover das propostas agendadas' : 'Adicionar às propostas agendadas'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
              {isRegistered ? <path d="m9 16 2 2 4-4" /> : null}
            </svg>
            <span>{isRegistering ? 'Salvando...' : isRegistered ? 'Agendada' : 'Agendar proposta'}</span>
          </button>
        ) : null}
        {proposalLink ? (
          <a
            className="discard-toggle pncp-link"
            href={isDiscarded ? undefined : proposalLink}
            aria-disabled={isDiscarded || undefined}
            tabIndex={isDiscarded ? -1 : undefined}
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
        {result.cadastroProposta ? (
          <button
            type="button"
            className="discard-toggle action-link"
            onClick={() => void copyProposalLink(result.cadastroProposta!)}
            disabled={isDiscarded}
            aria-label={proposalLinkCopied ? 'Link copiado' : 'Copiar link da proposta'}
            title={proposalLinkCopied ? 'Link copiado' : 'Copiar link da proposta'}
          >
            {proposalLinkCopied ? 'Copiado' : 'Link da proposta'}
          </button>
        ) : null}
        {proposalLinkError ? <span role="alert">Não foi possível copiar o link.</span> : null}
        {onToggleDiscard ? (
          <button
            type="button"
            className="discard-toggle"
            onClick={() => onToggleDiscard(result)}
            disabled={!result.idContratacaoPNCP && !result.linkContratacao}
            title={isDiscarded ? 'Desfazer descartar' : 'Descartar proposta'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {isDiscarded ? (
                <>
                  <path d="M3 7v6h6" />
                  <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
                </>
              ) : (
                <>
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </>
              )}
            </svg>
            <span>{isDiscarded ? 'Desfazer descartar' : 'Descartar'}</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}
