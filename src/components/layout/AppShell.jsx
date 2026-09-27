import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Icons } from '../common/Icons';
import { Logo } from '../common/Logo';
import { LegalModal } from '../common/LegalModal';
import { UpdateModal } from '../common/UpdateModal';
import { updateService, APP_VERSION } from '../../api/updateService';
import { PullToRefresh } from "../common/PullToRefresh";

export const AppShell = () => {
  const { user, logout, isCollege, isOffline, isSyncing, lastSyncTime, retrySync } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMailRoute = location.pathname.startsWith('/mail');
  const [legalModalTab, setLegalModalTab] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showLegalGate, setShowLegalGate] = useState(() => {
    return !Boolean(localStorage.getItem("msal_legal_accepted_v1"));
  });

  // Mobile layout mode: 'bottombar' vs 'sidebar' (hides bottom nav completely, puts all navigation + actions into sidebar drawer)
  const [mobileLayoutMode, setMobileLayoutMode] = useState(() => {
    try {
      return localStorage.getItem('msal_mobile_layout_mode') || 'bottombar';
    } catch (_) {
      return 'bottombar';
    }
  });

  // Mobile side drawer state
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setIsMobileDrawerOpen(false);
  }, [location.pathname]);

  // Close drawer with Esc (hardware keyboards / desktop browsers at narrow widths)
  useEffect(() => {
    if (!isMobileDrawerOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsMobileDrawerOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileDrawerOpen]);

  // Re-render the offline banner every minute so "N мин. назад" doesn't go stale
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!isOffline) return undefined;
    const id = setInterval(() => setNowTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [isOffline]);

  // Listen for layout changes from SettingsPage
  useEffect(() => {
    const handleLayoutChange = (e) => {
      if (e.detail) {
        setMobileLayoutMode(e.detail);
      }
    };
    window.addEventListener('msal_mobile_layout_changed', handleLayoutChange);
    return () => window.removeEventListener('msal_mobile_layout_changed', handleLayoutChange);
  }, []);

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

  useEffect(() => {
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

  return (
    <div className="flex h-full h-[100dvh] w-full bg-bg dark:bg-[#12151B] text-dark dark:text-white font-sans overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex flex-col w-64 h-full bg-primary dark:bg-[#12151B] text-white border-r border-white/10 dark:border-[#212634] shadow-xl z-20 shrink-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
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
        >
          {photoUrl ? (
            <img src={photoUrl} alt="Avatar" className="w-12 h-12 rounded-full object-cover border-2 border-white/30 dark:border-[#283245] shadow-inner shrink-0 group-hover:scale-105 transition-transform" />
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
            <Icons.Refresh size={16} className={`shrink-0 ${isRefreshing ? 'animate-spin text-accent dark:text-[#38BDF8]' : ''}`} />
            <span>{isRefreshing ? 'Обновление данных...' : 'Обновить данные'}</span>
          </button>
        </div>

        {/* Legal & version sub-bar */}
        <div className="px-4 py-2 border-t border-white/5 dark:border-[#1E2330] flex items-center justify-between text-[10px] text-white/50 dark:text-[#8E98A8]">
          <button
            onClick={() => setLegalModalTab('privacy')}
            className="hover:underline hover:text-white/80 transition-colors"
          >
            Данные и безопасность
          </button>
          <span>v{APP_VERSION}</span>
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

      {/* MOBILE SIDEBAR DRAWER OVERLAY & PANEL */}
      {mobileLayoutMode === 'sidebar' && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsMobileDrawerOpen(false)}
            className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
              isMobileDrawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
          />

          {/* Drawer Sheet */}
          <aside
            className={`md:hidden fixed top-0 bottom-0 left-0 w-72 max-w-[82vw] z-50 bg-primary dark:bg-[#12151B] text-white flex flex-col shadow-2xl transition-transform duration-200 ease-out pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] border-r border-white/10 dark:border-[#212634] ${
              isMobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {/* Drawer Header */}
            <div className="p-4 flex items-center justify-between border-b border-white/10 dark:border-[#212634]">
              <div className="flex items-center space-x-2.5">
                <Logo size={32} className="shrink-0" />
                <span className="font-black text-base tracking-wide">DarkMSAL</span>
              </div>
              <button
                onClick={() => setIsMobileDrawerOpen(false)}
                aria-label="Закрыть меню"
                className="p-1.5 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Icons.X size={20} />
              </button>
            </div>

            {/* User Profile in Drawer */}
            <div
              onClick={() => {
                setIsMobileDrawerOpen(false);
                navigate('/settings');
              }}
              className="p-3.5 mx-3 my-3 rounded-2xl bg-white/10 dark:bg-[#1F2430] border border-white/10 dark:border-[#283245] flex items-center space-x-3 cursor-pointer hover:bg-white/15 transition-all"
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Avatar" className="w-11 h-11 rounded-full object-cover border border-white/30 shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-accent dark:bg-[#22869A] flex items-center justify-center font-bold text-white text-sm shrink-0">
                  {getInitials(user?.name)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-white truncate">{user?.name || 'Студент'}</h3>
                <p className="text-[11px] text-white/70 dark:text-[#8E98A8] truncate mt-0.5">{user?.group || 'МГЮА'}</p>
              </div>
              <Icons.ChevronRight size={16} className="text-white/40 shrink-0" />
            </div>

            {/* All Navigation Links inside Drawer */}
            <nav className="flex-1 px-3 space-y-1 overflow-y-auto no-scrollbar">
              <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white/50">
                Разделы
              </div>
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setIsMobileDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
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

            {/* Quick Actions and Settings */}
            <div className="p-3 border-t border-white/10 dark:border-[#212634] space-y-1.5">
              <button
                onClick={() => {
                  toggleTheme();
                }}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 dark:bg-[#1E2430] dark:hover:bg-[#272F3F] text-white transition-all cursor-pointer"
              >
                <div className="flex items-center space-x-3">
                  {isDark ? <Icons.Sun size={18} className="text-amber-400" /> : <Icons.Moon size={18} className="text-sky-300" />}
                  <span>Тёмная тема</span>
                </div>
                <span className="text-xs text-white/60 font-normal">{isDark ? 'Вкл' : 'Выкл'}</span>
              </button>

              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 dark:bg-[#1E2430] dark:hover:bg-[#272F3F] text-white transition-all disabled:opacity-50 cursor-pointer"
              >
                <Icons.Refresh size={18} className={`shrink-0 ${isRefreshing ? 'animate-spin text-accent dark:text-[#38BDF8]' : ''}`} />
                <span>{isRefreshing ? 'Синхронизация...' : 'Обновить данные'}</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  navigate('/settings');
                }}
                className="w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 dark:bg-[#1E2430] dark:hover:bg-[#272F3F] text-white transition-all cursor-pointer"
              >
                <Icons.Settings size={18} />
                <span>Настройки</span>
              </button>
            </div>

            {/* Drawer Bottom Actions */}
            <div className="p-3 border-t border-white/10 dark:border-[#212634]">
              <button
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  if (window.confirm('Вы действительно хотите выйти из аккаунта?')) {
                    logout();
                    navigate('/login');
                  }
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-semibold flex items-center justify-center space-x-2 transition-all cursor-pointer"
              >
                <Icons.LogOut size={16} />
                <span>Выйти из аккаунта</span>
              </button>
            </div>
          </aside>
        </>
      )}

      {/* MAIN VIEW AREA */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden md:pt-[env(safe-area-inset-top)]">
        {/* Mobile Header Bar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-card dark:bg-[#1F2430] border-b border-border dark:border-[#212634] z-10 shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {mobileLayoutMode === 'sidebar' ? (
            /* Sidebar Mode Header: Menu hamburger + Title/Route, Theme and Profile button */
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(true)}
                className="p-2 -ml-2 rounded-xl text-dark dark:text-white hover:bg-bg dark:hover:bg-[#262D3D] transition-colors cursor-pointer"
                title="Открыть меню"
                aria-label="Открыть меню"
              >
                <Icons.Menu size={22} />
              </button>

              <div
                onClick={() => navigate('/')}
                className="flex items-center space-x-2 cursor-pointer"
              >
                <Logo size={26} className="shrink-0" />
                <span className="font-black text-base tracking-wide text-dark dark:text-white">DarkMSAL</span>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-xl text-textMuted dark:text-[#8E98A8] hover:bg-bg dark:hover:bg-[#262D3D]"
                  title="Переключить тему"
                >
                  {isDark ? <Icons.Sun size={18} /> : <Icons.Moon size={18} />}
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className="p-1 rounded-full border border-accent dark:border-[#22869A] shrink-0"
                  title="Настройки"
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="Avatar" className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-accent dark:bg-[#22869A] flex items-center justify-center font-bold text-white text-[10px]">
                      {getInitials(user?.name)}
                    </div>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Standard Mode Header: User avatar + info, theme toggle and logout */
            <>
              <div
                onClick={() => navigate('/settings')}
                className="flex items-center space-x-3 cursor-pointer hover:opacity-85 transition-opacity min-w-0 flex-1 mr-2"
                title="Открыть профиль и настройки"
              >
                {photoUrl ? (
                  <img src={photoUrl} alt="Avatar" className="w-9 h-9 rounded-full object-cover border border-accent dark:border-[#22869A] shrink-0" />
                ) : (
                  <div className="w-9 h-9 shrink-0 rounded-full bg-accent dark:bg-[#22869A] flex items-center justify-center font-bold text-white text-xs">
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

              <div className="flex items-center space-x-1 shrink-0">
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-xl text-textMuted dark:text-[#8E98A8] hover:bg-bg dark:hover:bg-[#262D3D]"
                  title="Переключить тему"
                  aria-label="Переключить тему"
                >
                  {isDark ? <Icons.Sun size={18} /> : <Icons.Moon size={18} />}
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('Вы действительно хотите выйти из аккаунта?')) {
                      logout();
                      navigate('/login');
                    }
                  }}
                  className="p-2 rounded-xl text-textMuted dark:text-[#8E98A8] hover:text-rose-500"
                  title="Выйти из аккаунта"
                  aria-label="Выйти из аккаунта"
                >
                  <Icons.LogOut size={18} />
                </button>
              </div>
            </>
          )}
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
          {isMailRoute ? (
            <div className={`h-full w-full flex-1 min-w-0 overflow-hidden flex flex-col ${mobileLayoutMode === 'sidebar' ? 'pb-[env(safe-area-inset-bottom)]' : 'pb-0'} md:pb-0`}>
              <Outlet />
            </div>
          ) : (
            <PullToRefresh>
              <div className={`p-3 sm:p-5 md:p-8 max-w-5xl mx-auto ${mobileLayoutMode === 'sidebar' ? 'pb-[max(2rem,env(safe-area-inset-bottom))]' : 'pb-24'} md:pb-8 w-full min-w-0`}>
                <Outlet />
              </div>
            </PullToRefresh>
          )}
        </main>

        {/* MOBILE BOTTOM NAVIGATION BAR (shown ONLY in bottombar mode) */}
        {mobileLayoutMode === 'bottombar' && (
          <nav className="md:hidden flex items-center justify-around bg-card dark:bg-[#1F2430] border-t border-border dark:border-[#212634] px-1 py-1.5 z-10 shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex flex-col items-center py-1 px-1 sm:px-2 rounded-xl transition-all ${
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
        )}
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

      <UpdateModal
        isOpen={showUpdateModal}
        updateInfo={updateInfo}
        onClose={() => setShowUpdateModal(false)}
      />
    </div>
  );
};

export default AppShell;
