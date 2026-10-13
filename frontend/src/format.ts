export function formatDateTime(isoString: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatBRL(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 'R$ 0,00';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2
  });
}

export function formatCompactBRL(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value) || value === 0) return 'R$ 0';
  if (value >= 1_000_000_000) {
    return `R$ ${(value / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
  }
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  }
  if (value >= 1_000) {
    return `R$ ${(value / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  }
  return formatBRL(value);
}

export function formatTempoRestante(dataEncerramento: string | null): string {
  if (!dataEncerramento) return '—';

  const encerramento = new Date(dataEncerramento).getTime();
  if (Number.isNaN(encerramento)) return '—';

  const minutosRestantes = Math.max(0, Math.floor((encerramento - Date.now()) / 60000));
  const dias = Math.floor(minutosRestantes / 1440);
  const horas = Math.floor((minutosRestantes % 1440) / 60);
  const minutos = minutosRestantes % 60;

  return `${dias} ${dias === 1 ? 'dia' : 'dias'}, ${horas} ${horas === 1 ? 'hora' : 'horas'} e ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} restantes`;
}
