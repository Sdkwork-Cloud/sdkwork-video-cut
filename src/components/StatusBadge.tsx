export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'ok' | 'warn' | 'neutral';
}) {
  return <span className={`status-badge status-badge--${tone}`}>{label}</span>;
}
