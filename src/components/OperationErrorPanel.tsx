import { AlertTriangle, RotateCw, X } from 'lucide-react';

import type { OperationError } from '../domain/operationErrors';

export function OperationErrorPanel({
  error,
  recoveryAction,
  onDismiss,
}: {
  error: OperationError;
  recoveryAction?: {
    label: string;
    onRun: () => void;
  };
  onDismiss: () => void;
}) {
  return (
    <section className="operation-error-panel" role="alert" aria-label="Operation error">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="operation-error-body">
        <div className="operation-error-heading">
          <strong>{error.title}</strong>
          <div className="operation-error-actions">
            {recoveryAction && (
              <button
                type="button"
                className="secondary-button operation-error-retry"
                aria-label={recoveryAction.label}
                onClick={recoveryAction.onRun}
              >
                <RotateCw size={15} aria-hidden="true" />
                <span>Reload</span>
              </button>
            )}
            <button type="button" className="icon-button" aria-label="Dismiss operation error" onClick={onDismiss}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p>{error.message}</p>
        <dl className="operation-error-meta">
          {error.code && (
            <div>
              <dt>Code</dt>
              <dd>{error.code}</dd>
            </div>
          )}
          {error.status !== undefined && (
            <div>
              <dt>Status</dt>
              <dd>HTTP {error.status}</dd>
            </div>
          )}
          {error.traceId && (
            <div>
              <dt>Trace</dt>
              <dd>{error.traceId}</dd>
            </div>
          )}
          {error.endpoint && (
            <div>
              <dt>Endpoint</dt>
              <dd>{error.endpoint}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
