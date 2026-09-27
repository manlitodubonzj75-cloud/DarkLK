import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { mailService, cacheService } from '../../api';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { Card } from '../../components/common/Card';
import * as Icons from 'lucide-react';

export const MailPage = () => {
  const { user } = useAuth();
  const { isDark } = useTheme();

  // Auth & Connection State
  const [isMailAuth, setIsMailAuth] = useState(false);
  const [mailUser, setMailUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [loginError, setLoginError] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Form State
  const [loginForm, setLoginForm] = useState({
    username: user?.email || user?.login || '',
    password: ''
  });

  // Mail Data State - initialize with cached folders if present
  const [folders, setFolders] = useState(() => {
    const cached = cacheService.get('mail_folders');
    if (Array.isArray(cached) && cached.length > 0) return cached;
    return [
      { id: 'inbox', name: 'Входящие', icon: 'Inbox', unreadCount: 0 },
      { id: 'sentitems', name: 'Отправленные', icon: 'Send', unreadCount: 0 },
      { id: 'drafts', name: 'Черновики', icon: 'FileText', unreadCount: 0 },
      { id: 'deleteditems', name: 'Удалённые', icon: 'Trash2', unreadCount: 0 },
      { id: 'junkemail', name: 'Спам', icon: 'AlertOctagon', unreadCount: 0 }
    ];
  });
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [conversations, setConversations] = useState(() => {
    const cached = cacheService.get('mail_convs_inbox');
    return Array.isArray(cached) ? cached : [];
  });
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [selectedMessage, setSelectedMessage] = useState(null);

  // UI / Loading State
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendSuccessNotice, setSendSuccessNotice] = useState(false);

  // Compose State
  const [composeData, setComposeData] = useState({
    to: '',
    subject: '',
    body: ''
  });

  // Check Mail Auth on Mount with Silent LK Auto-Login
  useEffect(() => {
    let isMounted = true;
    async function check() {
      try {
        const auth = await mailService.checkAuth();
        if (isMounted) {
          setIsMailAuth(auth.isAuthenticated);
          setMailUser(auth.username);
          if (auth.isAuthenticated) {
            loadMailData('inbox');
          }
        }
      } catch (err) {
        console.warn('[MailPage] Auth check warning:', err.message);
      } finally {
        if (isMounted) setIsCheckingAuth(false);
      }
    }
    check();
    return () => { isMounted = false; };
  }, []);

  const loadMailData = async (folderId = activeFolder) => {
    // Check if we have instant cached conversations for this folder to show immediately
    const cachedForFolder = cacheService.get(`mail_convs_${folderId}`);
    if (Array.isArray(cachedForFolder) && cachedForFolder.length > 0) {
      setConversations(cachedForFolder);
    }

    setIsLoadingList(true);
    try {
      const [folderList, convList] = await Promise.allSettled([
        mailService.getFolders(),
        mailService.getConversations({ folderId, offset: 0, limit: 30 })
      ]);

      if (folderList.status === 'fulfilled' && Array.isArray(folderList.value)) {
        setFolders(folderList.value);
      }

      if (convList.status === 'fulfilled' && Array.isArray(convList.value)) {
        setConversations(convList.value);
        if (window.innerWidth >= 1024 && convList.value.length > 0 && !selectedConversation) {
          handleSelectConversation(convList.value[0]);
        }
      }
    } catch (err) {
      console.error('[MailPage] Failed to load mail data:', err);
    } finally {
      setIsLoadingList(false);
    }
  };

  // Pull-to-refresh support
  useEffect(() => {
    const handlePull = () => {
      if (isMailAuth) {
        loadMailData(activeFolder);
      }
    };
    window.addEventListener('app-pull-to-refresh', handlePull);
    return () => window.removeEventListener('app-pull-to-refresh', handlePull);
  }, [isMailAuth, activeFolder]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!loginForm.username || !loginForm.password) {
      setLoginError('Введите логин и пароль');
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      await mailService.login(loginForm.username, loginForm.password);
      setIsMailAuth(true);
      setMailUser(loginForm.username);
      await loadMailData('inbox');
    } catch (err) {
      setLoginError(err.message || 'Ошибка авторизации на сервере почты');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Вы действительно хотите выйти из почты на этом устройстве?')) {
      await mailService.logout();
      setIsMailAuth(false);
      setMailUser(null);
      setConversations([]);
      setSelectedConversation(null);
      setSelectedMessage(null);
    }
  };

  const handleSelectFolder = (folderId) => {
    setActiveFolder(folderId);
    setSelectedConversation(null);
    setSelectedMessage(null);
    loadMailData(folderId);
  };

  const handleSelectConversation = async (conv) => {
    setSelectedConversation(conv);
    setSelectedMessage(null);
    const identifier = conv?.itemId || conv?.id;
    if (!identifier) return;

    // Check if message is already in cache
    const cachedMsg = cacheService.get(`mail_msg_${identifier}`);
    if (cachedMsg) {
      setSelectedMessage(cachedMsg);
    }

    setIsLoadingDetail(true);
    try {
      const msg = await mailService.getMessage(identifier);
      setSelectedMessage(msg || conv);
      // Mark as read locally
      setConversations(prev =>
        prev.map(c => c.id === conv.id ? { ...c, isRead: true, unreadCount: 0 } : c)
      );
    } catch (err) {
      console.error('[MailPage] Failed to fetch message detail:', err);
      if (!cachedMsg) {
        setSelectedMessage({
          ...conv,
          body: conv.snippet || '(Не удалось загрузить содержимое сообщения)',
          attachments: []
        });
      }
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleDeleteMessage = async (itemId) => {
    if (!itemId) return;
    if (!window.confirm('Переместить письмо в удалённые?')) return;

    try {
      await mailService.deleteItem(itemId);
      setConversations(prev => prev.filter(c => c.id !== itemId && c.itemId !== itemId));
      if (selectedConversation?.id === itemId || selectedConversation?.itemId === itemId) {
        setSelectedConversation(null);
        setSelectedMessage(null);
      }
    } catch (err) {
      alert(`Ошибка при удалении: ${err.message}`);
    }
  };

  const handleDownloadAttachment = async (att) => {
    if (!att?.id) return;
    try {
      await mailService.getAttachment(att.id, att.name, att.contentType);
    } catch (err) {
      alert(`Ошибка при скачивании вложения: ${err.message}`);
    }
  };

  const handleSendSubmit = async (e) => {
    e.preventDefault();
    if (!composeData.to) {
      alert('Укажите адрес получателя');
      return;
    }

    setIsSending(true);
    try {
      await mailService.sendEmail({
        to: composeData.to,
        subject: composeData.subject || '(Без темы)',
        body: composeData.body,
        isHtml: true
      });

      setShowComposeModal(false);
      setComposeData({ to: '', subject: '', body: '' });
      setSendSuccessNotice(true);
      setTimeout(() => setSendSuccessNotice(false), 4000);
      if (activeFolder === 'sentitems') {
        loadMailData('sentitems');
      }
    } catch (err) {
      alert(`Ошибка отправки письма: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const formatMailDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      }
      const isThisYear = d.getFullYear() === now.getFullYear();
      if (isThisYear) {
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      }
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' });
    } catch (_) {
      return dateStr;
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filteredConversations = (conversations || []).filter(c => {
    if (filterUnreadOnly && c.isRead) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.subject?.toLowerCase().includes(q) ||
      c.sender?.toLowerCase().includes(q)
    );
  });

  // Prepare sandboxed iframe content for email reading
  const renderSafeIframeDoc = (htmlBody) => {
    const isDarkTheme = isDark;
    const textColor = isDarkTheme ? '#E2E8F0' : '#1E293B';
    const bgColor = isDarkTheme ? '#1A1F2B' : '#FFFFFF';
    const linkColor = isDarkTheme ? '#38BDF8' : '#0284C7';

    const darkModeOverrides = isDarkTheme ? `
      /* Force dark theme overrides across hardcoded inline colors and tables */
      *, *::before, *::after {
        color: inherit !important;
        background-color: transparent !important;
        border-color: #334155 !important;
      }
      body {
        color: ${textColor} !important;
        background-color: ${bgColor} !important;
      }
      p, span, div, td, th, li, font, b, strong, em, i, h1, h2, h3, h4, h5, h6 {
        color: ${textColor} !important;
      }
      a, a *, a font, a span {
        color: ${linkColor} !important;
        text-decoration: underline;
      }
      img {
        max-width: 100%;
        height: auto;
        filter: brightness(0.92) contrast(1.05);
      }
      table {
        background-color: transparent !important;
        border-color: #334155 !important;
      }
      hr {
        border-color: #334155 !important;
      }
    ` : `
      body {
        color: ${textColor};
        background-color: ${bgColor};
      }
      a {
        color: ${linkColor};
        text-decoration: underline;
      }
      img {
        max-width: 100%;
        height: auto;
      }
    `;

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
          <style>
            html, body {
              margin: 0;
              padding: 16px;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              font-size: 14px;
              line-height: 1.6;
              word-break: break-word;
              overflow-wrap: break-word;
            }
            pre, code {
              white-space: pre-wrap;
              word-break: break-word;
              font-family: monospace;
            }
            blockquote {
              margin: 0.8em 0;
              padding-left: 12px;
              border-left: 3px solid #94A3B8;
              color: #94A3B8;
            }
            table {
              max-width: 100%;
              border-collapse: collapse;
              word-break: break-word;
            }
            ${darkModeOverrides}
          </style>
        </head>
        <body>
          ${htmlBody || '<p style="color: #94A3B8;">(Пустое тело письма)</p>'}
        </body>
      </html>
    `;
  };

  if (isCheckingAuth) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <LoadingSpinner size={10} text="Проверка подключения к почте..." />
      </div>
    );
  }

  // LOGIN SCREEN IF NOT AUTHENTICATED
  if (!isMailAuth) {
    return (
      <div className="flex-1 h-full overflow-y-auto p-4 md:p-8 flex items-center justify-center">
        <div className="max-w-md w-full">
          <div className="text-center mb-6">
            <div className="inline-flex p-4 rounded-3xl bg-primary/10 dark:bg-primary/20 text-primary mb-3">
              <Icons.Mail className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white">Корпоративная почта</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Microsoft Exchange (mail.msal.ru)
            </p>
          </div>

          <Card className="p-6 md:p-8 bg-white/80 dark:bg-[#1A1F2B]/90 backdrop-blur-xl border border-gray-200/50 dark:border-[#283245] shadow-xl rounded-3xl">
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {loginError && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-sm flex items-start space-x-2.5">
                  <Icons.AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Логин или почта
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                    <Icons.User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={loginForm.username}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                    placeholder="user@msal.ru или логин ЛК"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-gray-50 dark:bg-[#151922] border border-gray-200 dark:border-[#283245] text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Пароль
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                    <Icons.Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="Пароль от ЛК / Почты"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-gray-50 dark:bg-[#151922] border border-gray-200 dark:border-[#283245] text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3 px-4 rounded-2xl bg-primary hover:bg-primary/90 text-white text-sm font-semibold shadow-lg shadow-primary/25 transition-all flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                {isLoggingIn ? (
                  <>
                    <LoadingSpinner size={4} />
                    <span>Подключение к Exchange...</span>
                  </>
                ) : (
                  <>
                    <Icons.LogIn className="w-4 h-4" />
                    <span>Войти в почту</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-[#283245] text-center">
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 leading-relaxed">
                Пароль сохраняется исключительно в зашифрованном локальном хранилище вашего устройства для прозрачного обновления сессии.
              </p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // MAIN MAIL INTERFACE
  return (
    <div className="flex-1 flex h-full w-full min-w-0 overflow-hidden bg-bg dark:bg-[#12151B]">
      {/* Toast Notification */}
      {sendSuccessNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-2.5 px-4 py-3 rounded-2xl bg-emerald-500 text-white shadow-xl animate-in fade-in slide-in-from-bottom-5">
          <Icons.CheckCircle2 className="w-5 h-5" />
          <span className="text-sm font-medium">Письмо успешно отправлено!</span>
        </div>
      )}

      {/* LEFT COLUMN: Folders Navigation (Desktop) */}
      <aside className="hidden md:flex flex-col w-60 border-r border-gray-200/50 dark:border-[#212634] p-3 shrink-0">
        <button
          onClick={() => setShowComposeModal(true)}
          className="w-full mb-4 py-2.5 px-4 rounded-2xl bg-primary hover:bg-primary/90 text-white text-sm font-semibold shadow-md shadow-primary/20 flex items-center justify-center space-x-2 transition-all cursor-pointer"
        >
          <Icons.PenSquare className="w-4 h-4" />
          <span>Написать</span>
        </button>

        <div className="space-y-1 flex-1 overflow-y-auto">
          {folders.map(f => {
            const isActive = activeFolder === f.id;
            const IconComp = Icons[f.icon] || Icons.Folder;
            return (
              <button
                key={f.id}
                onClick={() => handleSelectFolder(f.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-sky-400 font-semibold'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#1A1F2B]'
                }`}
              >
                <div className="flex items-center space-x-2.5 truncate">
                  <IconComp className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary dark:text-sky-400' : 'text-gray-400'}`} />
                  <span className="truncate">{f.name}</span>
                </div>
                {f.unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-primary text-white font-bold text-[10px]">
                    {f.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* User Account & Logout */}
        <div className="pt-3 border-t border-gray-200/50 dark:border-[#212634] flex items-center justify-between px-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
              {mailUser}
            </p>
            <p className="text-[10px] text-gray-400">Exchange 2016</p>
          </div>
          <button
            onClick={handleLogout}
            title="Выйти из почты"
            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
          >
            <Icons.LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* MIDDLE COLUMN: Conversation / Message List */}
      <section className={`flex flex-col border-r border-gray-200/50 dark:border-[#212634] w-full min-w-0 max-w-full ${
        selectedConversation ? 'hidden lg:flex lg:w-80 xl:w-96' : 'flex-1 md:w-80 lg:w-96'
      } shrink-0 overflow-hidden`}>
        {/* Header with Search and Actions */}
        <div className="p-3 border-b border-gray-200/50 dark:border-[#212634] space-y-2.5">
          <div className="flex items-center justify-between md:hidden">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Почта</h1>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowComposeModal(true)}
                className="p-2 rounded-xl bg-primary text-white cursor-pointer"
                title="Написать письмо"
              >
                <Icons.PenSquare className="w-4 h-4" />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 rounded-xl text-gray-400 hover:text-rose-500 cursor-pointer"
              >
                <Icons.LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <Icons.Search className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по теме или автору..."
              className="w-full pl-8 pr-8 py-1.5 rounded-xl bg-gray-100 dark:bg-[#1A1F2B] border border-transparent dark:border-[#283245] text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Folder tabs (Mobile) & Refresh */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex md:hidden space-x-1 overflow-x-auto py-1 max-w-[calc(100%-2rem)]">
              {folders.slice(0, 4).map(f => (
                <button
                  key={f.id}
                  onClick={() => handleSelectFolder(f.id)}
                  className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap text-[11px] cursor-pointer ${
                    activeFolder === f.id
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 dark:bg-[#1A1F2B] text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>

            <div className="hidden md:flex items-center space-x-2">
              <button
                onClick={() => setFilterUnreadOnly(!filterUnreadOnly)}
                className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                  filterUnreadOnly
                    ? 'bg-primary text-white'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-[#1A1F2B]'
                }`}
              >
                Только непрочитанные
              </button>
            </div>

            <button
              onClick={() => loadMailData(activeFolder)}
              disabled={isLoadingList}
              title="Обновить список"
              className="p-1 rounded-lg text-gray-400 hover:text-primary transition-colors disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Icons.RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Email list */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#212634]/60 w-full min-w-0">
          {isLoadingList && conversations.length === 0 ? (
            <div className="p-8 text-center">
              <LoadingSpinner size={8} text="Загрузка писем..." />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">
              <Icons.Inbox className="w-10 h-10 mx-auto mb-2 stroke-1 opacity-50" />
              <p className="text-sm font-medium">Нет писем в этой папке</p>
            </div>
          ) : (
            filteredConversations.map(conv => {
              const isSelected = selectedConversation?.id === conv.id;
              return (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  className={`p-3.5 cursor-pointer transition-all w-full max-w-full overflow-hidden ${
                    isSelected
                      ? 'bg-primary/10 dark:bg-[#202738] border-l-4 border-primary'
                      : 'hover:bg-gray-50 dark:hover:bg-[#1A1F2B]/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 min-w-0">
                    <span className={`text-xs sm:text-sm truncate font-medium flex-1 min-w-0 ${
                      !conv.isRead
                        ? 'text-primary font-bold dark:text-sky-400'
                        : 'text-gray-800 dark:text-gray-200'
                    }`}>
                      {conv.sender}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0 ml-2">
                      {formatMailDate(conv.deliveryTime)}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5 min-w-0">
                    {!conv.isRead && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    )}
                    <h3 className={`text-xs sm:text-[13px] truncate flex-1 min-w-0 ${
                      !conv.isRead
                        ? 'font-bold text-gray-900 dark:text-white'
                        : 'font-normal text-gray-600 dark:text-gray-300'
                    }`}>
                      {conv.subject}
                    </h3>
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400 min-w-0">
                    <div className="flex items-center space-x-2 shrink-0">
                      {conv.hasAttachments && (
                        <Icons.Paperclip className="w-3 h-3 text-gray-400" />
                      )}
                      {conv.messageCount > 1 && (
                        <span className="px-1.5 py-0.2 rounded bg-gray-200 dark:bg-[#283245] text-[10px] font-semibold">
                          {conv.messageCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* RIGHT COLUMN: Message Detail Reading Pane */}
      <main className={`flex-1 flex flex-col h-full bg-white dark:bg-[#151922] min-w-0 overflow-hidden ${
        !selectedConversation ? 'hidden lg:flex items-center justify-center' : 'flex'
      }`}>
        {!selectedConversation ? (
          <div className="text-center text-gray-400 dark:text-gray-500 p-8">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-[#1A1F2B] flex items-center justify-center mx-auto mb-3 text-gray-300 dark:text-gray-600">
              <Icons.MailOpen className="w-8 h-8 stroke-1" />
            </div>
            <p className="text-sm font-medium">Выберите письмо для чтения</p>
            <p className="text-xs mt-1">Все письма изолированы в безопасном контейнере</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
            {/* Header / Actions toolbar */}
            <div className="p-3 sm:p-4 border-b border-gray-200/50 dark:border-[#212634] flex items-center justify-between bg-white/80 dark:bg-[#1A1F2B]/50 backdrop-blur-md min-w-0">
              <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                <button
                  onClick={() => { setSelectedConversation(null); setSelectedMessage(null); }}
                  className="lg:hidden p-1.5 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-[#283245] cursor-pointer shrink-0"
                  title="Назад к списку"
                >
                  <Icons.ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-white truncate flex-1 min-w-0">
                  {selectedMessage?.subject || selectedConversation.subject}
                </h2>
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                <button
                  onClick={() => {
                    setComposeData({
                      to: selectedMessage?.from?.email || '',
                      subject: `Re: ${selectedMessage?.subject || selectedConversation.subject}`,
                      body: `

--- Исходное сообщение ---
От: ${selectedMessage?.from?.name} <${selectedMessage?.from?.email}>
`
                    });
                    setShowComposeModal(true);
                  }}
                  className="p-2 rounded-xl text-gray-500 hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                  title="Ответить"
                >
                  <Icons.Reply className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleDeleteMessage(selectedMessage?.id || selectedConversation.itemId)}
                  className="p-2 rounded-xl text-gray-500 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                  title="Удалить"
                >
                  <Icons.Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sender / Recipients Info */}
            <div className="p-3 sm:p-4 border-b border-gray-100 dark:border-[#212634]/60 bg-gray-50/50 dark:bg-[#12151B]/40 min-w-0">
              <div className="flex items-start justify-between min-w-0">
                <div className="flex items-center space-x-3 min-w-0 flex-1 mr-2">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-primary/10 dark:bg-primary/20 text-primary flex items-center justify-center font-bold text-xs sm:text-sm shrink-0">
                    {selectedMessage?.from?.name?.slice(0, 2).toUpperCase() || selectedConversation.sender?.slice(0, 2).toUpperCase() || '??'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {selectedMessage?.from?.name || selectedConversation.sender}
                    </p>
                    <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 truncate">
                      {selectedMessage?.from?.email || ''}
                    </p>
                    {selectedMessage?.to?.length > 0 && (
                      <p className="text-[10px] sm:text-[11px] text-gray-400 mt-0.5 truncate">
                        Кому: {selectedMessage.to.map(r => r.name || r.email).join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[11px] sm:text-xs text-gray-400">
                    {formatMailDate(selectedMessage?.dateTimeReceived || selectedConversation.deliveryTime)}
                  </span>
                </div>
              </div>

              {/* Attachments Section with Download */}
              {selectedMessage?.attachments?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200/50 dark:border-[#212634] flex flex-wrap gap-2 min-w-0">
                  {selectedMessage.attachments.map(att => (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() => handleDownloadAttachment(att)}
                      className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-white dark:bg-[#1A1F2B] border border-gray-200/60 dark:border-[#283245] text-xs shadow-sm hover:border-primary transition-colors cursor-pointer text-left max-w-full min-w-0 truncate"
                      title="Нажмите, чтобы скачать файл"
                    >
                      <Icons.FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="font-medium text-gray-700 dark:text-gray-200 max-w-[140px] truncate">
                        {att.name}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {formatFileSize(att.size)}
                      </span>
                      <Icons.Download className="w-3 h-3 text-gray-400 hover:text-primary shrink-0 ml-1" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Message Body Container (Sandboxed Safe Iframe) */}
            <div className="flex-1 w-full min-w-0 relative overflow-hidden bg-white dark:bg-[#151922]">
              {isLoadingDetail ? (
                <div className="flex items-center justify-center h-full">
                  <LoadingSpinner size={8} text="Загрузка содержимого письма..." />
                </div>
              ) : selectedMessage?.body ? (
                <iframe
                  title="email-body"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={renderSafeIframeDoc(selectedMessage.body)}
                  className="w-full h-full border-none block"
                />
              ) : (
                <div className="p-6 text-sm text-gray-500 whitespace-pre-wrap">
                  {selectedMessage?.body || '(Пустое сообщение)'}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* COMPOSE EMAIL MODAL */}
      {showComposeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-[#1A1F2B] border border-gray-200/50 dark:border-[#283245] shadow-2xl rounded-3xl max-w-xl w-full flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-200/50 dark:border-[#283245] flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                <Icons.PenSquare className="w-4 h-4 text-primary" />
                <span>Новое сообщение</span>
              </h3>
              <button
                onClick={() => setShowComposeModal(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#283245] cursor-pointer"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSendSubmit} className="flex-1 flex flex-col p-4 space-y-3 overflow-y-auto">
              <div>
                <input
                  type="email"
                  value={composeData.to}
                  onChange={(e) => setComposeData(prev => ({ ...prev, to: e.target.value }))}
                  placeholder="Кому: ivanov@msal.ru"
                  required
                  className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-[#151922] border border-gray-200 dark:border-[#283245] text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <input
                  type="text"
                  value={composeData.subject}
                  onChange={(e) => setComposeData(prev => ({ ...prev, subject: e.target.value }))}
                  placeholder="Тема письма"
                  className="w-full px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-[#151922] border border-gray-200 dark:border-[#283245] text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:border-primary"
                />
              </div>

              <div className="flex-1 flex flex-col min-h-[220px]">
                <textarea
                  value={composeData.body}
                  onChange={(e) => setComposeData(prev => ({ ...prev, body: e.target.value }))}
                  placeholder="Текст сообщения..."
                  className="w-full flex-1 p-3.5 rounded-xl bg-gray-50 dark:bg-[#151922] border border-gray-200 dark:border-[#283245] text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:border-primary resize-none"
                />
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center justify-end space-x-2 border-t border-gray-200/50 dark:border-[#283245]">
                <button
                  type="button"
                  onClick={() => setShowComposeModal(false)}
                  className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#283245] transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSending}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs sm:text-sm font-semibold shadow-md shadow-primary/20 flex items-center space-x-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSending ? (
                    <>
                      <LoadingSpinner size={3} />
                      <span>Отправка...</span>
                    </>
                  ) : (
                    <>
                      <Icons.Send className="w-4 h-4" />
                      <span>Отправить</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MailPage;
