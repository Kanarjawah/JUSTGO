const STAGES = ['Arrived', 'Pickup', 'In Transit', 'Delivered'] as const;
const KEYS = ['ARRIVED', 'PICKUP', 'IN_TRANSIT', 'DELIVERED'] as const;

export default function ProgressTracker({
  current,
}: {
  current?: string | null;
}) {
  const idx = current ? KEYS.indexOf(current as (typeof KEYS)[number]) : -1;
  return (
    <ol className="progress-tracker" aria-label="Request fulfillment progress">
      {STAGES.map((label, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
        return (
          <li key={label} className={`progress-step ${state}`}>
            <span className="progress-dot" aria-hidden="true" />
            <span>{label}</span>
            {i < STAGES.length - 1 ? <span className="progress-arrow" aria-hidden="true">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
