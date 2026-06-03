import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

interface SuspenseBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  boundary?: string | undefined;
  onReset?: (() => void) | undefined;
}

const DefaultLoadingFallback = () => (
  <div className="flex h-full min-h-[240px] w-full items-center justify-center bg-[#111] text-gray-400">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
  </div>
);

export function SuspenseBoundary({
  children,
  fallback,
  boundary,
  onReset,
}: SuspenseBoundaryProps) {
  return (
    <ErrorBoundary boundary={boundary} onReset={onReset}>
      <Suspense fallback={fallback ?? <DefaultLoadingFallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}