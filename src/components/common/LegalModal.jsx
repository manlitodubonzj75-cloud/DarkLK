import React, { useState } from 'react';
import { Icons } from './Icons';
import { TERMS_OF_USE, PRIVACY_POLICY, LEGAL_DOC_VERSION, LEGAL_DOC_DATE } from '../../constants/legalText';

export const LegalModal = ({ isOpen, onClose, onAccept, initialTab = 'terms', showAcceptButton = false }) => {
  const [activeTab, setActiveTab] = useState(initialTab);

  if (!isOpen) return null;

  const currentDoc = activeTab === 'terms' ? TERMS_OF_USE : PRIVACY_POLICY;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md animate-fade-in">
      <div 
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-card dark:bg-[#181C26] border border-border dark:border-[#2B3242] rounded-3xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-6 border-b border-border dark:border-[#212634] flex items-center justify-between shrink-0 bg-surface dark:bg-[#1C2230]">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-primary/10 text-primary dark:text-[#38BDF8] flex items-center justify-center shrink-0">
              <Icons.Shield size={22} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-dark dark:text-white leading-tight">
                Правовая информация
              </h2>
              <div className="flex items-center space-x-2 mt-0.5 text-xs text-textMuted dark:text-[#8E98A8]">
                <span>DarkMSAL</span>
                <span>•</span>
                <span className="font-mono text-[11px] bg-bg dark:bg-[#12151B] px-1.5 py-0.5 rounded border border-border/50">
                  ред. v{LEGAL_DOC_VERSION} ({LEGAL_DOC_DATE})
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-textMuted dark:text-[#8E98A8] hover:bg-bg dark:hover:bg-[#262D3D] hover:text-dark dark:hover:text-white transition-colors"
          >
            <Icons.X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border dark:border-[#212634] bg-bg dark:bg-[#141720] px-4 sm:px-6 shrink-0">
          <button
            onClick={() => setActiveTab('terms')}
            className={`py-3 px-3 sm:px-5 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center space-x-2 ${
              activeTab === 'terms'
                ? 'border-primary dark:border-[#38BDF8] text-primary dark:text-[#38BDF8]'
                : 'border-transparent text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
            }`}
          >
            <Icons.FileText size={16} />
            <span>Условия использования</span>
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`py-3 px-3 sm:px-5 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center space-x-2 ${
              activeTab === 'privacy'
                ? 'border-primary dark:border-[#38BDF8] text-primary dark:text-[#38BDF8]'
                : 'border-transparent text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
            }`}
          >
            <Icons.Lock size={16} />
            <span>Политика конфиденциальности</span>
          </button>
        </div>

        {/* Document Subtitle & Banner */}
        <div className="px-5 sm:px-6 pt-4 pb-2 shrink-0 bg-primary/5 dark:bg-[#1E6685]/10 border-b border-border/40 dark:border-[#212634]">
          <h3 className="text-xs sm:text-sm font-bold text-dark dark:text-white">
            {currentDoc.title}
          </h3>
          <p className="text-[11px] text-textMuted dark:text-[#8E98A8] mt-0.5">
            {currentDoc.subtitle}
          </p>
        </div>

        {/* Document Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs sm:text-sm text-text dark:text-[#CBD5E1] leading-relaxed select-text">
          {currentDoc.sections.map((section, idx) => (
            <div 
              key={idx} 
              className="p-4 rounded-2xl bg-bg/70 dark:bg-[#1A1F2C] border border-border/70 dark:border-[#283245] space-y-2"
            >
              <h4 className="font-bold text-dark dark:text-white text-xs sm:text-sm text-primary dark:text-[#38BDF8]">
                {section.title}
              </h4>
              <div className="whitespace-pre-line text-textMuted dark:text-[#94A3B8] font-sans leading-relaxed text-xs sm:text-[13px]">
                {section.content}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-border dark:border-[#212634] bg-surface dark:bg-[#181C26] flex items-center justify-end shrink-0 gap-3">
          <div className="flex items-center space-x-2.5">
            {showAcceptButton && onAccept ? (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-textMuted hover:text-dark dark:hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={() => {
                    onAccept();
                    onClose();
                  }}
                  className="px-5 py-2.5 rounded-xl bg-primary dark:bg-[#1E6685] hover:bg-primary-dark dark:hover:bg-[#257C9F] text-white font-bold text-xs sm:text-sm transition-all shadow-md active:scale-95"
                >
                  Принять условия и политику
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-primary dark:bg-[#1E6685] hover:bg-primary-dark dark:hover:bg-[#257C9F] text-white font-bold text-xs sm:text-sm transition-colors shadow-sm"
              >
                Закрыть
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
