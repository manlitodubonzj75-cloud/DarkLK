import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidMount() {
    // Сбрасываем экран ошибки при навигации (кнопка «Назад», аппаратная кнопка Android)
    window.addEventListener('hashchange', this.handleLocationChange);
    window.addEventListener('popstate', this.handleLocationChange);
  }

  componentWillUnmount() {
    window.removeEventListener('hashchange', this.handleLocationChange);
    window.removeEventListener('popstate', this.handleLocationChange);
  }

  handleLocationChange = () => {
    if (this.state.hasError) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  };

  // Перезагрузка на той же сломанной странице (HashRouter хранит маршрут в #) снова падает —
  // уходим на главную и перезагружаем
  handleReload = () => {
    try {
      if (window.location.hash && window.location.hash !== '#/') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
      }
    } catch (_) {}
    window.location.reload();
  };

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || this.state.error?.toString?.() || 'Неизвестная ошибка';
      const stack = this.state.error?.stack || this.state.errorInfo?.componentStack;

      return (
        <div className="h-full w-full overflow-y-auto bg-[#12151B] text-white">
        <div className="min-h-full flex items-center justify-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="max-w-md w-full bg-[#1F2430] border border-[#2B3242] rounded-2xl p-6 text-center shadow-xl">
            <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2">Что-то пошло не так</h2>
            <p className="text-sm text-[#8E98A8] mb-4">
              Произошла ошибка при отрисовке интерфейса.
            </p>

            {/* Error Message Details */}
            <div className="mb-6 p-3 bg-[#12151B] border border-rose-500/30 rounded-xl text-left">
              <p className="text-xs font-mono text-rose-400 break-words leading-relaxed font-semibold">
                {errorMsg}
              </p>
              {stack && (
                <details className="mt-2 text-[10px] text-[#8E98A8]">
                  <summary className="cursor-pointer hover:underline">Подробности стека</summary>
                  <pre className="mt-2 p-2 bg-black/40 rounded overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto text-[10px]">
                    {stack}
                  </pre>
                </details>
              )}
            </div>

            <div className="space-y-3">
              <button
                onClick={this.handleReload}
                className="w-full py-2.5 px-4 bg-[#22869A] hover:bg-[#1E6685] rounded-xl font-semibold text-sm transition-all"
              >
                Перезагрузить страницу
              </button>
              <button
                onClick={this.handleReset}
                className="w-full py-2.5 px-4 bg-transparent border border-[#2B3242] hover:bg-white/5 rounded-xl font-semibold text-sm text-[#8E98A8] transition-all"
              >
                Сбросить кэш и войти заново
              </button>
            </div>
          </div>
        </div>
        </div>
      );
    }

    return this.props.children;
  }
}
