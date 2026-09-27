import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { mailService, cryptoStorage } from '../../api';
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

  // Mail Data State
  const [folders, setFolders] = useState([
    { id: 'inbox', name: 'Входящие', icon: 'Inbox', unreadCount: 0 },
    { id: 'sentitems', name: 'Отправленные', icon: 'Send', unreadCount: 0 },
    { id: 'drafts', name: 'Черновики', icon: 'FileText', unreadCount: 0 },
    { id: 'deleteditems', name: 'Удалённые', icon: 'Trash2', unreadCount: 0 },
    { id: 'junkemail', name: 'Спам', icon: 'AlertOctagon', unreadCount: 0 }
  ]);
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [conversations, setConversations] = useState([]);
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

  // Check Mail Auth on Mount with automatic LK single-sign-on
  useEffect(() => {
    let isMounted = true;
    async function check() {
      try {
        const auth = await mailService.checkAuth();
        if (auth.isAuthenticated) {
          if (isMounted) {
            setIsMailAuth(true);
            setMailUser(auth.username);
            loadMailData('inbox');
          }
          return;
        }

        // Automatic Single Sign-On using stored LK credentials
        const lkCreds = cryptoStorage.getSavedCredentials();
        const lkUser = cryptoStorage.getUser();
        const autoUser = lkCreds?.login || lkUser?.login || lkUser?.email || user?.email || user?.login;
        const autoPass = lkCreds?.password;

        if (autoUser && autoPass) {
          if (isMounted) {
            setIsLoggingIn(true);
            setLoginForm({ username: autoUser, password: autoPass });
          }
          try {
            await mailService.login(autoUser, autoPass);
            if (isMounted) {
              setIsMailAuth(true);
              setMailUser(autoUser);
              await loadMailData('inbox');
            }
            return;
          } catch (autoErr) {
            console.warn('[MailPage] Auto SSO failed:', autoErr.message);
            if (isMounted) {
              setLoginError(autoErr.message);
            }
          } finally {
            if (isMounted) setIsLoggingIn(false);
          }
        } else if (autoUser && isMounted) {
          setLoginForm(prev => ({ ...prev, username: autoUser }));
        }
      } catch (err) {
        console.warn('[MailPage] Auth check warning:', err.message);
      } finally {
        if (isMounted) setIsCheckingAuth(false);
      }
    }
    check();
    return () => { isMounted = false; };
  }, [user]);

  const loadMailData = async (folderId = activeFolder) => {
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
    setIsLoadingDetail(true);
    try {
      const msg = await mailService.getMessage(conv.itemId || conv.id);
      setSelectedMessage(msg);
      // Mark as read locally
      setConversations(prev =>
        prev.map(c => (c.id === conv.id ? { ...c, isRead: true, unreadCount: 0 } : c))
      );
    } catch (err) {
      console.error('[MailPage] Failed to load message detail:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleSendEmail = async (e) => {
    e.preventDefault();
    if (!composeData.to) return;

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
      setTimeout(() => setSendSuccessNotice(false), 3000);
      if (activeFolder === 'sentitems') {
        loadMailData('sentitems');
      }
    } catch (err) {
      alert(`Ошибка отправки письма: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteCurrent = async () => {
    if (!selectedMessage?.id && !selectedConversation?.itemId) return;
    const targetId = selectedMessage?.id || selectedConversation?.itemId;

    if (window.confirm('Переместить письмо в удалённые?')) {
      try {
        await mailService.deleteItem(targetId);
        setConversations(prev => prev.filter(c => (c.itemId || c.id) !== targetId));
        setSelectedConversation(null);
        setSelectedMessage(null);
      } catch (err) {
        alert(`Ошибка удаления: ${err.message}`);
      }
    }
  };

  // Filtered Conversations
  const filteredConversations = conversations.filter(c => {
    if (filterUnreadOnly && c.isRead) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.subject && c.subject.toLowerCase().includes(q)) ||
      (c.sender && c.sender.toLowerCase().includes(q))
    );
  });

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    } catch (_) {
      return '';
    }
  };

  const formatFullDate = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return '';
    }
  };

  const getFolderIcon = (iconName) => {
    switch (iconName) {
      case 'Inbox': return <Icons.Inbox className="w-4 h-4 shrink-0" />;
      case 'Send': return <Icons.Send className="w-4 h-4 shrink-0" />;
      case 'FileText': return <Icons.FileText className="w-4 h-4 shrink-0" />;
      case 'Trash2': return <Icons.Trash2 className="w-4 h-4 shrink-0" />;
      case 'AlertOctagon': return <Icons.AlertOctagon className="w-4 h-4 shrink-0" />;
      default: return <Icons.Folder className="w-4 h-4 shrink-0" />;
    }
  };

  const renderEmailBody = (htmlBody) => {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              font-size: 14px;
              line-height: 1.6;
              color: ${isDark ? '#E2E8F0' : '#1E293B'};
              background-color: transparent;
              margin: 0;
              padding: 4px;
              word-break: break-word;
            }
            a { color: ${isDark ? '#38BDF8' : '#22869A'}; text-decoration: underline; }
            img { max-width: 100%; height: auto; }
            blockquote {
              border-left: 3px solid ${isDark ? '#334155' : '#CBD5E1'};
              margin: 8px 0;
              padding-left: 12px;
              color: ${isDark ? '#94A3B8' : '#64748B'};
            }
            table { max-width: 100%; border-collapse: collapse; }
          </style>
        </head>
        <body>
          ${htmlBody || '<p style="color: #94A3B8;">(Пустое тело письма)</p>'}
        </body>
      </html>
    `;
  };

  if (isCheckingAuth || (isLoggingIn && !loginError)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full min-h-[400px]">
        <LoadingSpinner size={10} text="Авторизация в корпоративной почте..." />
        <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-3">
          Подключение к Microsoft Exchange (mail.msal.ru)...
        </p>
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
                    required
                    value={loginForm.username}
                    onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                    placeholder="ivanov.ii или ivanov.ii@msal.ru"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-gray-50 dark:bg-[#12151B] border border-gray-200 dark:border-[#283245] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary text-sm transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Пароль от почты
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                    <Icons.Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-gray-50 dark:bg-[#12151B] border border-gray-200 dark:border-[#283245] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary text-sm transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3 px-4 rounded-2xl bg-primary hover:bg-primary/90 text-white font-semibold text-sm shadow-lg shadow-primary/25 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isLoggingIn ? (
                  <>
                    <Icons.Loader2 className="w-4 h-4 animate-spin" />
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

            <div className="mt-5 pt-5 border-t border-gray-100 dark:border-[#283245]/60 text-center">
              <div className="flex items-center justify-center space-x-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <Icons.ShieldCheck className="w-4 h-4" />
                <span>Прямое подключение к mail.msal.ru (152-ФЗ)</span>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                Данные аккаунта хранятся только локально в зашифрованном виде (AES-256 GCM).
              </p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // AUTHENTICATED MAIL INTERFACE
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50/50 dark:bg-[#12151B]">
      {/* Top Bar */}
      <div className="px-4 py-3 bg-white dark:bg-[#1A1F2B] border-b border-gray-200 dark:border-[#283245] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Icons.Mail className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900 dark:text-white leading-tight">Почта</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
              {mailUser || 'Подключено'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {sendSuccessNotice && (
            <span className="hidden sm:inline-flex text-xs font-semibold text-emerald-600 dark:text-emerald-400 items-center space-x-1">
              <Icons.CheckCircle2 className="w-3.5 h-3.5" />
              <span>Письмо отправлено</span>
            </span>
          )}

          <button
            onClick={() => setShowComposeModal(true)}
            className="px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-semibold shadow-sm transition-all flex items-center space-x-1.5 active:scale-95"
          >
            <Icons.Edit3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Написать</span>
          </button>

          <button
            onClick={() => loadMailData(activeFolder)}
            disabled={isLoadingList}
            className="p-1.5 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#283245] transition-all disabled:opacity-50"
            title="Обновить почту"
          >
            <Icons.RefreshCw className={`w-4 h-4 ${isLoadingList ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleLogout}
            className="p-1.5 rounded-xl text-gray-400 hover:text-rose-500 hover:bg-gray-100 dark:hover:bg-[#283245] transition-all"
            title="Выйти из почты"
          >
            <Icons.LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Mail Work Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Column: Folders Navigation (Desktop/Tablet) */}
        <aside className="hidden md:flex flex-col w-52 bg-white/60 dark:bg-[#1A1F2B]/60 border-r border-gray-200 dark:border-[#283245] p-3 space-y-1 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-3 py-1">
            Папки
          </p>
          {folders.map(f => {
            const isActive = activeFolder === f.id;
            return (
              <button
                key={f.id}
                onClick={() => handleSelectFolder(f.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-primary text-white shadow-sm font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#283245]/60'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  {getFolderIcon(f.icon)}
                  <span>{f.name}</span>
                </div>
                {f.unreadCount > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                  }`}>
                    {f.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        {/* Center Column: Message / Conversation List */}
        <section className={`flex flex-col border-r border-gray-200 dark:border-[#283245] bg-white dark:bg-[#161A24] shrink-0 ${
          selectedConversation ? 'hidden lg:flex w-80 xl:w-96' : 'flex-1 md:w-80 lg:w-80 xl:w-96'
        }`}>
          {/* Mobile Folder Selector Tabs */}
          <div className="md:hidden flex items-center space-x-1 p-2 border-b border-gray-200 dark:border-[#283245] overflow-x-auto no-scrollbar">
            {folders.map(f => (
              <button
                key={f.id}
                onClick={() => handleSelectFolder(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                  activeFolder === f.id
                    ? 'bg-primary text-white font-semibold'
                    : 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-[#283245]/50'
                }`}
              >
                {getFolderIcon(f.icon)}
                <span>{f.name}</span>
                {f.unreadCount > 0 && (
                  <span className="ml-1 px-1 rounded-full bg-white/20 text-[10px]">
                    {f.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search & Filter Bar */}
          <div className="p-2.5 border-b border-gray-200 dark:border-[#283245] flex items-center space-x-2">
            <div className="relative flex-1">
              <Icons.Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск в письмах..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#1E2430] text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              onClick={() => setFilterUnreadOnly(!filterUnreadOnly)}
              className={`p-1.5 rounded-xl border text-xs transition-all ${
                filterUnreadOnly
                  ? 'bg-primary text-white border-primary'
                  : 'bg-gray-100 dark:bg-[#1E2430] border-gray-200 dark:border-[#283245] text-gray-500'
              }`}
              title="Только непрочитанные"
            >
              <Icons.Filter className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* List of items */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#283245]/40 min-h-0">
            {isLoadingList ? (
              <div className="p-8 flex justify-center">
                <LoadingSpinner size={8} text="Загрузка списка писем..." />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-gray-400 dark:text-gray-500">
                <Icons.Inbox className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-xs font-semibold">Писем нет</p>
                <p className="text-[11px] mt-0.5">В этой папке пока пусто</p>
              </div>
            ) : (
              filteredConversations.map(conv => {
                const isSelected = selectedConversation?.id === conv.id;
                return (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    className={`p-3 cursor-pointer transition-colors relative ${
                      isSelected
                        ? 'bg-primary/10 dark:bg-[#1E2A3A] border-l-4 border-l-primary'
                        : conv.isRead
                          ? 'hover:bg-gray-50 dark:hover:bg-[#1E2430]/60'
                          : 'bg-white dark:bg-[#1E2430] font-semibold hover:bg-gray-50 dark:hover:bg-[#252C3A]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={`truncate max-w-[170px] ${!conv.isRead ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                        {conv.sender}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                        {formatDate(conv.deliveryTime)}
                      </span>
                    </div>

                    <h4 className={`text-xs mb-1 line-clamp-1 ${!conv.isRead ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300 font-normal'}`}>
                      {conv.subject}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
                      <div className="flex items-center space-x-1.5">
                        {conv.hasAttachments && (
                          <Icons.Paperclip className="w-3 h-3 text-gray-400" />
                        )}
                        {conv.messageCount > 1 && (
                          <span className="px-1.5 py-0.2 rounded-md bg-gray-100 dark:bg-[#283245] text-[9px] font-bold">
                            {conv.messageCount}
                          </span>
                        )}
                      </div>
                      {!conv.isRead && (
                        <span className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Message Reading Pane */}
        <main className={`flex-1 flex flex-col bg-white dark:bg-[#12151B] overflow-hidden min-h-0 ${
          !selectedConversation ? 'hidden lg:flex' : 'flex'
        }`}>
          {selectedConversation ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden min-h-0">
              {/* Message Header */}
              <div className="p-4 border-b border-gray-200 dark:border-[#283245] bg-white/50 dark:bg-[#1A1F2B]/50 shrink-0">
                <div className="flex items-center justify-between gap-3 mb-2">
                  {/* Mobile Back Button */}
                  <button
                    onClick={() => {
                      setSelectedConversation(null);
                      setSelectedMessage(null);
                    }}
                    className="lg:hidden p-1.5 -ml-1 rounded-xl text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#283245]"
                  >
                    <Icons.ArrowLeft className="w-5 h-5" />
                  </button>

                  <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white flex-1 truncate">
                    {selectedMessage?.subject || selectedConversation.subject}
                  </h2>

                  <div className="flex items-center space-x-1">
                    <button
                      onClick={handleDeleteCurrent}
                      className="p-2 rounded-xl text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                      title="Удалить"
                    >
                      <Icons.Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Sender Info */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                      {(selectedMessage?.from?.name || selectedConversation.sender || '?')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white truncate">
                        {selectedMessage?.from?.name || selectedConversation.sender}
                      </p>
                      {selectedMessage?.from?.email && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                          {selectedMessage.from.email}
                        </p>
                      )}
                    </div>
                  </div>

                  <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
                    {formatFullDate(selectedMessage?.dateTimeReceived || selectedConversation.deliveryTime)}
                  </span>
                </div>

                {/* Attachments list if any */}
                {selectedMessage?.attachments?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-[#283245]/60 flex flex-wrap gap-2">
                    {selectedMessage.attachments.map(att => (
                      <div
                        key={att.id}
                        className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-[#1E2430] border border-gray-200 dark:border-[#283245] text-xs text-gray-700 dark:text-gray-300"
                      >
                        <Icons.Paperclip className="w-3.5 h-3.5 text-primary" />
                        <span className="truncate max-w-[140px]">{att.name}</span>
                        {att.size > 0 && (
                          <span className="text-[10px] text-gray-400">
                            ({Math.round(att.size / 1024)} КБ)
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Message Body View */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-white dark:bg-[#12151B] min-h-0">
                {isLoadingDetail ? (
                  <div className="h-full flex items-center justify-center">
                    <LoadingSpinner size={8} text="Загрузка содержимого письма..." />
                  </div>
                ) : selectedMessage?.bodyType === 'HTML' ? (
                  <iframe
                    title="email-body"
                    srcDoc={renderEmailBody(selectedMessage.body)}
                    className="w-full h-full border-0 min-h-[400px]"
                    sandbox="allow-same-origin allow-popups"
                  />
                ) : (
                  <pre className="font-sans text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {selectedMessage?.body || '(Пустое письмо)'}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-gray-400 dark:text-gray-500">
              <div className="w-16 h-16 rounded-3xl bg-gray-100 dark:bg-[#1E2430] flex items-center justify-center mb-3">
                <Icons.Mail className="w-8 h-8 opacity-40" />
              </div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-300">Выберите письмо для чтения</p>
              <p className="text-xs text-gray-400 mt-1">Или напишите новое письмо через кнопку «Написать»</p>
            </div>
          )}
        </main>
      </div>

      {/* Compose Email Modal */}
      {showComposeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1A1F2B] border border-gray-200 dark:border-[#283245] rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-gray-200 dark:border-[#283245] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Icons.Edit3 className="w-4 h-4 text-primary" />
                <h3 className="font-bold text-sm text-gray-900 dark:text-white">Новое сообщение</h3>
              </div>
              <button
                onClick={() => setShowComposeModal(false)}
                className="p-1 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-white"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendEmail} className="flex-1 flex flex-col p-4 space-y-3 overflow-y-auto">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  Кому (email или логин):
                </label>
                <input
                  type="text"
                  required
                  value={composeData.to}
                  onChange={(e) => setComposeData({ ...composeData, to: e.target.value })}
                  placeholder="ivanov@msal.ru"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-[#12151B] border border-gray-200 dark:border-[#283245] text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  Тема:
                </label>
                <input
                  type="text"
                  value={composeData.subject}
                  onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                  placeholder="Тема сообщения"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-[#12151B] border border-gray-200 dark:border-[#283245] text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex-1 flex flex-col min-h-[160px]">
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  Текст письма:
                </label>
                <textarea
                  required
                  rows={8}
                  value={composeData.body}
                  onChange={(e) => setComposeData({ ...composeData, body: e.target.value })}
                  placeholder="Напишите текст письма..."
                  className="w-full flex-1 px-3 py-2 rounded-xl bg-gray-50 dark:bg-[#12151B] border border-gray-200 dark:border-[#283245] text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowComposeModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#283245]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSending}
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-semibold shadow-md transition-all flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {isSending ? (
                    <>
                      <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Отправка...</span>
                    </>
                  ) : (
                    <>
                      <Icons.Send className="w-3.5 h-3.5" />
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
