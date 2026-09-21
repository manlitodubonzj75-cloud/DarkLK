import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Icons } from '../common/Icons';
import { Logo } from '../common/Logo';
import { LegalModal } from '../common/LegalModal';
import { useDeviceAdaptive } from "../../hooks/useDeviceAdaptive";
import { PullToRefresh } from "../common/PullToRefresh";

export const AppShell = () => {
  const { user, logout, isCollege, isOffline, isSyncing, lastSyncTime, retrySync } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [legalModalTab, setLegalModalTab] = React.useState(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const device = useDeviceAdaptive();

  const ALL_NAV_ITEMS = [
    { to: '/', label: 'Главная', icon: Icons.Home },
    { to: '/schedule', label: 'Расписание', icon: Icons.Calendar },
    { to: '/grades', label: 'Оценки', icon: Icons.GraduationCap },
    { to: '/recordbook', label: 'Зачётка', icon: Icons.BookOpen },
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

  const photoUrl = (typeof user?.photo === 'string' && user.photo.trim())
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

  return (
    <div className="flex h-screen w-full bg-bg dark:bg-[#12151B] text-dark dark:text-white font-sans overflow-hidden transition-colors duration-200">
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
          className="p-3 mx-3 my-4 rounded-2xl bg-white/10 dark:bg-[#1F2430] hover:bg-white/15 dark:hover:bg-[#262D3D] active:scale-[0.98] flex items-center space-x-3 cursor-pointer transition-all border border-white/10 dark:border-[#2B3242] group shadow-sm"
          title="Открыть профиль и настройки"
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt="Avatar"
              className="w-10 h-10 rounded-full object-cover border-2 border-accent dark:border-[#22869A] shrink-0 group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-accent dark:bg-[#22869A] flex items-center justify-center font-bold text-white text-sm shrink-0 group-hover:scale-105 transition-transform">
              {getInitials(user?.name)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate text-white">
              {user?.name || 'Студент'}
            </p>
            <p className="text-xs text-white/70 dark:text-[#8E98A8] truncate">
              {user?.group || user?.role || 'Студент'}
            </p>
          </div>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 px-3 space-y-1.5 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-4 py-3 rounded-2xl font-semibold text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-card text-primary dark:bg-[#1E6685] dark:text-white shadow-sm font-bold'
                    : 'text-white/80 dark:text-[#8E98A8] hover:bg-white/10 dark:hover:bg-[#1F2430] dark:hover:text-white'
                }`
              }
            >
              <item.icon size={20} className="shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Desktop Quick Refresh Button */}
        <div className="px-3 py-2 border-t border-white/5 dark:border-[#1E2330]">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="w-full flex items-center justify-center space-x-2.5 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 dark:bg-[#1E2430] dark:hover:bg-[#272F3F] text-white/90 text-xs font-semibold transition-all active:scale-95 border border-white/10 dark:border-[#283245] shadow-sm disabled:opacity-50"
            title="Обновить данные расписания и оценок с сервера"
          >
            <Icons.Refresh size={16} className={`shrink-0 ${isRefreshing ? 'animate-spin text-accent dark:text-[#38BDF8]' : ''}`} />
            <span>{isRefreshing ? 'Обновление данных...' : 'Обновить данные'}</span>
          </button>
        </div>

        {/* Legal & version sub-bar */}
        <div className="px-4 py-2 border-t border-white/5 dark:border-[#1E2330] flex items-center justify-between text-[10px] text-white/50 dark:text-[#8E98A8]">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setLegalModalTab('terms')}
              className="hover:underline hover:text-white/80"
            >
              Условия
            </button>
            <span>•</span>
            <button
              onClick={() => setLegalModalTab('privacy')}
              className="hover:underline hover:text-white/80"
            >
              Конфиденциальность
            </button>
          </div>
          <span className="font-mono font-semibold text-accent dark:text-[#38BDF8]">v2.0.1</span>
        </div>

        {/* Sidebar Footer Controls */}
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
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Mobile Header Bar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-card dark:bg-[#1F2430] border-b border-border dark:border-[#212634] z-10 shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div
            onClick={() => navigate('/settings')}
            className="flex items-center space-x-3 cursor-pointer hover:opacity-85 transition-opacity"
            title="Открыть профиль и настройки"
          >
            {photoUrl ? (
              <img src={photoUrl} alt="Avatar" className="w-9 h-9 rounded-full object-cover border border-accent dark:border-[#22869A]" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-accent dark:bg-[#22869A] flex items-center justify-center font-bold text-white text-xs">
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

        {/* Global Offline / Cached Data Banner */}
        {isOffline && (
          <div className="bg-amber-500/15 dark:bg-amber-500/20 border-b border-amber-500/30 text-amber-800 dark:text-amber-200 px-4 py-2 flex items-center justify-between text-xs transition-all shrink-0 z-10">
            <div className="flex items-center space-x-2 min-w-0">
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
              <Icons.Refresh size={12} className={isSyncing ? "animate-spin" : ""} />
              <span>{isSyncing ? "Синхронизация..." : "Обновить"}</span>
            </button>
          </div>
        )}

        {/* Scrollable Page Body with Single Root Pull-to-Refresh */}
        <main className="flex-1 overflow-hidden bg-bg dark:bg-[#12151B] w-full min-w-0 flex flex-col">
          <PullToRefresh>
            <div className="p-3 sm:p-5 md:p-8 max-w-5xl mx-auto pb-24 md:pb-8 w-full min-w-0">
              <Outlet />
            </div>
          </PullToRefresh>
        </main>

        {/* MOBILE BOTTOM NAVIGATION BAR */}
        <nav className="md:hidden flex items-center justify-around bg-card dark:bg-[#1F2430] border-t border-border dark:border-[#212634] px-2 py-2 z-10 shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center py-1 px-3 rounded-xl transition-all ${
                  isActive
                    ? 'text-primary dark:text-[#38BDF8] font-bold scale-105'
                    : 'text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
                }`
              }
            >
              <item.icon size={22} />
              <span className="text-[10px] mt-1 tracking-tight">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <LegalModal
        isOpen={Boolean(legalModalTab)}
        initialTab={legalModalTab || 'terms'}
        onClose={() => setLegalModalTab(null)}
      />
    </div>
  );
};
