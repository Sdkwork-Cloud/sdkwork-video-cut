import { Scissors } from 'lucide-react';

interface SmartSliceTimelineSplitHandleProps {
  leftPx: number;
  topPx?: number;
  label: string;
  disabled?: boolean;
  onSplit: () => void;
}

export function SmartSliceTimelineSplitHandle({
  leftPx,
  topPx = 4,
  label,
  disabled = false,
  onSplit,
}: SmartSliceTimelineSplitHandleProps) {
  return (
    <button
      type="button"
      className="absolute z-20 inline-flex items-center gap-1 rounded border border-cyan-400/35 bg-cyan-500/10 px-2 py-1 text-[9px] font-semibold text-cyan-100 shadow-[0_0_0_1px_rgba(103,232,249,0.1)] transition-colors hover:border-cyan-300 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        left: `${leftPx}px`,
        top: `${topPx}px`,
        transform: 'translateX(-50%)',
      }}
      onClick={onSplit}
      disabled={disabled}
      aria-label={`Split clip at ${label}`}
    >
      <Scissors size={10} />
    </button>
  );
}
