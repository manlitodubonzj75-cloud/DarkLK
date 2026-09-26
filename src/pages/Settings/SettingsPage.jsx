import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { lkService } from '../../api';
import { Card } from '../../components/common/Card';
import { Logo } from '../../components/common/Logo';
import { LegalModal } from '../../components/common/LegalModal';
import { Icons } from '../../components/common/Icons';
import { updateService, getAppPlatform } from '../../api/updateService';

function parsePrivacyBool(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val === 1;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return fallback;
}

function resolveUserPrivacy(user, serverData = null) {
  const src = serverData || user?.access || user?.privacy || user || {};

  // Email
  let showEmail = false;
  if (src.showEmail !== undefined) showEmail = parsePrivacyBool(src.showEmail);
  else if (src.email !== undefined) showEmail = parsePrivacyBool(src.email);
  else if (user?.showEmail !== undefined) showEmail = parsePrivacyBool(user.showEmail);
  else if (user?.emailVisible !== undefined) showEmail = parsePrivacyBool(user.emailVisible);

  // Photo
  let showPhoto = false;
  if (src.showPhoto !== undefined) showPhoto = parsePrivacyBool(src.showPhoto);
  else if (src.photo !== undefined) showPhoto = parsePrivacyBool(src.photo);
  else if (user?.showPhoto !== undefined) showPhoto = parsePrivacyBool(user.showPhoto);
  else if (user?.photoVisible !== undefined) showPhoto = parsePrivacyBool(user.photoVisible);

  // Mobile / Phone
  let showMobile = false;
  if (src.showMobile !== undefined) showMobile = parsePrivacyBool(src.showMobile);
  else if (src.mobile !== undefined) showMobile = parsePrivacyBool(src.mobile);
  else if (src.phone !== undefined) showMobile = parsePrivacyBool(src.phone);
  else if (user?.showMobile !== undefined) showMobile = parsePrivacyBool(user.showMobile);
  else if (user?.mobileVisible !== undefined) showMobile = parsePrivacyBool(user.mobileVisible);

  return { showEmail, showPhoto, showMobile };
}

export const SettingsPage = () => {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [privacy, setPrivacy] = useState(() => resolveUserPrivacy(user));
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);

  const platform = getAppPlatform();
  const platformLabel = platform === 'ios' ? 'Apple iOS' : platform === 'android' ? 'Android' : platform === 'mac' ? 'macOS' : platform === 'win' ? 'Windows' : 'Web';

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const res = await updateService.checkForUpdates({ force: true });
      if (res?.hasUpdate) {
        setUpdateStatus({
          hasUpdate: true,
          text: `Доступна новая версия v${res.latestVersion}!`,
          info: res
        });
      } else if (res?.error) {
        setUpdateStatus({
          hasUpdate: false,
          text: `Ошибка проверки: ${res.error}`
        });
      } else {
        setUpdateStatus({
          hasUpdate: false,
          text: 'У вас установлена самая актуальная версия приложения'
        });
      }
    } catch (err) {
      setUpdateStatus({
        hasUpdate: false,
        text: 'Не удалось проверить обновления'
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Synchronize privacy settings from server /student/access or updated user profile
  useEffect(() => {
    let isMounted = true;

    async function loadRemotePrivacy() {
      try {
        const remoteAccess = await lkService.getPrivacySettings();
        if (remoteAccess && isMounted) {
          setPrivacy(resolveUserPrivacy(user, remoteAccess));
          return;
        }
      } catch (e) {
        console.warn('Could not fetch /student/access directly:', e);
      }

      if (user && isMounted) {
        setPrivacy(resolveUserPrivacy(user));
      }
    }

    loadRemotePrivacy();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleTogglePrivacy = async (key) => {
    const updated = { ...privacy, [key]: !privacy[key] };
    setPrivacy(updated);
    setSavingPrivacy(true);
    try {
      // Send both field formats for 100% backend parity
      await lkService.updatePrivacySettings({
        email: updated.showEmail,
        photo: updated.showPhoto,
        mobile: updated.showMobile,
        showEmail: updated.showEmail,
        showPhoto: updated.showPhoto,
        showMobile: updated.showMobile
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
    if (!name || typeof name !== 'string') return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const photoUrl = (typeof user?.photo === 'string' && user.photo.trim())
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
            className="w-20 h-20 rounded-full object-cover border-2 border-accent shrink-0 shadow-sm"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-primary text-white flex items-center justify-center font-black text-2xl shrink-0 shadow-sm">
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

      {/* App Updates Section */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3 px-1">
          Обновление приложения
        </h3>
        <Card className="p-5 space-y-3 dark:bg-[#1F2430] dark:border-[#2B3242]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary dark:text-[#38BDF8]">
                <Icons.Download size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-dark dark:text-white">Текущая версия: v{updateService.getAppVersion()}</h4>
                <p className="text-xs text-textMuted">Платформа: {platformLabel}</p>
              </div>
            </div>

            <button
              onClick={handleCheckUpdates}
              disabled={checkingUpdate}
              className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs flex items-center space-x-1.5 transition-all disabled:opacity-50"
            >
              {checkingUpdate ? (
                <>
                  <Icons.Refresh size={14} className="animate-spin" />
                  <span>Проверка...</span>
                </>
              ) : (
                <>
                  <Icons.Refresh size={14} />
                  <span>Проверить</span>
                </>
              )}
            </button>
          </div>

          {updateStatus && (
            <div className={`p-3 rounded-xl text-xs font-medium border flex items-center justify-between ${
              updateStatus.hasUpdate
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-200'
                : 'bg-bg dark:bg-[#12151B] border-border dark:border-[#283245] text-textMuted dark:text-[#8E98A8]'
            }`}>
              <span>{updateStatus.text}</span>
              {updateStatus.hasUpdate && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('app-show-update-modal', { detail: updateStatus.info }))}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs ml-2 shrink-0 transition-colors"
                >
                  Обновить
                </button>
              )}
            </div>
          )}
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
                  Версия 1.0
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

      {/* Version info */}
      <div className="text-center pt-2 pb-2">
        <p className="text-xs font-mono text-textMuted dark:text-[#8E98A8]">
          DarkMSAL v1.0
        </p>
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
