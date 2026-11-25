import React, { Component, ErrorInfo, ReactNode } from 'react';
import { getAppUpdateSafetyStatus } from '../utils/updateApp';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || 'Error inesperado de renderizado.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[App ErrorBoundary] Uncaught UI error:', error, errorInfo);
  }

  private handleSafeRecover = async () => {
    const safety = getAppUpdateSafetyStatus();
    if (!safety.canUpdateSafely) {
      this.setState({ hasError: false, errorMessage: '' });
      return;
    }

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update().catch(() => {});
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => !k.startsWith('lazcakon-exercise-lib-'))
            .map((k) => caches.delete(k))
        );
      }
    } catch {}

    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#070A0F] text-white flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-3xl bg-[#0D131D] border border-red-500/30 p-6 space-y-4 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 mx-auto flex items-center justify-center text-2xl">
              🦍
            </div>
            <h1 className="text-lg font-black tracking-tight text-white">
              LAZCAKONG GYM · Recuperación Segura
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Detectamos un fallo temporal al cargar la pantalla. Tu historial, rutinas y datos locales están intactos.
            </p>
            {this.state.errorMessage && (
              <p className="text-[11px] font-mono text-amber-300/90 bg-black/40 border border-white/10 rounded-xl px-3 py-2 break-words">
                {this.state.errorMessage}
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, errorMessage: '' })}
                className="flex-1 py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-bold text-white cursor-pointer"
              >
                Reintentar vista
              </button>
              <button
                type="button"
                onClick={this.handleSafeRecover}
                className="flex-1 py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-black cursor-pointer"
              >
                Recargar y limpiar caché
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
