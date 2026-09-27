import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Card } from '../../components/common/Card';
import { Icons } from '../../components/common/Icons';
import { LegalModal } from '../../components/common/LegalModal';
import { updateService } from '../../api/updateService';
import { getAppPlatform } from '../../api/updateService';

function parsePrivacyBool(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

function resolveUserPrivacy(user) {
  const src = user?.accessSettings || user?.privacy || {};

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

  // Bottom bar vs Sidebar Navigation mode
  const [useSidebarNav, setUseSidebarNav] = useState(() => {
    try {
      return localStorage.getItem('msal_mobile_layout_mode') === 'sidebar';
    } catch (_) {
      return false;
    }
  });

  const platform = getAppPlatform();
  const platformLabel = platform === 'userscript' ? 'Userscript (Safari / Web)' : platform === 'ios' ? 'Apple iOS' : platform === 'android' ? 'Android' : platform === 'mac' ? 'macOS' : platform === 'win' ? 'Windows' : 'Web';

  const handleToggleMobileLayout = () => {
    const nextVal = !useSidebarNav;
    setUseSidebarNav(nextVal);
    try {
      localStorage.setItem('msal_mobile_layout_mode', nextVal ? 'sidebar' : 'bottombar');
      window.dispatchEvent(new CustomEvent('msal_mobile_layout_changed', { detail: nextVal ? 'sidebar' : 'bottombar' }));
    } catch (_) {}
  };

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
    async function fetchServerPrivacy() {
      try {
        const { studentService } = await import('../../api');
        const access = await studentService.getAccessSettings();
        if (isMounted && access && typeof access === 'object') {
          setPrivacy(resolveUserPrivacy({ accessSettings: access }));
        }
      } catch (err) {
        // Fallback silently to user profile cached data
      }
    }
    fetchServerPrivacy();
    return () => { isMounted = false; };
  }, []);

  const handleTogglePrivacy = async (key) => {
    const nextVal = !privacy[key];
    const previousState = { ...privacy };
    setPrivacy(prev => ({ ...prev, [key]: nextVal }));
    setSavingPrivacy(true);

    try {
      const { studentService } = await import('../../api');
      const payload = {
        showEmail: key === 'showEmail' ? nextVal : privacy.showEmail,
        showPhoto: key === 'showPhoto' ? nextVal : privacy.showPhoto,
        showMobile: key === 'showMobile' ? nextVal : privacy.showMobile
      };
      await studentService.updateAccessSettings(payload);
    } catch (err) {
      console.error('[SettingsPage] Failed to save privacy settings:', err);
      setPrivacy(previousState);
      alert('Не удалось сохранить настройку на сервере. Проверьте подключение к сети.');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const getInitials = (name = '') => {
    if (!name || typeof name !== 'string') return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const photoUrl = (typeof user?.photo === 'string' && user.photo.trim())
    ? (user.photo.startsWith('http') ? user.photo : `https://lk.msal.ru:3443/${user.photo}`)
    : null;

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-black text-dark">Настройки</h1>
        <p className="text-xs text-textMuted mt-1">
          Управление профилем, внешним видом и навигацией
        </p>
      </div>

      {/* User Profile Card */}
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

      {/* Appearance & Navigation Section */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3 px-1">
          Внешний вид и навигация
        </h3>
        <Card className="p-0 overflow-hidden divide-y divide-border">
          {/* Theme Switcher */}
          <div className="p-4 flex items-center justify-between">
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
              className={`w-12 h-7 rounded-full p-1 transition-colors duration-150 ease-in-out ${
                isDark ? 'bg-secondary' : 'bg-gray-300 dark:bg-gray-700'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform duration-150 ease-in-out ${
                  isDark ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Bottom Bar vs Sidebar Drawer Navigation Toggle */}
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-bg text-dark">
                <Icons.Menu size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-dark">Боковое меню навигации</h4>
                <p className="text-xs text-textMuted">
                  {useSidebarNav
                    ? 'Нижний бар скрыт, все разделы открываются через боковую панель'
                    : 'Стандартная нижняя панель навигации'}
                </p>
              </div>
            </div>

            <button
              onClick={handleToggleMobileLayout}
              className={`w-12 h-7 rounded-full p-1 transition-colors duration-150 ease-in-out shrink-0 ${
                useSidebarNav ? 'bg-secondary' : 'bg-gray-300 dark:bg-gray-700'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform duration-150 ease-in-out ${
                  useSidebarNav ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
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
                className={`w-12 h-7 rounded-full p-1 transition-colors duration-150 ease-in-out shrink-0 ${
                  privacy[item.key] ? 'bg-secondary' : 'bg-gray-300 dark:bg-gray-700'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform duration-150 ease-in-out ${
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
          Обновления приложения
        </h3>
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-bg text-dark">
                <Icons.Refresh size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-dark">Текущая версия</h4>
                <p className="text-xs text-textMuted">DarkMSAL v1.0.0 ({platformLabel})</p>
              </div>
            </div>

            <button
              onClick={handleCheckUpdates}
              disabled={checkingUpdate}
              className="px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-all flex items-center space-x-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <Icons.Refresh size={14} className={checkingUpdate ? 'animate-spin' : ''} />
              <span>{checkingUpdate ? 'Проверка...' : 'Проверить'}</span>
            </button>
          </div>

          {updateStatus && (
            <div className={`p-3 rounded-xl text-xs flex items-center justify-between ${
              updateStatus.hasUpdate
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-semibold'
                : 'bg-bg text-textMuted border border-border'
            }`}>
              <span>{updateStatus.text}</span>
              {updateStatus.hasUpdate && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('app-show-update-modal', { detail: updateStatus.info }))}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[11px] shadow-sm hover:bg-emerald-700 transition-colors"
                >
                  Установить
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Legal & Compliance Section */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3 px-1">
          Правовая информация
        </h3>
        <Card className="p-0 overflow-hidden divide-y divide-border">
          <button
            onClick={() => setLegalModalTab('privacy')}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-bg/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center space-x-3">
              <Icons.Shield size={18} className="text-secondary" />
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-dark">Политика обработки персональных данных</h4>
                <p className="text-[11px] text-textMuted">Соответствие 152-ФЗ и локальная безопасность</p>
              </div>
            </div>
            <Icons.ChevronRight size={16} className="text-textMuted" />
          </button>

          <button
            onClick={() => setLegalModalTab('disclaimer')}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-bg/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center space-x-3">
              <Icons.AlertCircle size={18} className="text-secondary" />
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-dark">Отказ от ответственности</h4>
                <p className="text-[11px] text-textMuted">Независимый статус клиента и условия использования</p>
              </div>
            </div>
            <Icons.ChevronRight size={16} className="text-textMuted" />
          </button>

          <button
            onClick={() => setLegalModalTab('terms')}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-bg/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center space-x-3">
              <Icons.BookOpen size={18} className="text-secondary" />
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-dark">Пользовательское соглашение</h4>
                <p className="text-[11px] text-textMuted">Лицензия и правила доступа к сервисам</p>
              </div>
            </div>
            <Icons.ChevronRight size={16} className="text-textMuted" />
          </button>
        </Card>
      </div>

      {/* Logout Action */}
      <div className="pt-2">
        <button
          onClick={() => {
            if (window.confirm('Вы действительно хотите выйти из аккаунта?')) {
              logout();
              navigate('/login');
            }
          }}
          className="w-full py-3 px-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold text-sm transition-all flex items-center justify-center space-x-2 border border-rose-500/20"
        >
          <Icons.LogOut size={18} />
          <span>Выйти из аккаунта</span>
        </button>
      </div>

      <LegalModal
        isOpen={Boolean(legalModalTab)}
        initialTab={legalModalTab || 'privacy'}
        onClose={() => setLegalModalTab(null)}
      />
    </div>
  );
};

export default SettingsPage;
