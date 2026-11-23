import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class AnatomyErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AnatomyErrorBoundary] Uncaught error in telemetry module:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 rounded-3xl bg-[#070A0F] border border-amber-500/30 text-center space-y-3 font-mono">
          <div className="text-amber-400 font-bold text-sm">TELEMETRÍA EN REPOSO / SINCRONIZANDO...</div>
          <p className="text-xs text-slate-400">El módulo anatómico está inicializando los datos biológicos con seguridad.</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 rounded-xl bg-accent text-accent-contrast font-black text-xs hover:bg-accent-hover transition-colors cursor-pointer"
          >
            Reintentar Telemetría
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
