import React, { useState, useEffect } from 'react';
import { Icons } from './Icons';
import { updateService } from '../../api/updateService';

const STATUS_TEXT = {
  checking: 'Проверяем…',
  downloading: 'Скачиваем обновление…',
  verifying: 'Проверяем подпись…',
  ready: 'Готово к установке',
  installing: 'Запускаем установку…',
  need_permission: 'Разрешите DarkMSAL устанавливать приложения (откроются настройки), вернитесь и нажмите «Установить» ещё раз'
};

export const UpdateModal = ({ isOpen, updateInfo, onClose }) => {
  const [progress, setProgress] = useState(null); // { status, progress, error }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setProgress(null);
      setBusy(false);
    }
  }, [isOpen]);

  if (!isOpen || !updateInfo) return null;

  const { latestVersion, currentVersion, releaseName, releaseNotes, asset, releaseUrl, platform, mode } = updateInfo;
  const isAuto = mode === 'electron' || mode === 'android';

  const handleDownload = async () => {
    if (!isAuto) {
      updateService.installUpdate(updateInfo);
      return;
    }
    setBusy(true);
    setProgress({ status: 'downloading', progress: 0 });
    try {
      await updateService.installUpdate(updateInfo, (st) => setProgress((prev) => ({ ...prev, ...st })));
    } catch (err) {
      setProgress({ status: 'error', progress: 0, error: err?.message || 'Не удалось обновить' });
    } finally {
      setBusy(false);
    }
  };

  const handleAltStore = () => {
    if (asset?.browser_download_url) {
      const altUrl = `altstore://install?url=${encodeURIComponent(asset.browser_download_url)}`;
      window.location.href = altUrl;
    }
  };

  const handleDismiss = () => {
    updateService.dismissUpdate(latestVersion);
    onClose();
  };

  const formatFileSize = (bytes) => {
    if (!bytes || isNaN(bytes)) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} МБ`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full max-w-md bg-card dark:bg-[#1A202C] rounded-3xl p-6 border border-border dark:border-[#2D3748] shadow-2xl space-y-5 animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-accent to-primary flex items-center justify-center text-white shadow-md shadow-accent/20">
              <Icons.Sparkles size={24} />
            </div>
            <div>
              <h3 className="text-lg font-black text-dark dark:text-white leading-tight">
                Доступно обновление!
              </h3>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">
                DarkMSAL v{latestVersion} (у вас v{currentVersion})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-bg dark:hover:bg-[#2D3748] text-textMuted transition-colors"
          >
            <Icons.X size={18} />
          </button>
        </div>

        {/* Release Title & Notes */}
        <div className="space-y-2">
          {releaseName && releaseName !== latestVersion && (
            <h4 className="text-xs font-bold text-dark dark:text-white">
              {releaseName}
            </h4>
          )}
          
          <div className="max-h-48 overflow-y-auto p-3.5 rounded-2xl bg-bg dark:bg-[#12151B] border border-border/70 dark:border-[#283245] text-xs text-text dark:text-[#E2E8F0] space-y-1 font-sans leading-relaxed">
            {releaseNotes ? (
              <pre className="whitespace-pre-wrap font-sans text-xs break-words">
                {releaseNotes}
              </pre>
            ) : (
              <p className="text-textMuted dark:text-[#8E98A8] italic">
                Улучшения стабильности, исправление ошибок и ускорение работы приложения.
              </p>
            )}
          </div>
        </div>

        {/* Asset info */}
        {asset && (
          <div className="flex items-center justify-between text-[11px] text-textMuted dark:text-[#8E98A8] px-1">
            <span className="truncate max-w-[200px] font-mono">{asset.name}</span>
            {asset.size && <span className="font-semibold">{formatFileSize(asset.size)}</span>}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2 pt-1">
          {platform === 'ios' && asset?.name?.endsWith('.ipa') && (
            <button
              onClick={handleAltStore}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shadow-sm transition-all active:scale-[0.98]"
            >
              <Icons.Download size={16} />
              <span>Установить через AltStore / SideStore</span>
            </button>
          )}

          {progress && progress.status !== 'error' && (
            <div className="space-y-1.5">
              <div className="h-2 w-full rounded-full bg-bg dark:bg-[#12151B] overflow-hidden border border-border/60 dark:border-[#283245]">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.max(3, Math.min(100, progress.progress || 0))}%` }}
                />
              </div>
              <p className="text-[11px] text-textMuted dark:text-[#8E98A8]">
                {STATUS_TEXT[progress.status] || 'Обновляем…'}
                {progress.status === 'downloading' && progress.progress ? ` ${progress.progress}%` : ''}
              </p>
            </div>
          )}

          {progress?.status === 'error' && (
            <p className="text-[11px] text-red-600 dark:text-red-400 break-words">
              {progress.error || 'Не удалось обновить'}. Можно скачать вручную со страницы релиза.
            </p>
          )}

          <button
            onClick={handleDownload}
            disabled={busy}
            className="w-full py-3.5 px-4 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-wait text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shadow-md shadow-primary/25 transition-all active:scale-[0.98]"
          >
            <Icons.Download size={16} />
            <span>
              {isAuto
                ? (busy
                    ? 'Обновляем…'
                    : progress?.status === 'need_permission'
                      ? 'Установить'
                      : progress?.status === 'error'
                        ? 'Попробовать ещё раз'
                        : platform === 'android' ? 'Обновить' : 'Обновить и перезапустить')
                : platform === 'ios'
                  ? 'Скачать .IPA файл'
                  : platform === 'android'
                    ? 'Скачать .APK файл'
                    : 'Загрузить обновление'}
            </span>
          </button>

          {isAuto && progress?.status === 'error' && releaseUrl && (
            <button
              onClick={() => window.open(releaseUrl, '_blank', 'noopener')}
              className="w-full text-xs font-semibold text-primary hover:underline py-1"
            >
              Открыть страницу релиза
            </button>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={handleDismiss}
              className="text-xs font-semibold text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white px-2 py-1 transition-colors"
            >
              Пропустить эту версию
            </button>
            <button
              onClick={onClose}
              className="text-xs font-semibold text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white px-2 py-1 transition-colors"
            >
              Позже
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
