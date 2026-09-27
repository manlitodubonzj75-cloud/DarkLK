import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/common/Card';
import { Icons } from '../../components/common/Icons';
import { Logo } from '../../components/common/Logo';
import { LegalModal } from '../../components/common/LegalModal';

const LEGAL_ACCEPTED_KEY = 'msal_legal_accepted_v1';

export const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [legalModalTab, setLegalModalTab] = useState(null);

  // Consent gate state
  const [isLegalAccepted, setIsLegalAccepted] = useState(() => {
    return Boolean(localStorage.getItem(LEGAL_ACCEPTED_KEY));
  });
  const [consentError, setConsentError] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleToggleConsent = (checked) => {
    setIsLegalAccepted(checked);
    if (checked) {
      localStorage.setItem(LEGAL_ACCEPTED_KEY, String(Date.now()));
      setConsentError(false);
    } else {
      localStorage.removeItem(LEGAL_ACCEPTED_KEY);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isLegalAccepted) {
      setConsentError(true);
      setErrorMessage('Для входа в приложение необходимо принять Условия использования и Политику конфиденциальности');
      return;
    }

    if (!username || !password) {
      setErrorMessage('Пожалуйста, введите логин и пароль');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    const result = await login(username, password);
    setIsLoading(false);

    if (result.success) {
      localStorage.setItem(LEGAL_ACCEPTED_KEY, String(Date.now()));
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
                Логин
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-textMuted dark:text-[#8E98A8]">
                  <Icons.User size={18} />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Логин"
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

            {/* Mandatory Consent Gate Checkbox */}
            <div className={`p-3.5 rounded-2xl border transition-all ${
              consentError
                ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-300 dark:border-rose-900/60 ring-2 ring-rose-400/20'
                : 'bg-bg dark:bg-[#12151B] border border-border dark:border-[#2B3242]'
            }`}>
              <label className="flex items-start space-x-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isLegalAccepted}
                  onChange={(e) => handleToggleConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-primary focus:ring-primary border-border dark:border-gray-600 dark:bg-gray-800 cursor-pointer shrink-0"
                />
                <span className="text-xs text-text dark:text-[#CBD5E1] leading-relaxed">
                  Я прочитал(а) и принимаю{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLegalModalTab('terms');
                    }}
                    className="font-bold text-primary dark:text-[#38BDF8] underline hover:opacity-85 inline"
                  >
                    Условия использования
                  </button>{' '}
                  и{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLegalModalTab('privacy');
                    }}
                    className="font-bold text-primary dark:text-[#38BDF8] underline hover:opacity-85 inline"
                  >
                    Политику конфиденциальности
                  </button>
                  , подтверждаю согласие с принципами прямого соединения и локального шифрования AES-256.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading || !isLegalAccepted}
              className="w-full py-3.5 px-4 bg-primary dark:bg-[#1E6685] hover:bg-primary/90 dark:hover:bg-[#1E6685]/90 text-white font-bold rounded-xl shadow-lg shadow-primary/20 dark:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 active:scale-[0.99]"
            >
              {isLoading ? (
                <>
                  <Icons.Refresh size={18} className="animate-spin" />
                  <span>Вход...</span>
                </>
              ) : !isLegalAccepted ? (
                <span>Примите условия для входа</span>
              ) : (
                <span>Войти в личный кабинет</span>
              )}
            </button>
          </form>
        </Card>

        {/* Footer info */}
        <p className="text-center text-xs text-textMuted dark:text-[#8E98A8] mt-8">
          Прямое защищённое соединение с серверами МГЮА без посредников
        </p>
      </div>

      {/* Terms and Privacy Modal */}
      <LegalModal
        isOpen={Boolean(legalModalTab)}
        initialTab={legalModalTab || 'terms'}
        onClose={() => setLegalModalTab(null)}
      />
    </div>
  );
};
