import { useMemo, useState } from 'react';
import type { OportunidadeResultado } from '../types';
import { getProposalKey, type AnalysisJob } from '../api';
import ResultCard from './ResultCard';
import { getLocalDateKey, getProposalDateKey, getUpcomingProposals } from '../scheduledProposals';

interface CalendarPageProps {
  proposals: OportunidadeResultado[];
  onUnregister: (proposal: OportunidadeResultado) => void;
  isUnregistering: (proposal: OportunidadeResultado) => boolean;
  isDiscarded: (proposal: OportunidadeResultado) => boolean;
  onToggleDiscard: (proposal: OportunidadeResultado) => void;
  onAnalyze: (proposal: OportunidadeResultado) => void;
  onCancelAnalysis: (proposal: OportunidadeResultado) => void;
  isAnalysisStarting: (proposal: OportunidadeResultado) => boolean;
  isAnalysisCancelling: (proposal: OportunidadeResultado) => boolean;
  getAnalysisJob: (proposal: OportunidadeResultado) => AnalysisJob | undefined;
  onStatusUpdated: (key: string, situacao: string) => void;
  error: string | null;
  onBack: () => void;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function CalendarPage({
  proposals,
  onUnregister,
  isUnregistering,
  isDiscarded,
  onToggleDiscard,
  onAnalyze,
  onCancelAnalysis,
  isAnalysisStarting,
  isAnalysisCancelling,
  getAnalysisJob,
  onStatusUpdated,
  error,
  onBack
}: CalendarPageProps) {
  const today = new Date();
  const todayKey = getLocalDateKey(today);
  const upcomingProposals = useMemo(
    () => getUpcomingProposals(proposals, todayKey),
    [proposals, todayKey]
  );

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

  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const renderProposalCard = (proposal: OportunidadeResultado, index: number) => (
    <ResultCard
      key={getProposalKey(proposal) ?? proposal.idContratacaoPNCP ?? `${proposal.numeroCompra ?? 'proposta'}-${index}`}
      result={proposal}
      isRegistering={isUnregistering(proposal)}
      isDiscarded={isDiscarded(proposal)}
      isRegistered
      onToggleRegister={onUnregister}
      onToggleDiscard={onToggleDiscard}
      onAnalyze={onAnalyze}
      onCancelAnalysis={onCancelAnalysis}
      analysisStarting={isAnalysisStarting(proposal)}
      analysisCancelling={isAnalysisCancelling(proposal)}
      analysisJob={getAnalysisJob(proposal)}
      onStatusUpdated={onStatusUpdated}
    />
  );

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
      {error ? <div className="status-card status-error" role="alert">{error}</div> : null}
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
            {selectedProposals.map(renderProposalCard)}
          </div>
        </div>
      ) : null}

      <div className="calendar-all-proposals">
        <h3>Todas as propostas agendadas ({upcomingProposals.length})</h3>
        {upcomingProposals.length === 0 ? (
          <div className="status-card">Nenhuma proposta agendada para hoje ou datas futuras.</div>
        ) : (
          <div className="calendar-proposal-list">
            {upcomingProposals.map(renderProposalCard)}
          </div>
        )}
      </div>
    </section>
  );
}
