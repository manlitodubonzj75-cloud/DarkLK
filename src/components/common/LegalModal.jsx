import React, { useState } from 'react';
import { Icons } from './Icons';

export const LegalModal = ({ isOpen, onClose, initialTab = 'terms' }) => {
  const [activeTab, setActiveTab] = useState(initialTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div 
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-white dark:bg-[#181C26] border border-border dark:border-[#2B3242] rounded-3xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-border dark:border-[#212634] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1E6685]/15 text-[#38BDF8] flex items-center justify-center shrink-0">
              <Icons.Shield size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-dark dark:text-white leading-tight">
                Правовая информация
              </h2>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">
                DarkMSAL • для Альма Матер с любовью.
              </p>
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
        <div className="flex border-b border-border dark:border-[#212634] bg-bg dark:bg-[#141720] px-6 shrink-0">
          <button
            onClick={() => setActiveTab('terms')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'terms'
                ? 'border-primary dark:border-[#38BDF8] text-primary dark:text-[#38BDF8]'
                : 'border-transparent text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
            }`}
          >
            Условия использования
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'privacy'
                ? 'border-primary dark:border-[#38BDF8] text-primary dark:text-[#38BDF8]'
                : 'border-transparent text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
            }`}
          >
            Политика конфиденциальности
          </button>
        </div>

        {/* Tab Content (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs sm:text-sm text-textMuted dark:text-[#C5CDD9] leading-relaxed">
          {activeTab === 'terms' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-bg dark:bg-[#1F2430] border border-border dark:border-[#2B3242]">
                <h3 className="font-bold text-dark dark:text-white text-sm mb-1">
                  1. Статус приложения и назначение
                </h3>
                <p>
                  DarkMSAL («МГЮА+») является независимым клиентским интерфейсом с открытым исходным кодом, предназначенным исключительно для удобного взаимодействия студентов с информационными сервисами Университета имени О.Е. Кутафина (МГЮА). Приложение не является коммерческим продуктом.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-bg dark:bg-[#1F2430] border border-border dark:border-[#2B3242]">
                <h3 className="font-bold text-dark dark:text-white text-sm mb-1">
                  2. Прямое соединение без посредников
                </h3>
                <p>
                  Все сетевые запросы формируются и отправляются непосредственно с устройства пользователя на официальные серверы университета (lk.msal.ru:3443). Приложение не использует промежуточные прокси-серверы, ретрансляторы или внешние облачные хранилища данных.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-bg dark:bg-[#1F2430] border border-border dark:border-[#2B3242]">
                <h3 className="font-bold text-dark dark:text-white text-sm mb-1">
                  3. Ответственность и учетные данные
                </h3>
                <p>
                  Пользователь самостоятельно несет ответственность за сохранность своих учетных данных от Единой учетной записи студента. Приложение функционирует по принципу «как есть» (AS IS). Разработчик не несет ответственности за перебои в работе серверов университета.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-bg dark:bg-[#1F2430] border border-border dark:border-[#2B3242]">
                <h3 className="font-bold text-dark dark:text-white text-sm mb-1">
                  1. Соблюдение 152-ФЗ «О персональных данных»
                </h3>
                <p>
                  Разработчик и создатели DarkMSAL не являются Оператором персональных данных в понимании Федерального закона № 152-ФЗ, поскольку сбор, централизованное хранение, систематизация и передача персональных данных пользователей на сервера третьих лиц отсутствуют в архитектуре сервиса.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-bg dark:bg-[#1F2430] border border-border dark:border-[#2B3242]">
                <h3 className="font-bold text-dark dark:text-white text-sm mb-1">
                  2. Аппаратное и локальное шифрование
                </h3>
                <p>
                  Все сохраняемые данные сессии, токен авторизации и кэш успеваемости шифруются на уровне устройства с использованием 256-битного алгоритма AES-GCM через нативный криптографический модуль Web Crypto API. Ключи шифрования генерируются локально в изолированном защищенном хранилище IndexedDB с атрибутом extractable: false.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-bg dark:bg-[#1F2430] border border-border dark:border-[#2B3242]">
                <h3 className="font-bold text-dark dark:text-white text-sm mb-1">
                  3. Отсутствие трекеров и телеметрии
                </h3>
                <p>
                  В клиентский код не интегрированы сторонние аналитические счетчики, рекламные SDK, сборщики краш-логов или системы пользовательской слежки. При выходе из аккаунта (Logout) локальное хранилище и криптографические ключи необратимо уничтожаются.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-border dark:border-[#212634] bg-bg dark:bg-[#141720] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-textMuted dark:text-[#8E98A8]">
            Версия документа: 1.0 (проект)
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-primary dark:bg-[#1E6685] hover:bg-primary-dark dark:hover:bg-[#257C9F] text-white font-bold text-xs transition-colors shadow-sm"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};
