import { useMemo, useState } from 'react';
import { copyText } from '../copyText';
import { formatDateTime } from '../format';
import type { OportunidadeResultado } from '../types';
import { getProposalKey } from '../api';

interface CalendarPageProps {
  proposals: OportunidadeResultado[];
  onUnregister: (proposal: OportunidadeResultado) => void;
  onViewProposal: (proposal: OportunidadeResultado) => void;
  onBack: () => void;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function getProposalDateKey(proposal: OportunidadeResultado): string | null {
  const raw = proposal.dataEncerramentoProposta ?? proposal.dataAberturaProposta ?? proposal.dataPublicacao;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function CalendarPage({ proposals, onUnregister, onViewProposal, onBack }: CalendarPageProps) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const upcomingProposals = useMemo(() => proposals.filter(proposal => {
    const dateKey = getProposalDateKey(proposal);
    return dateKey !== null && dateKey >= todayKey;
  }), [proposals, todayKey]);

  // Mapa de data 'YYYY-MM-DD' -> propostas
  const proposalsByDate = useMemo(() => {
    const map = new Map<string, OportunidadeResultado[]>();
    for (const p of upcomingProposals) {
      const dateKey = getProposalDateKey(p);
      if (!dateKey) continue;
      const list = map.get(dateKey) ?? [];
      list.push(p);
      map.set(dateKey, list);
    }
    return map;
  }, [upcomingProposals]);

  // Encontra o mês inicial baseado na primeira data com proposta futura ou presente, senão o mês atual
  const initialDate = useMemo(() => {
    const today = new Date();
    const sortedDates = Array.from(proposalsByDate.keys()).sort();
    const target = sortedDates[0];
    if (target) {
      const [y, m] = target.split('-').map(Number);
      return new Date(y, m - 1, 1);
    }
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }, [proposalsByDate]);

  const [currentMonth, setCurrentMonth] = useState<Date>(initialDate);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const copyProposalLink = async (p: OportunidadeResultado) => {
    if (!p.cadastroProposta) return;
    const key = getProposalKey(p) ?? p.numeroCompra ?? '';
    try {
      await copyText(p.cadastroProposta);
      setCopyError(null);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 2000);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'Não foi possível copiar o link da proposta.');
    }
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const prevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  // Matriz de dias para o mês (colunas: Dom=0 até Sáb=6)
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Domingo
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: Array<{
      dateKey: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      hasProposals: boolean;
      count: number;
      isToday: boolean;
    }> = [];

    // Dias vazios / preenchimento antes do primeiro dia
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const prevDate = new Date(year, month - 1, d);
      const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        dateKey: prevKey,
        dayNumber: d,
        isCurrentMonth: false,
        hasProposals: proposalsByDate.has(prevKey),
        count: proposalsByDate.get(prevKey)?.length ?? 0,
        isToday: prevKey === todayKey
      });
    }

    // Dias do mês atual
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const list = proposalsByDate.get(key);
      days.push({
        dateKey: key,
        dayNumber: d,
        isCurrentMonth: true,
        hasProposals: Boolean(list && list.length > 0),
        count: list?.length ?? 0,
        isToday: key === todayKey
      });
    }

    // Preenchimento após o final do mês para fechar a última semana
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const nextDate = new Date(year, month + 1, d);
        const nextKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        days.push({
          dateKey: nextKey,
          dayNumber: d,
          isCurrentMonth: false,
          hasProposals: proposalsByDate.has(nextKey),
          count: proposalsByDate.get(nextKey)?.length ?? 0,
          isToday: nextKey === todayKey
        });
      }
    }

    return days;
  }, [year, month, proposalsByDate, todayKey]);

  const selectedProposals = selectedDate ? (proposalsByDate.get(selectedDate) ?? []) : [];

  return (
    <section className="settings-page calendar-page">
      {copyError ? <p className="login-error" role="alert">{copyError}</p> : null}
      <div className="calendar-header-row">
        <div>
          <h2>Propostas agendadas</h2>
          <p className="filter-hint">
            {upcomingProposals.length === 0
              ? 'Nenhuma proposta agendada para hoje ou datas futuras. Use o botão "Agendar proposta" nos resultados da pesquisa para adicionar.'
              : `${upcomingProposals.length} proposta${upcomingProposals.length === 1 ? '' : 's'} agendada${upcomingProposals.length === 1 ? '' : 's'} para hoje ou datas futuras.`}
          </p>
        </div>
        <button type="button" className="logout-button logout-icon" onClick={onBack} aria-label="Voltar" title="Voltar">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m12 19-7-7 7-7M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="calendar-container">
        <div className="calendar-month-bar">
          <div className="calendar-month-nav-group">
            <button type="button" className="calendar-nav-btn" onClick={prevMonth} aria-label="Mês anterior">
              ‹
            </button>
            <h3>{MONTH_NAMES[month]} de {year}</h3>
            <button type="button" className="calendar-nav-btn" onClick={nextMonth} aria-label="Próximo mês">
              ›
            </button>
          </div>
          <button type="button" className="calendar-today-btn" onClick={goToToday} title="Ir para o mês atual">
            Hoje
          </button>
        </div>

        <div className="calendar-grid">
          {WEEKDAYS.map((wd, index) => (
            <div key={wd} className={`calendar-weekday-cell ${index === 0 ? 'is-sunday' : index === 6 ? 'is-saturday' : ''}`}>
              {wd}
            </div>
          ))}

          {calendarDays.map(day => {
            const isSelected = selectedDate === day.dateKey;
            const isClickable = day.hasProposals;

            return (
              <button
                key={day.dateKey}
                type="button"
                className={`calendar-day-cell ${
                  !day.isCurrentMonth ? 'is-other-month' : ''
                } ${day.hasProposals ? 'has-proposals' : 'is-disabled'} ${
                  day.isToday ? 'is-today' : ''
                } ${isSelected ? 'is-selected' : ''}`}
                disabled={!isClickable}
                onClick={() => {
                  if (day.hasProposals) {
                    setSelectedDate(current => current === day.dateKey ? null : day.dateKey);
                  }
                }}
                title={
                  day.isToday
                    ? `Hoje (${day.hasProposals ? `${day.count} proposta${day.count === 1 ? '' : 's'} agendada${day.count === 1 ? '' : 's'}` : 'sem propostas agendadas'})`
                    : day.hasProposals
                    ? `${day.count} proposta${day.count === 1 ? '' : 's'} agendada${day.count === 1 ? '' : 's'}`
                    : 'Sem propostas agendadas'
                }
              >
                <div className="day-cell-top">
                  <span className="day-number">{day.dayNumber}</span>
                  {day.isToday ? <span className="today-badge">Hoje</span> : null}
                </div>
                {day.hasProposals ? (
                  <span className="day-badge">{day.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate ? (
        <div className="calendar-selected-section">
          <h3>
            Propostas do dia {selectedDate.split('-').reverse().join('/')} ({selectedProposals.length})
          </h3>
          <div className="calendar-proposals-list">
            {selectedProposals.map(p => {
              const link = p.linkContratacao ?? p.linkSistemaOrigem;
              return (
                <article key={getProposalKey(p) ?? p.numeroCompra ?? Math.random()} className="calendar-proposal-card">
                  <header>
                    <span className="calendar-proposal-status">Agendada</span>
                    <strong>{p.unidadeCompradora ?? p.orgao ?? 'Proposta'}</strong>
                    <span>{p.numeroCompra}</span>
                  </header>
                  <dl>
                    <dt>resumo do objeto</dt>
                    <dd className="calendar-proposal-object" title={p.objeto ?? undefined}>{p.objeto ?? '—'}</dd>
                    <dt>valor do edital</dt>
                    <dd className="calendar-proposal-value">{p.valor ?? '—'}</dd>
                    <dt>abertura da sessão</dt>
                    <dd>{formatDateTime(p.dataEncerramentoProposta)}</dd>
                    <dt>local</dt>
                    <dd>{p.local ?? '—'}</dd>
                  </dl>
                  <div className="card-discard-row">
                    <button type="button" className="discard-toggle" onClick={() => onViewProposal(p)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <span>Visualizar edital</span>
                    </button>
                    {link ? (
                      <a
                        className="discard-toggle pncp-link"
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        title={p.linkContratacao ? 'Ver no PNCP' : 'Ver proposta'}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <path d="M15 3h6v6" />
                          <path d="M10 14L21 3" />
                        </svg>
                        <span>{p.linkContratacao ? 'Ver no PNCP' : 'Ver proposta'}</span>
                      </a>
                    ) : null}
                    {p.cadastroProposta ? (
                      <button
                        type="button"
                        className="discard-toggle action-link"
                        onClick={() => void copyProposalLink(p)}
                        aria-label={copiedKey === (getProposalKey(p) ?? p.numeroCompra) ? 'Link copiado' : 'Copiar link da proposta'}
                        title={copiedKey === (getProposalKey(p) ?? p.numeroCompra) ? 'Link copiado' : 'Copiar link da proposta'}
                      >
                        {copiedKey === (getProposalKey(p) ?? p.numeroCompra) ? 'Copiado' : 'Link da proposta'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="discard-toggle"
                      onClick={() => onUnregister(p)}
                      title="Remover das propostas agendadas"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                      <span>Desagendar proposta</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="calendar-all-proposals">
        <h3>Todas as propostas agendadas ({upcomingProposals.length})</h3>
        {upcomingProposals.length === 0 ? (
          <div className="status-card">Nenhuma proposta agendada para hoje ou datas futuras.</div>
        ) : (
          <div className="calendar-proposal-list">
            {upcomingProposals.map(p => {
              const link = p.linkContratacao ?? p.linkSistemaOrigem;
              return (
                <article key={getProposalKey(p) ?? p.numeroCompra ?? Math.random()} className="calendar-proposal-card">
                  <header>
                    <span className="calendar-proposal-status">Agendada</span>
                    <strong>{p.unidadeCompradora ?? p.orgao ?? 'Proposta'}</strong>
                    <span>{p.numeroCompra}</span>
                  </header>
                  <dl>
                    <dt>resumo do objeto</dt>
                    <dd className="calendar-proposal-object" title={p.objeto ?? undefined}>{p.objeto ?? '—'}</dd>
                    <dt>valor do edital</dt>
                    <dd className="calendar-proposal-value">{p.valor ?? '—'}</dd>
                    <dt>abertura da sessão</dt>
                    <dd>{formatDateTime(p.dataEncerramentoProposta)}</dd>
                    <dt>local</dt>
                    <dd>{p.local ?? '—'}</dd>
                  </dl>
                  <div className="card-discard-row">
                    <button type="button" className="discard-toggle" onClick={() => onViewProposal(p)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <span>Visualizar edital</span>
                    </button>
                    {link ? (
                      <a
                        className="discard-toggle pncp-link"
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        title={p.linkContratacao ? 'Ver no PNCP' : 'Ver proposta'}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <path d="M15 3h6v6" />
                          <path d="M10 14L21 3" />
                        </svg>
                        <span>{p.linkContratacao ? 'Ver no PNCP' : 'Ver proposta'}</span>
                      </a>
                    ) : null}
                    {p.cadastroProposta ? (
                      <button
                        type="button"
                        className="discard-toggle action-link"
                        onClick={() => void copyProposalLink(p)}
                        aria-label={copiedKey === (getProposalKey(p) ?? p.numeroCompra) ? 'Link copiado' : 'Copiar link da proposta'}
                        title={copiedKey === (getProposalKey(p) ?? p.numeroCompra) ? 'Link copiado' : 'Copiar link da proposta'}
                      >
                        {copiedKey === (getProposalKey(p) ?? p.numeroCompra) ? 'Copiado' : 'Link da proposta'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="discard-toggle"
                      onClick={() => onUnregister(p)}
                      title="Remover das propostas agendadas"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                      <span>Desagendar proposta</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
