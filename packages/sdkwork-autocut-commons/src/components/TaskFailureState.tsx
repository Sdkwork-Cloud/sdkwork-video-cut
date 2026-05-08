import { useState, type MouseEvent } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { Button } from './Button';

interface TaskFailureStateProps {
  errorMessage?: string | undefined;
  failureDiagnostics?: string | undefined;
  onCopyErrorMessage: (message: string) => Promise<void> | void;
  onRetry?: () => void;
  variant?: 'full' | 'compact';
}

const fallbackErrorMessage = '服务处理过程中出现异常，请调整参数后重新提交任务。';

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
}: TaskFailureStateProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'copyError'>('idle');
  const displayErrorMessage = errorMessage || fallbackErrorMessage;

  const handleCopyErrorMessage = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      if (failureDiagnostics?.trim()) {
        await onCopyErrorMessage(createTaskFailureClipboardMessage(displayErrorMessage, failureDiagnostics));
      } else {
        await onCopyErrorMessage(displayErrorMessage);
      }
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
          title={copyState === 'copyError' ? '复制失败' : copyState === 'copied' ? '已复制失败信息' : '复制失败信息'}
          aria-label={copyState === 'copyError' ? '复制失败' : copyState === 'copied' ? '已复制失败信息' : '复制失败信息'}
        >
          {copyState === 'copied' ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center border border-red-500/20 rounded-xl bg-red-500/5 p-10 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center mb-5">
        <AlertTriangle size={30} />
      </div>
      <h3 className="text-lg font-bold text-red-400 mb-2">任务处理失败</h3>
      <p className="text-sm text-gray-400 max-w-md leading-relaxed">
        {displayErrorMessage}
      </p>
      {failureDiagnostics?.trim() && (
        <details className="mt-5 w-full max-w-3xl rounded-lg border border-red-500/15 bg-black/20 p-4 text-left">
          <summary className="cursor-pointer text-xs font-semibold text-red-300">
            Diagnostic trace
          </summary>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-red-100/75">
            {failureDiagnostics}
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
          {copyState === 'copyError' ? '复制失败' : copyState === 'copied' ? '已复制' : '复制失败信息'}
        </Button>
        {onRetry && (
          <Button onClick={onRetry} variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10">
          重新处理
          </Button>
        )}
      </div>
    </div>
  );
}
