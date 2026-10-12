import { useEffect, useState } from 'react';
import { formatTempoRestante } from '../format';

export default function TimeRemaining({ deadline }: { deadline: string | null }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(tick => tick + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);

  return <>{formatTempoRestante(deadline)}</>;
}
