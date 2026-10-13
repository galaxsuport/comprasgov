import { useMemo } from 'react';
import type { PregaoResultado, OportunidadeResultado, SummaryFilter } from '../types';
import type { AnalysisJob } from '../api';
import { formatBRL, formatCompactBRL } from '../format';

interface DashboardProps {
  results: PregaoResultado[];
  favorites: OportunidadeResultado[];
  registered: OportunidadeResultado[];
  discarded: OportunidadeResultado[];
  analysisJobs: AnalysisJob[];
  activeFilter: SummaryFilter;
  onSelectFilter: (filter: SummaryFilter) => void;
  onOpenFavorites: () => void;
  onOpenCalendar: () => void;
  onOpenAnalysis: () => void;
  onOpenDiscarded: () => void;
  getProposalKey: (proposal: OportunidadeResultado) => string | null;
}

export function Dashboard({
  results,
  favorites,
  registered,
  discarded,
  analysisJobs,
  activeFilter,
  onSelectFilter,
  onOpenFavorites,
  onOpenCalendar,
  onOpenAnalysis,
  onOpenDiscarded,
  getProposalKey
}: DashboardProps) {
  const discardedKeySet = useMemo(() => {
    return new Set(discarded.map(getProposalKey).filter((k): k is string => k !== null));
  }, [discarded, getProposalKey]);

  const allOpportunities = useMemo(() => {
    return results.filter((r): r is OportunidadeResultado => r.tipoSaida === 'oportunidade');
  }, [results]);

  const activeOpportunities = useMemo(() => {
    return allOpportunities.filter(op => {
      const key = getProposalKey(op);
      return !key || !discardedKeySet.has(key);
    });
  }, [allOpportunities, discardedKeySet, getProposalKey]);

  // Estatísticas Financeiras
  const { totalValor, divulgadoCount, sigilosoCount, mediaValor } = useMemo(() => {
    let total = 0;
    let divulgado = 0;
    let sigiloso = 0;

    for (const op of activeOpportunities) {
      const isSigiloso = op.valor?.trim().toLowerCase() === 'sigiloso';
      if (isSigiloso) {
        sigiloso++;
      } else if (typeof op.valorNumerico === 'number' && op.valorNumerico > 0) {
        total += op.valorNumerico;
        divulgado++;
      } else {
        sigiloso++;
      }
    }

    const media = divulgado > 0 ? total / divulgado : 0;
    return {
      totalValor: total,
      divulgadoCount: divulgado,
      sigilosoCount: sigiloso,
      mediaValor: media
    };
  }, [activeOpportunities]);

  // Modalidades
  const modalidadesStats = useMemo(() => {
    let pregaoCount = 0;
    let pregaoValor = 0;
    let dispensaCount = 0;
    let dispensaValor = 0;
    let outrosCount = 0;
    let outrosValor = 0;

    for (const op of activeOpportunities) {
      const modalidade = (op.modalidade ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const val = typeof op.valorNumerico === 'number' && op.valorNumerico > 0 ? op.valorNumerico : 0;

      if (op.codigoModalidade === 8 || modalidade.includes('dispensa')) {
        dispensaCount++;
        dispensaValor += val;
      } else if (modalidade.includes('pregao')) {
        pregaoCount++;
        pregaoValor += val;
      } else {
        outrosCount++;
        outrosValor += val;
      }
    }

    const total = activeOpportunities.length || 1;
    return {
      pregao: { count: pregaoCount, valor: pregaoValor, pct: Math.round((pregaoCount / total) * 100) },
      dispensa: { count: dispensaCount, valor: dispensaValor, pct: Math.round((dispensaCount / total) * 100) },
      outros: { count: outrosCount, valor: outrosValor, pct: Math.round((outrosCount / total) * 100) }
    };
  }, [activeOpportunities]);

  // Registro de Preço (SRP)
  const srpStats = useMemo(() => {
    let srp = 0;
    let normal = 0;

    for (const op of activeOpportunities) {
      if (op.registroPreco === true) {
        srp++;
      } else {
        normal++;
      }
    }

    const total = activeOpportunities.length || 1;
    return {
      srp,
      srpPct: Math.round((srp / total) * 100),
      normal,
      normalPct: Math.round((normal / total) * 100)
    };
  }, [activeOpportunities]);

  // Prazos / Urgência
  const prazosStats = useMemo(() => {
    let critico = 0; // <= 1 dia
    let proximo = 0; // 2 a 3 dias
    let confortavel = 0; // > 3 dias
    let expiradoOuSemPrazo = 0;

    const now = Date.now();

    for (const op of activeOpportunities) {
      if (typeof op.diasRestantes === 'number') {
        if (op.diasRestantes <= 1 && op.diasRestantes >= 0) critico++;
        else if (op.diasRestantes <= 3 && op.diasRestantes > 1) proximo++;
        else if (op.diasRestantes > 3) confortavel++;
        else expiradoOuSemPrazo++;
      } else if (op.dataEncerramentoProposta) {
        const diffMs = Date.parse(op.dataEncerramentoProposta) - now;
        const dias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (dias <= 1 && dias >= 0) critico++;
        else if (dias <= 3 && dias > 1) proximo++;
        else if (dias > 3) confortavel++;
        else expiradoOuSemPrazo++;
      } else {
        expiradoOuSemPrazo++;
      }
    }

    return { critico, proximo, confortavel, expiradoOuSemPrazo };
  }, [activeOpportunities]);

  // Top 5 UFs
  const topUfs = useMemo(() => {
    const map = new Map<string, number>();
    for (const op of activeOpportunities) {
      const uf = op.uf?.trim().toUpperCase() || 'N/I';
      map.set(uf, (map.get(uf) ?? 0) + 1);
    }

    const sorted = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const max = sorted[0]?.[1] || 1;
    return sorted.map(([uf, count]) => ({
      uf,
      count,
      pctOfMax: Math.round((count / max) * 100)
    }));
  }, [activeOpportunities]);

  // Análises finalizadas
  const analysisCompleted = useMemo(() => {
    return analysisJobs.filter(job => /conclu|finaliz|pronto|sucesso|complet|done/i.test(job.status)).length;
  }, [analysisJobs]);

  const hasResults = results.length > 0;

  return (
    <section className="dashboard-root" aria-label="Painel de controle e sumarização">
      {/* Barra de Título do Dashboard */}
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-title">Painel de Controle</h2>
          <p className="dashboard-subtitle">
            {hasResults
              ? `Sumarização de ${activeOpportunities.length} oportunidades ativas encontradas na consulta`
              : 'Visão geral do sistema e atalhos rápidos'}
          </p>
        </div>
      </div>

      {/* Grid de Cartões de Métricas Principais (KPIs) */}
      <div className="dashboard-kpis">
        {/* Total Oportunidades */}
        <div className="dashboard-kpi-card kpi-opportunities">
          <div className="kpi-icon-wrapper">📦</div>
          <div className="kpi-content">
            <span className="kpi-label">Oportunidades</span>
            <div className="kpi-value">{hasResults ? activeOpportunities.length : '—'}</div>
            <span className="kpi-hint">
              {hasResults
                ? `${discardedKeySet.size} descartadas ocultas`
                : 'Faça uma busca nos filtros'}
            </span>
          </div>
        </div>

        {/* Volume Financeiro Total */}
        <div className="dashboard-kpi-card kpi-finance">
          <div className="kpi-icon-wrapper">💰</div>
          <div className="kpi-content">
            <span className="kpi-label">Volume Estimado</span>
            <div className="kpi-value" title={formatBRL(totalValor)}>
              {hasResults ? formatCompactBRL(totalValor) : '—'}
            </div>
            <span className="kpi-hint">
              {hasResults ? `${sigilosoCount} sigilosos · ${divulgadoCount} divulgados` : 'Aguardando busca'}
            </span>
          </div>
        </div>

        {/* Propostas Cadastradas / Agenda */}
        <div
          className="dashboard-kpi-card kpi-clickable kpi-calendar"
          onClick={onOpenCalendar}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenCalendar(); } }}
          title="Clique para abrir a Agenda de Propostas Cadastradas"
        >
          <div className="kpi-icon-wrapper">📅</div>
          <div className="kpi-content">
            <span className="kpi-label">Agenda Cadastrada</span>
            <div className="kpi-value">{registered.length}</div>
          </div>
        </div>

        {/* Favoritos */}
        <div
          className="dashboard-kpi-card kpi-clickable kpi-favorites"
          onClick={onOpenFavorites}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenFavorites(); } }}
          title="Clique para ver os Favoritos salvos"
        >
          <div className="kpi-icon-wrapper">★</div>
          <div className="kpi-content">
            <span className="kpi-label">Favoritos Salvos</span>
            <div className="kpi-value">{favorites.length}</div>
          </div>
        </div>

        {/* Análises IA */}
        <div
          className="dashboard-kpi-card kpi-clickable kpi-analysis"
          onClick={onOpenAnalysis}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenAnalysis(); } }}
          title="Clique para ver as Análises de Editais"
        >
          <div className="kpi-icon-wrapper">🤖</div>
          <div className="kpi-content">
            <span className="kpi-label">Análises de Editais</span>
            <div className="kpi-value">{analysisJobs.length}</div>
            <span className="kpi-hint">
              {analysisJobs.length > 0 ? `${analysisCompleted} concluídas` : 'Nenhuma análise'}
            </span>
          </div>
        </div>

        {/* Descartadas */}
        <div
          className="dashboard-kpi-card kpi-clickable kpi-discarded"
          onClick={onOpenDiscarded}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDiscarded(); } }}
          title="Clique para ver as Propostas Descartadas"
        >
          <div className="kpi-icon-wrapper">🗑️</div>
          <div className="kpi-content">
            <span className="kpi-label">Descartadas</span>
            <div className="kpi-value">{discarded.length}</div>
          </div>
        </div>
      </div>

      {/* Se houver resultados, exibe o detalhamento sumarizado */}
      {hasResults ? (
        <div className="dashboard-grid">
          {/* Card: Modalidades */}
          <div className="dashboard-widget">
            <div className="widget-header">
              <span className="widget-title">Distribuição por Modalidade</span>
              <span className="widget-badge">{activeOpportunities.length} editais</span>
            </div>
            <div className="widget-body">
              <div className="modality-row">
                <div className="modality-info">
                  <span className="modality-name">Pregão Eletrônico</span>
                  <span className="modality-val">{formatCompactBRL(modalidadesStats.pregao.valor)}</span>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-fill pregao-fill" style={{ width: `${modalidadesStats.pregao.pct}%` }} />
                </div>
                <div className="modality-meta">
                  <span>{modalidadesStats.pregao.count} editais</span>
                  <span>{modalidadesStats.pregao.pct}%</span>
                </div>
              </div>

              <div className="modality-row">
                <div className="modality-info">
                  <span className="modality-name">Dispensa Eletrônica / Outras</span>
                  <span className="modality-val">{formatCompactBRL(modalidadesStats.dispensa.valor)}</span>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-fill dispensa-fill" style={{ width: `${modalidadesStats.dispensa.pct}%` }} />
                </div>
                <div className="modality-meta">
                  <span>{modalidadesStats.dispensa.count} editais</span>
                  <span>{modalidadesStats.dispensa.pct}%</span>
                </div>
              </div>

              {modalidadesStats.outros.count > 0 ? (
                <div className="modality-row">
                  <div className="modality-info">
                    <span className="modality-name">Outras Modalidades</span>
                    <span className="modality-val">{formatCompactBRL(modalidadesStats.outros.valor)}</span>
                  </div>
                  <div className="progress-bar-wrap">
                    <div className="progress-fill outros-fill" style={{ width: `${modalidadesStats.outros.pct}%` }} />
                  </div>
                  <div className="modality-meta">
                    <span>{modalidadesStats.outros.count} editais</span>
                    <span>{modalidadesStats.outros.pct}%</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Card: Prazos e Urgência */}
          <div className="dashboard-widget">
            <div className="widget-header">
              <span className="widget-title">Urgência de Encerramento</span>
              <span className="widget-badge">Prazos</span>
            </div>
            <div className="widget-body urgency-body">
              <div className="urgency-pill urgency-critical">
                <div className="urgency-count">{prazosStats.critico}</div>
                <div className="urgency-label">Crítico (≤ 24h)</div>
              </div>
              <div className="urgency-pill urgency-warning">
                <div className="urgency-count">{prazosStats.proximo}</div>
                <div className="urgency-label">Atenção (1 a 3 dias)</div>
              </div>
              <div className="urgency-pill urgency-normal">
                <div className="urgency-count">{prazosStats.confortavel}</div>
                <div className="urgency-label">Confortável (&gt; 3 dias)</div>
              </div>
              <div className="urgency-pill urgency-muted">
                <div className="urgency-count">{prazosStats.expiradoOuSemPrazo}</div>
                <div className="urgency-label">Encerrado / Sem prazo</div>
              </div>
            </div>
          </div>

          {/* Card: Registro de Preço & Transparência */}
          <div className="dashboard-widget">
            <div className="widget-header">
              <span className="widget-title">Regime e Transparência</span>
              <span className="widget-badge">Características</span>
            </div>
            <div className="widget-body features-body">
              <div className="feature-metric">
                <span className="feature-label">Registro de Preços (SRP)</span>
                <span className="feature-value">{srpStats.srp} ({srpStats.srpPct}%)</span>
              </div>
              <div className="feature-metric">
                <span className="feature-label">Compra Tradicional (Não-SRP)</span>
                <span className="feature-value">{srpStats.normal} ({srpStats.normalPct}%)</span>
              </div>
              <div className="feature-divider" />
              <div className="feature-metric">
                <span className="feature-label">Valor Divulgado</span>
                <span className="feature-value">{divulgadoCount} ({Math.round((divulgadoCount / (activeOpportunities.length || 1)) * 100)}%)</span>
              </div>
              <div className="feature-metric">
                <span className="feature-label">Valor Sigiloso</span>
                <span className="feature-value">{sigilosoCount} ({Math.round((sigilosoCount / (activeOpportunities.length || 1)) * 100)}%)</span>
              </div>
              {divulgadoCount > 0 ? (
                <div className="feature-metric feature-average">
                  <span className="feature-label">Média por Edital Divulgado</span>
                  <span className="feature-value highlight">{formatCompactBRL(mediaValor)}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Card: Top UFs */}
          <div className="dashboard-widget">
            <div className="widget-header">
              <span className="widget-title">Top Estados (UFs)</span>
              <span className="widget-badge">Geográfico</span>
            </div>
            <div className="widget-body ufs-body">
              {topUfs.length > 0 ? (
                topUfs.map(({ uf, count, pctOfMax }) => (
                  <div key={uf} className="uf-row">
                    <span className="uf-tag">{uf}</span>
                    <div className="uf-bar-track">
                      <div className="uf-bar-fill" style={{ width: `${pctOfMax}%` }} />
                    </div>
                    <span className="uf-count">{count} {count === 1 ? 'edital' : 'editais'}</span>
                  </div>
                ))
              ) : (
                <div className="empty-subtext">Sem dados de localização.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Barra de Filtros Rápidos na listagem de oportunidades */}
      {hasResults ? (
        <div className="dashboard-quick-filters" aria-label="Filtros rápidos na listagem">
          <span className="quick-filters-label">Filtrar lista:</span>
          <div className="quick-filter-buttons">
            <button
              type="button"
              className={`filter-btn ${activeFilter === null ? 'active' : ''}`}
              onClick={() => onSelectFilter(null)}
            >
              Todos ({activeOpportunities.length})
            </button>
            <button
              type="button"
              className={`filter-btn ${activeFilter === 'pregao' ? 'active' : ''}`}
              onClick={() => onSelectFilter('pregao')}
            >
              Pregão Eletrônico ({modalidadesStats.pregao.count})
            </button>
            <button
              type="button"
              className={`filter-btn ${activeFilter === 'dispensas' ? 'active' : ''}`}
              onClick={() => onSelectFilter('dispensas')}
            >
              Dispensas ({modalidadesStats.dispensa.count})
            </button>
            <button
              type="button"
              className={`filter-btn ${activeFilter === 'srp' ? 'active' : ''}`}
              onClick={() => onSelectFilter('srp')}
            >
              Registro de Preços ({srpStats.srp})
            </button>
            <button
              type="button"
              className={`filter-btn ${activeFilter === 'sigiloso' ? 'active' : ''}`}
              onClick={() => onSelectFilter('sigiloso')}
            >
              Sigiloso ({sigilosoCount})
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
