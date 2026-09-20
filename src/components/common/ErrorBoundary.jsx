import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    localStorage.removeItem('cached_user');
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#12151B] text-white">
          <div className="max-w-md w-full bg-[#1F2430] border border-[#2B3242] rounded-2xl p-6 text-center shadow-xl">
            <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2">Что-то пошло не так</h2>
            <p className="text-sm text-[#8E98A8] mb-6">
              Произошла ошибка при отрисовке интерфейса. Нажмите кнопку ниже для перезагрузки приложения.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => window.location.reload()}
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
      );
    }

    return this.props.children;
  }
}
