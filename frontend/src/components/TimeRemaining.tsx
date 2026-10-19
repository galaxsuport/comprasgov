import { useEffect, useState } from 'react';
import { formatTempoRestante } from '../format';

export default function TimeRemaining({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const deadlineTime = deadline ? new Date(deadline).getTime() : Number.NaN;
  const expired = Number.isFinite(deadlineTime) && deadlineTime <= now;

  return (
    <div className={expired ? 'card-time-expired' : undefined}>
      <span>Tempo restante</span>
      <strong>{expired ? 'Envio de proposta encerrada' : formatTempoRestante(deadline)}</strong>
    </div>
  );
}
