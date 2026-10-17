import type { OportunidadeResultado } from './types';

export function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getProposalDateKey(proposal: OportunidadeResultado): string | null {
  for (const raw of [
    proposal.dataEncerramentoProposta,
    proposal.dataAberturaProposta,
    proposal.dataPublicacao
  ]) {
    if (!raw) continue;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return getLocalDateKey(date);
  }
  return null;
}

export function getUpcomingProposals(
  proposals: OportunidadeResultado[],
  todayKey = getLocalDateKey(new Date())
): OportunidadeResultado[] {
  return proposals.filter(proposal => {
    const dateKey = getProposalDateKey(proposal);
    return dateKey !== null && dateKey >= todayKey;
  });
}
