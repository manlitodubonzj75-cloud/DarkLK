import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/common/Card';
import { Icons } from '../../components/common/Icons';
import { Logo } from '../../components/common/Logo';
import { LegalModal } from '../../components/common/LegalModal';

export const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [legalModalTab, setLegalModalTab] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMessage('Пожалуйста, введите логин и пароль');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    const result = await login(username, password);
    setIsLoading(false);

    if (result.success) {
      navigate('/');
    } else {
      setErrorMessage(result.error || 'Ошибка входа в систему');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg dark:bg-[#12151B] transition-colors duration-200">
      <div className="max-w-md w-full">
        {/* University Branding */}
        <div className="text-center mb-8 flex flex-col items-center">
          <Logo size={80} className="shadow-2xl ring-2 ring-primary/20 dark:ring-[#2B3242]" />
          <h1 className="text-2xl font-black text-dark dark:text-white tracking-wide mt-4">DarkMSAL</h1>
          <p className="text-xs font-medium text-textMuted dark:text-[#8E98A8] mt-1">
            для Альма Матер с любовью.
          </p>
        </div>

        {/* Login Form Card */}
        <Card className="p-6 md:p-8 dark:bg-[#181C26] dark:border-[#2B3242]">
          <h2 className="text-xl font-bold mb-6 text-center text-dark dark:text-white">Авторизация</h2>

          {errorMessage && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 flex items-start space-x-3 text-rose-700 dark:text-rose-300">
              <Icons.AlertCircle size={20} className="shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{errorMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-textMuted dark:text-[#8E98A8]">
                Логин или Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-textMuted dark:text-[#8E98A8]">
                  <Icons.User size={18} />
                </div>
                <input
                  type="text"
                  required
                  placeholder="sc1234567 или логин"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-bg dark:bg-[#12151B] border border-border dark:border-[#2B3242] rounded-xl text-dark dark:text-white text-sm placeholder:text-textMuted/60 dark:placeholder:text-[#8E98A8]/60 focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-[#1E6685] transition-all"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2 text-textMuted dark:text-[#8E98A8]">
                Пароль
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-textMuted dark:text-[#8E98A8]">
                  <Icons.Key size={18} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 bg-bg dark:bg-[#12151B] border border-border dark:border-[#2B3242] rounded-xl text-dark dark:text-white text-sm placeholder:text-textMuted/60 dark:placeholder:text-[#8E98A8]/60 focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-[#1E6685] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white"
                >
                  {showPassword ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-4 mt-2 bg-primary hover:bg-primary-dark dark:bg-[#1E6685] dark:hover:bg-[#257C9F] text-white font-bold rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center space-x-2 text-sm tracking-wider uppercase"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full border-2 border-white border-t-transparent h-5 w-5"></div>
                  <span>Вход в систему...</span>
                </>
              ) : (
                <span>ВОЙТИ</span>
              )}
            </button>
          </form>
        </Card>

        {/* Security & Legal Footer */}
        <div className="text-center mt-6 space-y-2">
          <p className="text-xs text-textMuted dark:text-[#8E98A8]">
            Прямое подключение к серверу МГЮА (lk.msal.ru:3443) • AES-256
          </p>
          <div className="flex items-center justify-center space-x-2 text-[11px] text-textMuted dark:text-[#8E98A8]">
            <button
              onClick={() => setLegalModalTab('terms')}
              className="hover:text-primary dark:hover:text-[#38BDF8] underline transition-colors"
            >
              Условия использования
            </button>
            <span>•</span>
            <button
              onClick={() => setLegalModalTab('privacy')}
              className="hover:text-primary dark:hover:text-[#38BDF8] underline transition-colors"
            >
              Политика конфиденциальности
            </button>
          </div>
        </div>
      </div>

      {/* Legal Information Modal */}
      <LegalModal
        isOpen={!!legalModalTab}
        onClose={() => setLegalModalTab(null)}
        initialTab={legalModalTab || 'terms'}
      />
    </div>
  );
};
