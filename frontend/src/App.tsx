import { useEffect, useState } from 'react';
import { fetchResultados, WebhookPopupError } from './api';
import type { OportunidadeResultado, PregaoResultado } from './types';
import ResultCard from './components/ResultCard';

const FAVORITES_STORAGE_KEY = 'comprasgov:favorites';

function getFavoriteKey(result: OportunidadeResultado): string | null {
  if (result.idContratacaoPNCP) return `id:${result.idContratacaoPNCP}`;
  if (result.linkContratacao) return `link:${result.linkContratacao}`;
  return null;
}

function readFavorites(): OportunidadeResultado[] {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];

    return saved.filter((item): item is OportunidadeResultado =>
      item?.tipoSaida === 'oportunidade' && Boolean(item.idContratacaoPNCP || item.linkContratacao)
    );
  } catch {
    return [];
  }
}

interface FetchFilters {
  ufs?: string;
}

const TODAS_UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

const REGIOES = {
  Norte: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'],
  Sudeste: ['ES', 'MG', 'RJ', 'SP'],
  Sul: ['PR', 'RS', 'SC']
} as const;

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

  const toggleRegiao = (regiao: readonly string[]) => {
    setUfs(prev => regiao.every(uf => prev.includes(uf))
      ? prev.filter(uf => !regiao.includes(uf))
      : Array.from(new Set([...prev, ...regiao]))
    );
  };

  return (
    <aside className="sidebar">
      <section className="filter-controls">
        <h3>Filtros</h3>

        <div className="filter-group">
          <div className="region-groups">
            {Object.entries(REGIOES).map(([nome, regiao]) => {
              const regiaoSelecionada = regiao.every(uf => ufs.includes(uf));

              return (
                <div key={nome} className="region-group">
                  <div className="region-heading">
                    <span>{nome}</span>
                    <button
                      type="button"
                      className="btn-region"
                      onClick={() => toggleRegiao(regiao)}
                    >
                      {regiaoSelecionada ? 'Desmarcar' : 'Selecionar'}
                    </button>
                  </div>
                  <div className="uf-checkboxes">
                    {regiao.map(uf => (
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
              );
            })}
          </div>
        </div>

        <button onClick={handleApplyFilters} className="btn-apply-filters">
          Aplicar Filtros
        </button>
      </section>
    </aside>
  );
}

function Header({
  showFavorites,
  favoritesCount,
  onToggleFavorites
}: {
  showFavorites: boolean;
  favoritesCount: number;
  onToggleFavorites: () => void;
}) {
  return (
    <header className="hero">
      <div>
        <p className="eyebrow">GALAX Suport</p>
        <h1>Pregões TIC</h1>
        <p className="hero-copy">
          Interface moderna para listar os dados retornados do Portal de Compras do Governo Federal realacionados a TIC.
        </p>
      </div>
      <button
        type="button"
        className={`favorites-toggle${showFavorites ? ' is-active' : ''}`}
        onClick={onToggleFavorites}
        aria-pressed={showFavorites}
        aria-label={`${showFavorites ? 'Voltar aos resultados' : 'Abrir favoritos'}, ${favoritesCount} salvos`}
        title={showFavorites ? 'Voltar aos resultados' : 'Abrir favoritos'}
      >
        <span className="favorites-toggle-icon" aria-hidden="true">★</span>
        <span className="favorites-count" aria-hidden="true">{favoritesCount}</span>
      </button>
    </header>
  );
}

type SummaryFilter = 'dispensas' | 'pregao' | 'sigiloso' | 'srp' | null;

function matchesSummaryFilter(result: PregaoResultado, filter: SummaryFilter): boolean {
  if (!filter) return true;
  if (result.tipoSaida !== 'oportunidade') return false;

  const modalidade = result.modalidade?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() ?? '';

  switch (filter) {
    case 'dispensas':
      return result.codigoModalidade === 8 || modalidade.includes('dispensa');
    case 'pregao':
      return modalidade.includes('pregao') && modalidade.includes('eletronico');
    case 'sigiloso':
      return result.valor?.trim().toLowerCase() === 'sigiloso';
    case 'srp':
      return result.registroPreco === true;
  }
}

function Summary({
  results,
  favoritesView,
  activeFilter,
  onSelectFilter
}: {
  results: PregaoResultado[];
  favoritesView: boolean;
  activeFilter: SummaryFilter;
  onSelectFilter: (filter: SummaryFilter) => void;
}) {
  const count = (filter: SummaryFilter) => results.filter(result => matchesSummaryFilter(result, filter)).length;

  return (
    <section className="summary-bar">
      <button
        type="button"
        className={`summary-metric${activeFilter === 'dispensas' ? ' is-active' : ''}`}
        aria-pressed={activeFilter === 'dispensas'}
        onClick={() => onSelectFilter('dispensas')}
      >
        <p className="summary-label">Dispensas</p>
        <p className="summary-value">{count('dispensas')}</p>
      </button>
      <button
        type="button"
        className={`summary-metric${activeFilter === 'pregao' ? ' is-active' : ''}`}
        aria-pressed={activeFilter === 'pregao'}
        onClick={() => onSelectFilter('pregao')}
      >
        <p className="summary-label">Pregão</p>
        <p className="summary-value">{count('pregao')}</p>
      </button>
      <button
        type="button"
        className={`summary-metric${activeFilter === 'sigiloso' ? ' is-active' : ''}`}
        aria-pressed={activeFilter === 'sigiloso'}
        onClick={() => onSelectFilter('sigiloso')}
      >
        <p className="summary-label">Sigiloso</p>
        <p className="summary-value">{count('sigiloso')}</p>
      </button>
      <button
        type="button"
        className={`summary-metric${activeFilter === 'srp' ? ' is-active' : ''}`}
        aria-pressed={activeFilter === 'srp'}
        onClick={() => onSelectFilter('srp')}
      >
        <p className="summary-label">SRP</p>
        <p className="summary-value">{count('srp')}</p>
      </button>
      <button
        type="button"
        className={`summary-metric${activeFilter === null ? ' is-active' : ''}`}
        aria-pressed={activeFilter === null}
        onClick={() => onSelectFilter(null)}
      >
        <p className="summary-label">{favoritesView ? 'Favoritos salvos' : 'Total'}</p>
        <p className="summary-value">{results.length}</p>
      </button>
      <p className="summary-note">
        {favoritesView ? 'Oportunidades armazenadas neste navegador.' : 'Os dados são consumidos diretamente do PNCP.'}
      </p>
    </section>
  );
}

function BackToTopButton() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setIsVisible(window.scrollY > 240);
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

  if (!isVisible) return null;

  const scrollToTop = () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  };

  return (
    <button
      type="button"
      className="back-to-top"
      onClick={scrollToTop}
      aria-label="Voltar ao topo"
      title="Voltar ao topo"
    >
      <span aria-hidden="true">↑</span>
    </button>
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
  const [favorites, setFavorites] = useState<OportunidadeResultado[]>(readFavorites);
  const [showFavorites, setShowFavorites] = useState(false);
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [popupError, setPopupError] = useState<{ title: string; message: string; sample: string | null } | null>(null);
  const [filters, setFilters] = useState<FetchFilters | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    } catch {}
  }, [favorites]);

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

        const response = await fetchResultados(activeFilters, controller.signal);
        
        clearInterval(progressInterval);
        setLoadingStep('Finalizando...');
        
        if (!cancelled) {
          setResultados(response.resultados);
          setPopupError(response.aviso);
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
    setSummaryFilter(null);
    setFilters(newFilters);
  };

  const handleSummaryFilterChange = (filter: SummaryFilter) => {
    setSummaryFilter(current => current === filter ? null : filter);
  };

  const toggleFavorite = (result: OportunidadeResultado) => {
    const key = getFavoriteKey(result);
    if (!key) return;

    setFavorites(current => current.some(item => getFavoriteKey(item) === key)
      ? current.filter(item => getFavoriteKey(item) !== key)
      : [result, ...current]
    );
  };

  const baseResults = showFavorites ? favorites : resultados;
  const visibleResults = baseResults.filter(result => matchesSummaryFilter(result, summaryFilter));

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
        <Header
          showFavorites={showFavorites}
          favoritesCount={favorites.length}
          onToggleFavorites={() => setShowFavorites(current => !current)}
        />

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

        {baseResults.length > 0 ? (
          <>
            <Summary
              results={baseResults}
              favoritesView={showFavorites}
              activeFilter={summaryFilter}
              onSelectFilter={handleSummaryFilterChange}
            />
            {visibleResults.length > 0 ? (
              <section className="cards-shell">
                {visibleResults.map((item, index) => (
                  <ResultCard
                    key={item.tipoSaida === 'oportunidade'
                      ? getFavoriteKey(item) ?? `${item.local ?? 'unknown'}-${index}`
                      : `resumo-${index}`}
                    result={item}
                    isFavorite={item.tipoSaida === 'oportunidade'
                      && favorites.some(favorite => getFavoriteKey(favorite) === getFavoriteKey(item))}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </section>
            ) : (
              <div className="status-card">Nenhum registro corresponde a este filtro.</div>
            )}
          </>
        ) : !loading && !error ? (
          <div className="status-card">
            {showFavorites ? 'Nenhum favorito salvo.' : 'Nenhum resultado disponível.'}
          </div>
        ) : null}
      </main>
      <BackToTopButton />
    </div>
  );
}

export default App;
