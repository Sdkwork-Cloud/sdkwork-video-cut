import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportAutoCutDiagnostic, getAutoCutI18n } from '@sdkwork/autocut-services';
import { Button } from './Button';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: (() => void) | undefined;
  boundary?: string | undefined;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

function errorBoundaryLabels() {
  const i18n = getAutoCutI18n();
  return {
    title: i18n.t('errorBoundary.title', 'Something went wrong'),
    description: i18n.t(
      'errorBoundary.description',
      'An unexpected error occurred while rendering this section. You can try reloading the page or retry below.',
    ),
    retry: i18n.t('errorBoundary.retry', 'Retry'),
  };
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    reportAutoCutDiagnostic(
      'error',
      this.props.boundary ?? 'ErrorBoundary',
      `Uncaught render error: ${error.message}`,
      {
        componentStack: errorInfo.componentStack ?? undefined,
        errorName: error.name,
      },
    );
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const labels = errorBoundaryLabels();

      return (
        <div className="flex min-h-0 w-full flex-1 items-center justify-center p-8">
          <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500">
              <AlertTriangle size={26} />
            </div>
            <h3 className="text-base font-bold text-red-400">
              {labels.title}
            </h3>
            <p className="text-sm leading-relaxed text-gray-400">
              {labels.description}
            </p>
            <Button
              onClick={this.handleReset}
              variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              <RefreshCw size={14} className="mr-2" />
              {labels.retry}
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}