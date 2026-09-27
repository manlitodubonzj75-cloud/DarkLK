import React from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Logo } from '../common/Logo';
import { LegalModal } from '../common/LegalModal';
import { UpdateModal } from '../common/UpdateModal';
import { updateService } from '../../api/updateService';
import { PullToRefresh } from "../common/PullToRefresh";

export const AppShell = () => {
  const { user, logout, isCollege, isOffline, isSyncing, retrySync, lastSyncTime } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [legalModalTab, setLegalModalTab] = React.useState(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [updateInfo, setUpdateInfo] = React.useState(null);
  const [showUpdateModal, setShowUpdateModal] = React.useState(false);
  const [showLegalGate, setShowLegalGate] = React.useState(() => {
    return !Boolean(localStorage.getItem("msal_legal_accepted_v1"));
  });
  const [photoError, setPhotoError] = React.useState(false);

  const ALL_NAV_ITEMS = [
    { to: '/', label: 'Главная', icon: Icons.Home },
    { to: '/schedule', label: 'Расписание', icon: Icons.Calendar },
    { to: '/grades', label: 'Оценки', icon: Icons.GraduationCap },
    { to: '/recordbook', label: 'Зачётка', icon: Icons.BookOpen },
    { to: '/mail', label: 'Почта', icon: Icons.Mail },
    { to: '/consultations', label: 'Отработки', icon: Icons.UserCheck },
  ];

  const NAV_ITEMS = isCollege
    ? ALL_NAV_ITEMS.filter(item => item.to !== '/consultations')
    : ALL_NAV_ITEMS;

  const getInitials = (name = '') => {
    if (!name || typeof name !== 'string') return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const photoUrl = (!photoError && typeof user?.photo === 'string' && user.photo.trim())
    ? (user.photo.startsWith('http') ? user.photo : `https://lk.msal.ru:3443/${user.photo}`)
    : null;

  const formatSyncTime = (timestamp) => {
    if (!timestamp) return 'недавно';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMin = Math.round((now.getTime() - date.getTime()) / 60000);

    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин. назад`;

    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  React.useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await updateService.checkForUpdates({ force: false });
      if (res?.hasUpdate) {
        setUpdateInfo(res);
        setShowUpdateModal(true);
      }
    }, 2500);

    const handleManualCheckEvent = (e) => {
      if (e.detail) {
        setUpdateInfo(e.detail);
        setShowUpdateModal(true);
      }
    };

    window.addEventListener('app-show-update-modal', handleManualCheckEvent);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('app-show-update-modal', handleManualCheckEvent);
    };
  }, []);

  const handleManualRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent('app-pull-to-refresh'));
    if (retrySync) {
      try {
        await retrySync();
      } catch (_) {}
    }
    setTimeout(() => {
      setIsRefreshing(false);
    }, 850);
  };

  const isMailRoute = location.pathname.startsWith('/mail');

  return (
    <div className="flex w-full h-full min-h-0 min-w-0 bg-bg dark:bg-[#12151B] text-dark dark:text-white font-sans overflow-hidden transition-colors duration-200">
      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex flex-col w-64 h-full bg-primary dark:bg-[#12151B] text-white border-r border-white/10 dark:border-[#212634] shadow-xl z-20 shrink-0">
        {/* Logo */}
        <div className="p-5 pt-6 flex items-center space-x-3 border-b border-white/10 dark:border-[#212634]">
          <Logo size={42} className="shrink-0 ring-1 ring-white/20" />
          <div className="min-w-0">
            <h1 className="text-white font-black text-lg tracking-wide leading-tight">DarkMSAL</h1>
            <p className="text-[10px] text-white/70 dark:text-[#8E98A8] font-medium leading-tight truncate">для Альма Матер с любовью.</p>
          </div>
        </div>

        {/* User Profile Card */}
        <div
          onClick={() => navigate('/settings')}
          className="p-4 mx-3 my-4 rounded-2xl bg-white/10 dark:bg-[#1F2430] border border-white/10 dark:border-[#283245] flex items-center space-x-3 cursor-pointer hover:bg-white/15 dark:hover:bg-[#257C9F] transition-all group"
          title="Открыть профиль и настройки"
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt="Avatar"
              onError={() => setPhotoError(true)}
              className="w-12 h-12 rounded-full object-cover border-2 border-white/30 dark:border-[#283245] shadow-inner shrink-0 group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-accent dark:bg-[#22869A] flex items-center justify-center font-bold text-base text-white shadow-inner shrink-0 group-hover:scale-105 transition-transform">
              {getInitials(user?.name)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-white truncate group-hover:text-accent dark:group-hover:text-white transition-colors">
              {user?.name || 'Студент'}
            </h3>
            <p className="text-xs text-white/70 dark:text-[#8E98A8] truncate mt-0.5">
              {user?.group || 'Группа не указана'}
            </p>
          </div>
          <Icons.ChevronRight size={16} className="text-white/40 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 space-y-1.5 overflow-y-auto no-scrollbar">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all ${
                  isActive
                    ? 'bg-white/20 dark:bg-[#1E6685] text-white shadow-md'
                    : 'text-white/80 dark:text-[#8E98A8] hover:bg-white/10 dark:hover:bg-[#1E2430] hover:text-white'
                }`
              }
            >
              <item.icon size={20} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Desktop Manual Refresh Button */}
        <div className="px-3 py-2">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="w-full flex items-center justify-center space-x-2.5 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 dark:bg-[#1E2430] dark:hover:bg-[#272F3F] text-white/90 text-xs font-semibold transition-all active:scale-95 border border-white/10 dark:border-[#283245] shadow-sm disabled:opacity-50"
            title="Обновить данные расписания и оценок с сервера"
          >
            <Icons.RefreshCw size={16} className={`shrink-0 ${isRefreshing ? 'animate-spin text-accent dark:text-[#38BDF8]' : ''}`} />
            <span>{isRefreshing ? 'Обновление данных...' : 'Обновить данные'}</span>
          </button>
        </div>

        {/* Legal & version sub-bar */}
        <div className="px-4 py-2 border-t border-white/5 dark:border-[#1E2330] flex items-center justify-between text-[10px] text-white/50 dark:text-[#8E98A8]">
          <button
            onClick={() => setLegalModalTab('privacy')}
            className="hover:underline hover:text-white/80 transition-colors"
          >
            152-ФЗ / Безопасность
          </button>
          <span>v1.0.0</span>
        </div>

        {/* Theme Toggle & Logout */}
        <div className="p-4 border-t border-white/10 dark:border-[#212634] flex items-center justify-between">
          <button
            onClick={toggleTheme}
            className="flex items-center space-x-2 text-xs font-semibold text-white/80 dark:text-[#8E98A8] hover:text-white transition-colors"
          >
            {isDark ? <Icons.Sun size={18} /> : <Icons.Moon size={18} />}
            <span>{isDark ? 'Светлая' : 'Тёмная'}</span>
          </button>

          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="p-2 rounded-xl text-white/70 hover:text-rose-400 hover:bg-white/10 transition-colors"
            title="Выйти из аккаунта"
          >
            <Icons.LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* MAIN VIEW AREA */}
      <div className="flex-1 flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
        {/* Mobile Header Bar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-card dark:bg-[#1F2430] border-b border-border dark:border-[#212634] z-10 shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div
            onClick={() => navigate('/settings')}
            className="flex items-center space-x-3 cursor-pointer hover:opacity-85 transition-opacity"
            title="Открыть профиль и настройки"
          >
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Avatar"
                onError={() => setPhotoError(true)}
                className="w-9 h-9 rounded-full object-cover border border-accent dark:border-[#22869A]"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-accent dark:bg-[#22869A] flex items-center justify-center font-bold text-white text-xs shadow-inner">
                {getInitials(user?.name)}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-dark dark:text-white truncate">
                {user?.name || 'Студент'}
              </h2>
              <p className="text-[11px] text-textMuted dark:text-[#8E98A8] truncate">
                {user?.group || 'МГЮА'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-textMuted dark:text-[#8E98A8] hover:bg-bg dark:hover:bg-[#262D3D]"
            >
              {isDark ? <Icons.Sun size={18} /> : <Icons.Moon size={18} />}
            </button>
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="p-2 rounded-xl text-textMuted dark:text-[#8E98A8] hover:text-rose-500"
            >
              <Icons.LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Global Offline/Stale Banner */}
        {isOffline && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between text-xs text-amber-800 dark:text-amber-200 shrink-0">
            <div className="flex items-center space-x-2 truncate">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <span className="font-medium truncate">
                Автономный режим • Данные из кэша (актуально на: {formatSyncTime(lastSyncTime)})
              </span>
            </div>
            <button
              onClick={retrySync}
              disabled={isSyncing}
              className="ml-3 shrink-0 inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 active:scale-95 text-amber-900 dark:text-amber-100 font-semibold transition-all disabled:opacity-50"
              title="Повторить попытку подключения к серверу"
            >
              <Icons.RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
              <span>{isSyncing ? "Синхронизация..." : "Обновить"}</span>
            </button>
          </div>
        )}

        {/* Scrollable Page Body with Single Root Pull-to-Refresh */}
        <main className="flex-1 overflow-hidden min-h-0 min-w-0 bg-bg dark:bg-[#12151B] w-full flex flex-col">
          {isMailRoute ? (
            <div className="h-full w-full flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
              <Outlet />
            </div>
          ) : (
            <PullToRefresh>
              <div className="p-3 sm:p-5 md:p-8 max-w-5xl mx-auto pb-24 md:pb-8 w-full min-w-0">
                <Outlet />
              </div>
            </PullToRefresh>
          )}
        </main>

        {/* MOBILE BOTTOM NAVIGATION BAR */}
        <nav className="md:hidden flex items-center justify-around bg-card dark:bg-[#1F2430] border-t border-border dark:border-[#212634] px-1 py-1.5 z-10 shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center py-1 px-2 rounded-xl transition-all ${
                  isActive
                    ? 'text-primary dark:text-[#38BDF8] font-bold scale-105'
                    : 'text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
                }`
              }
            >
              <item.icon size={20} />
              <span className="text-[10px] mt-0.5 tracking-tight">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <LegalModal
        isOpen={Boolean(legalModalTab)}
        initialTab={legalModalTab || 'terms'}
        onClose={() => setLegalModalTab(null)}
      />

      {showLegalGate && (
        <LegalModal
          isOpen={true}
          initialTab="terms"
          showAcceptButton={true}
          onClose={() => {
            localStorage.setItem("msal_legal_accepted_v1", "true");
            setShowLegalGate(false);
          }}
        />
      )}

      {showUpdateModal && updateInfo && (
        <UpdateModal
          isOpen={true}
          updateInfo={updateInfo}
          onClose={() => setShowUpdateModal(false)}
        />
      )}
    </div>
  );
};
