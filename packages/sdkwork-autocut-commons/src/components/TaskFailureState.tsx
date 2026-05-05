import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface TaskFailureStateProps {
  errorMessage?: string | undefined;
  onRetry?: () => void;
  variant?: 'full' | 'compact';
}

const fallbackErrorMessage = '服务处理过程中出现异常，请调整参数后重新提交任务。';

export function TaskFailureState({ errorMessage, onRetry, variant = 'full' }: TaskFailureStateProps) {
  if (variant === 'compact') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-left">
        <div className="mt-0.5 shrink-0 text-red-500">
          <AlertTriangle size={13} />
        </div>
        <p className="min-w-0 text-[10px] leading-relaxed text-red-400/85 line-clamp-2">
          {errorMessage || fallbackErrorMessage}
        </p>
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
        {errorMessage || fallbackErrorMessage}
      </p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" className="mt-6 border-red-500/30 text-red-400 hover:bg-red-500/10">
          重新处理
        </Button>
      )}
    </div>
  );
}
