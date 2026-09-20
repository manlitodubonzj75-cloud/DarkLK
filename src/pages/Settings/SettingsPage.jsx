import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { lkService } from '../../api';
import { Card } from '../../components/common/Card';
import { Logo } from '../../components/common/Logo';
import { LegalModal } from '../../components/common/LegalModal';
import { Icons } from '../../components/common/Icons';

export const SettingsPage = () => {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [privacy, setPrivacy] = useState({
    showEmail: user?.showEmail ?? true,
    showPhoto: user?.showPhoto ?? true,
    showMobile: user?.showMobile ?? true
  });
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState(null);

  const handleTogglePrivacy = async (key) => {
    const updated = { ...privacy, [key]: !privacy[key] };
    setPrivacy(updated);
    setSavingPrivacy(true);
    try {
      await lkService.updatePrivacySettings({
        email: updated.showEmail,
        photo: updated.showPhoto,
        mobile: updated.showMobile
      });
    } catch (e) {
      console.warn('Failed to update privacy on server:', e);
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getInitials = (name = '') => {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const photoUrl = user?.photo
    ? (user.photo.startsWith('http') ? user.photo : `https://lk.msal.ru:3443/${user.photo}`)
    : null;

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-black text-dark">Профиль и настройки</h1>
        <p className="text-xs text-textMuted mt-0.5">Данные студента и параметры системы</p>
      </div>

      {/* Profile Card */}
      <Card className="p-6 flex flex-col sm:flex-row items-center sm:items-start space-y-4 sm:space-y-0 sm:space-x-5 text-center sm:text-left">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt="Profile"
            className="w-20 h-20 rounded-2xl object-cover border-2 border-accent shrink-0 shadow-sm"
          />
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-primary text-white flex items-center justify-center font-black text-2xl shrink-0 shadow-sm">
            {getInitials(user?.name)}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-black text-dark">{user?.name || 'Имя не указано'}</h2>
          <p className="text-xs font-semibold text-secondary mt-0.5">
            {user?.department || user?.speciality || 'Институт правоведения МГЮА'}
          </p>
          <div className="flex flex-wrap gap-2 justify-center sm:justify-start mt-3">
            {user?.group && (
              <span className="px-3 py-1 bg-bg border border-border rounded-lg text-xs font-bold text-dark">
                Группа: {user.group}
              </span>
            )}
            {user?.course && (
              <span className="px-3 py-1 bg-bg border border-border rounded-lg text-xs font-bold text-dark">
                {user.course} курс
              </span>
            )}
            {user?.subrole && (
              <span className="px-3 py-1 bg-accent/10 text-accent rounded-lg text-xs font-bold">
                {user.subrole}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Account Info Details */}
      <Card className="p-0 overflow-hidden divide-y divide-border">
        <div className="p-4 flex justify-between items-center text-xs">
          <span className="font-bold text-textMuted uppercase">Логин</span>
          <span className="font-semibold text-dark">{user?.login || user?.username || '—'}</span>
        </div>
        <div className="p-4 flex justify-between items-center text-xs">
          <span className="font-bold text-textMuted uppercase">Корпоративный Email</span>
          <span className="font-semibold text-secondary">{user?.emailCorporate || user?.email || '—'}</span>
        </div>
        {user?.phones && user.phones.length > 0 && (
          <div className="p-4 flex justify-between items-center text-xs">
            <span className="font-bold text-textMuted uppercase">Телефон</span>
            <span className="font-semibold text-dark">{user.phones.join(', ')}</span>
          </div>
        )}
      </Card>

      {/* Appearance Section */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3 px-1">
          Внешний вид
        </h3>
        <Card className="p-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-bg text-dark">
              {isDark ? <Icons.Moon size={20} /> : <Icons.Sun size={20} />}
            </div>
            <div>
              <h4 className="text-sm font-bold text-dark">Тёмная тема</h4>
              <p className="text-xs text-textMuted">Переключение темы оформления интерфейса</p>
            </div>
          </div>

          <button
            onClick={toggleTheme}
            className={`w-12 h-7 rounded-full p-1 transition-colors duration-200 ease-in-out ${
              isDark ? 'bg-secondary' : 'bg-gray-300 dark:bg-gray-700'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ease-in-out ${
                isDark ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </Card>
      </div>

      {/* Privacy Settings Section */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3 px-1">
          Приватность в личном кабинете
        </h3>
        <Card className="p-0 overflow-hidden divide-y divide-border">
          {[
            { key: 'showEmail', label: 'Отображать мой email другим студентам' },
            { key: 'showPhoto', label: 'Отображать мою фотографию в профиле' },
            { key: 'showMobile', label: 'Отображать номер телефона' }
          ].map(item => (
            <div key={item.key} className="p-4 flex items-center justify-between">
              <span className="text-xs sm:text-sm font-medium text-dark">{item.label}</span>
              <button
                disabled={savingPrivacy}
                onClick={() => handleTogglePrivacy(item.key)}
                className={`w-12 h-7 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 ${
                  privacy[item.key] ? 'bg-secondary' : 'bg-gray-300 dark:bg-gray-700'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ease-in-out ${
                    privacy[item.key] ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </Card>
      </div>

            {/* About & Legal Information */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3 px-1">
          О приложении и безопасность
        </h3>
        <Card className="p-5 space-y-4 dark:bg-[#1F2430] dark:border-[#2B3242]">
          <div className="flex items-center space-x-3.5">
            <Logo size={46} className="ring-1 ring-border dark:ring-[#2B3242] shrink-0" />
            <div>
              <h4 className="text-base font-black text-dark dark:text-white">DarkMSAL</h4>
              <p className="text-xs text-textMuted dark:text-[#8E98A8]">для Альма Матер с любовью.</p>
              <div className="flex items-center space-x-2 mt-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg dark:bg-[#12151B] border border-border dark:border-[#2B3242] text-textMuted dark:text-[#8E98A8]">
                  Версия 1.1 (build 2)
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  AES-256 (152-ФЗ)
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs text-textMuted dark:text-[#8E98A8] leading-relaxed pt-2 border-t border-border dark:border-[#2B3242]">
            Приложение работает напрямую с серверами lk.msal.ru без промежуточных серверов. Все ваши персональные данные и токены шифруются локально на устройстве алгоритмом AES-GCM 256.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => setLegalModalTab('terms')}
              className="py-2.5 px-3 rounded-xl bg-bg dark:bg-[#12151B] hover:bg-border/60 dark:hover:bg-[#262D3D] text-dark dark:text-white font-bold text-xs border border-border dark:border-[#2B3242] transition-colors text-center"
            >
              Условия использования
            </button>
            <button
              onClick={() => setLegalModalTab('privacy')}
              className="py-2.5 px-3 rounded-xl bg-bg dark:bg-[#12151B] hover:bg-border/60 dark:hover:bg-[#262D3D] text-dark dark:text-white font-bold text-xs border border-border dark:border-[#2B3242] transition-colors text-center"
            >
              Политика конфиденциальности
            </button>
          </div>
        </Card>
      </div>

      {/* Logout Button */}
      <button
        onClick={handleLogout}
        className="w-full flex items-center justify-center space-x-2 p-4 rounded-2xl bg-card border border-rose-200 dark:border-rose-900/50 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 font-bold text-sm shadow-sm transition-colors"
      >
        <Icons.LogOut size={18} />
        <span>Выйти из аккаунта</span>
      </button>

      {/* Legal Information Modal */}
      <LegalModal
        isOpen={!!legalModalTab}
        onClose={() => setLegalModalTab(null)}
        initialTab={legalModalTab || 'terms'}
      />
    </div>
  );
};
