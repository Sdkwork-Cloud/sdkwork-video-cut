import { useState, type MouseEvent } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { Button } from './Button';
import { normalizeAutoCutTaskDetailDisplayText } from './taskDetailText';

interface TaskFailureStateLabels {
  fallbackErrorMessage?: string;
  title?: string;
  copyError?: string;
  copied?: string;
  copyErrorMessage?: string;
  copiedErrorMessage?: string;
  retry?: string;
  diagnosticsSummary?: string;
}

interface TaskFailureStateProps {
  errorMessage?: string | undefined;
  failureDiagnostics?: string | undefined;
  onCopyErrorMessage: (message: string) => Promise<void> | void;
  onRetry?: () => void;
  variant?: 'full' | 'compact';
  labels?: TaskFailureStateLabels;
}

const defaultTaskFailureStateLabels = {
  fallbackErrorMessage: 'Task processing failed. Adjust the parameters and submit the task again.',
  title: 'Task processing failed',
  copyError: 'Copy failed',
  copied: 'Copied',
  copyErrorMessage: 'Copy failure message',
  copiedErrorMessage: 'Copied failure message',
  retry: 'Retry',
  diagnosticsSummary: 'Diagnostic trace',
} satisfies Required<TaskFailureStateLabels>;

function createTaskFailureClipboardMessage(displayErrorMessage: string, failureDiagnostics: string | undefined) {
  if (!failureDiagnostics?.trim()) {
    return displayErrorMessage;
  }

  return [displayErrorMessage, '', 'Diagnostics:', failureDiagnostics.trim()].join('\n');
}

export function TaskFailureState({
  errorMessage,
  failureDiagnostics,
  onCopyErrorMessage,
  onRetry,
  variant = 'full',
  labels,
}: TaskFailureStateProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'copyError'>('idle');
  const copy = { ...defaultTaskFailureStateLabels, ...labels };
  const displayErrorMessage = normalizeAutoCutTaskDetailDisplayText(errorMessage) || copy.fallbackErrorMessage;
  const normalizedFailureDiagnostics = normalizeAutoCutTaskDetailDisplayText(failureDiagnostics);
  const copyButtonLabel = copyState === 'copyError'
    ? copy.copyError
    : copyState === 'copied'
      ? copy.copied
      : copy.copyErrorMessage;
  const copyButtonTitle = copyState === 'copyError'
    ? copy.copyError
    : copyState === 'copied'
      ? copy.copiedErrorMessage
      : copy.copyErrorMessage;

  const handleCopyErrorMessage = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await onCopyErrorMessage(createTaskFailureClipboardMessage(displayErrorMessage, normalizedFailureDiagnostics));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('copyError');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  };

  if (variant === 'compact') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-left">
        <div className="mt-0.5 shrink-0 text-red-500">
          <AlertTriangle size={13} />
        </div>
        <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-red-400/85 line-clamp-2">
          {displayErrorMessage}
        </p>
        <button
          type="button"
          onClick={handleCopyErrorMessage}
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-red-500/20 text-red-300 hover:border-red-500/40 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500"
          title={copyButtonTitle}
          aria-label={copyButtonTitle}
        >
          {copyState === 'copied' ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto rounded-xl border border-red-500/20 bg-red-500/5 custom-scrollbar">
      <div className="flex min-h-full flex-col items-center justify-start p-10 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500">
          <AlertTriangle size={30} />
        </div>
        <h3 className="mb-2 text-lg font-bold text-red-400">{copy.title}</h3>
        <p className="max-w-md text-sm leading-relaxed text-gray-400">
          {displayErrorMessage}
        </p>
        {normalizedFailureDiagnostics && (
          <details className="mt-5 w-full max-w-3xl rounded-lg border border-red-500/15 bg-black/20 p-4 text-left">
            <summary className="cursor-pointer text-xs font-semibold text-red-300">
              {copy.diagnosticsSummary}
            </summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-red-100/75 custom-scrollbar">
              {normalizedFailureDiagnostics}
            </pre>
          </details>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            onClick={handleCopyErrorMessage}
            variant="outline"
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            {copyState === 'copied' ? <Check size={14} className="mr-2" /> : <Copy size={14} className="mr-2" />}
            {copyButtonLabel}
          </Button>
          {onRetry && (
            <Button onClick={onRetry} variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10">
              {copy.retry}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
