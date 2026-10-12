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
