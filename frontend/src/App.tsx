import { useEffect, useState } from 'react';
import { fetchResultados } from './api';
import type { PregaoResultado } from './types';
import ResultCard from './components/ResultCard';

interface FetchFilters {
  ufs?: string;
  modalidades?: string;
  prazo?: number;
}

const TODAS_UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

function FilterControls({ onFilterChange }: { onFilterChange: (filters: FetchFilters) => void }) {
  const [ufs, setUfs] = useState<string[]>(['RJ']);
  const [modalidades, setModalidades] = useState<string>('pregao,dispensa');
  const [prazo, setPrazo] = useState<number>(5);

  const handleApplyFilters = () => {
    const filters: FetchFilters = {
      ufs: ufs.join(','),
      modalidades,
      prazo,
    };
    onFilterChange(filters);
  };

  const toggleUf = (uf: string) => {
    setUfs(prev => prev.includes(uf) ? prev.filter(u => u !== uf) : [...prev, uf]);
  };

  const selectAllUfs = () => {
    setUfs(prev => prev.length === TODAS_UFS.length ? ['RJ'] : TODAS_UFS);
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

        <div className="filter-group">
          <label>Modalidades:</label>
          <select value={modalidades} onChange={(e) => setModalidades(e.target.value)}>
            <option value="pregao,dispensa">Pregão + Dispensa (padrão)</option>
            <option value="pregao">Pregão apenas</option>
            <option value="dispensa">Dispensa apenas</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Prazo de entrega da proposta (dias):</label>
          <input
            type="number"
            min="1"
            max="180"
            value={prazo}
            onChange={(e) => setPrazo(Number(e.target.value) || 1)}
          />
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

function App() {
  const [resultados, setResultados] = useState<PregaoResultado[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FetchFilters>({});

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
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

        const data = await fetchResultados(filters, controller.signal);
        
        clearInterval(progressInterval);
        setLoadingStep('Finalizando...');
        
        console.log('Dados recebidos:', data);
        console.log('Total:', data.length);
        data.forEach((item, i) => console.log(`Item ${i}:`, item.tipoSaida, item.tipoSaida === 'oportunidade' ? item.idContratacaoPNCP : 'N/A'));
        
        if (!cancelled) {
          setResultados(data);
        }
      } catch (err) {
        if (!cancelled && err instanceof Error && err.name !== 'AbortError') {
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

      <main className="page-shell">
        <Header />

        {loading ? (
          <div className="status-card loading-progress">
            <div className="spinner"></div>
            <p>{loadingStep || 'Carregando dados...'}</p>
          </div>
        ) : error ? (
          <div className="status-card status-error">{error}</div>
        ) : (
          <>
            <Summary total={resultados.length} />

            {resultados.length === 0 ? (
              <div className="status-card">Nenhum resultado disponível.</div>
            ) : (
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
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
