import { useEffect, useState } from 'react';
import { fetchResultados, WebhookPopupError } from './api';
import type { PregaoResultado } from './types';
import ResultCard from './components/ResultCard';

interface FetchFilters {
  ufs?: string;
}

const TODAS_UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

function FilterControls({ onFilterChange }: { onFilterChange: (filters: FetchFilters) => void }) {
  const [ufs, setUfs] = useState<string[]>([]);

  const handleApplyFilters = () => {
    if (ufs.length === 0) return;

    const filters: FetchFilters = {
      ufs: ufs.join(','),
    };
    onFilterChange(filters);
  };

  const toggleUf = (uf: string) => {
    setUfs(prev => prev.includes(uf) ? prev.filter(u => u !== uf) : [...prev, uf]);
  };

  const selectAllUfs = () => {
    setUfs(prev => prev.length === TODAS_UFS.length ? [] : TODAS_UFS);
  };

  return (
    <aside className="sidebar">
      <section className="filter-controls">
        <h3>Filtros</h3>

        <div className="filter-group">
          <label>
            UFs: <button type="button" className="btn-select-all" onClick={selectAllUfs}>
              {ufs.length === TODAS_UFS.length ? 'Desmarcar todas' : 'Selecionar todas'}
            </button>
          </label>
          <div className="uf-checkboxes">
            {TODAS_UFS.map(uf => (
              <label key={uf} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={ufs.includes(uf)}
                  onChange={() => toggleUf(uf)}
                />
                <span>{uf}</span>
              </label>
            ))}
          </div>
        </div>

        <button onClick={handleApplyFilters} className="btn-apply-filters">
          Aplicar Filtros
        </button>
      </section>
    </aside>
  );
}

function Header() {
  return (
    <header className="hero">
      <div>
        <p className="eyebrow">GALAX Suport</p>
        <h1>Pregões TIC</h1>
        <p className="hero-copy">
          Interface moderna para listar os dados retornados do Portal de Compras do Governo Federal realacionados a TIC.
        </p>
      </div>
    </header>
  );
}

function Summary({ total }: { total: number }) {
  return (
    <section className="summary-bar">
      <div>
        <p className="summary-label">Registros carregados</p>
        <p className="summary-value">{total}</p>
      </div>
      <p className="summary-note">Os dados são consumidos diretamente de um webhook n8n.</p>
    </section>
  );
}

function WebhookErrorPopup({
  title,
  message,
  sample,
  onClose
}: {
  title: string;
  message: string;
  sample: string | null;
  onClose: () => void;
}) {
  return (
    <div className="webhook-popup-backdrop">
      <section
        className="webhook-popup"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="webhook-popup-title"
        aria-describedby="webhook-popup-message"
      >
        <p className="eyebrow">Consulta indisponível</p>
        <h2 id="webhook-popup-title">{title}</h2>
        <p id="webhook-popup-message">{message}</p>
        {sample ? (
          <div className="webhook-popup-sample">
            <h3>Amostra</h3>
            <pre>{sample}</pre>
          </div>
        ) : null}
        <button autoFocus className="btn-apply-filters" onClick={onClose}>
          Fechar
        </button>
      </section>
    </div>
  );
}

function App() {
  const [resultados, setResultados] = useState<PregaoResultado[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [popupError, setPopupError] = useState<{ title: string; message: string; sample: string | null } | null>(null);
  const [filters, setFilters] = useState<FetchFilters | null>(null);

  useEffect(() => {
    if (!filters?.ufs) return;
    const activeFilters = filters;

    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setResultados([]);
        setError(null);
        setPopupError(null);
        setLoadingStep('Iniciando busca...');
        
        // Simula etapas de progresso
        const steps = [
          'Conectando ao webhook...',
          'Buscando páginas da API PNCP...',
          'Filtrando oportunidades TIC...',
          'Removendo duplicatas...',
          'Preparando resultados...'
        ];
        
        let stepIndex = 0;
        const progressInterval = setInterval(() => {
          if (stepIndex < steps.length - 1) {
            stepIndex++;
            setLoadingStep(steps[stepIndex]);
          }
        }, 2000);

        const data = await fetchResultados(activeFilters, controller.signal);
        
        clearInterval(progressInterval);
        setLoadingStep('Finalizando...');
        
        if (!cancelled) {
          setResultados(data);
        }
      } catch (err) {
        if (!cancelled && err instanceof WebhookPopupError) {
          setPopupError({ title: err.title, message: err.message, sample: err.sample });
        } else if (!cancelled && err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingStep('');
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters]);

  const handleFilterChange = (newFilters: FetchFilters) => {
    setFilters(newFilters);
  };

  return (
    <div className="app-layout">
      <FilterControls onFilterChange={handleFilterChange} />

      {popupError ? (
        <WebhookErrorPopup
          title={popupError.title}
          message={popupError.message}
          sample={popupError.sample}
          onClose={() => setPopupError(null)}
        />
      ) : null}

      <main className="page-shell">
        <Header />

        {loading ? (
          <div className="status-card loading-progress">
            <div className="spinner"></div>
            <p>{loadingStep || 'Carregando dados...'}</p>
          </div>
        ) : null}

        {error ? (
          <div className="status-card status-error" role="alert">
            {resultados.length > 0
              ? `A consulta atual falhou: ${error} Exibindo ${resultados.length} resultados da consulta anterior, que podem não corresponder aos filtros atuais.`
              : error}
          </div>
        ) : null}

        {resultados.length > 0 ? (
          <>
            <Summary total={resultados.length} />
            <section className="cards-shell">
              {resultados.map((item, index) => (
                <ResultCard
                  key={item.tipoSaida === 'oportunidade'
                    ? `${item.idContratacaoPNCP ?? index}-${item.local ?? 'unknown'}`
                    : `resumo-${index}`}
                  result={item}
                />
              ))}
            </section>
          </>
        ) : !loading && !error ? (
          <div className="status-card">Nenhum resultado disponível.</div>
        ) : null}
      </main>
    </div>
  );
}

export default App;
