import React from 'react';
import { Card } from './Card';
import { Icons } from './Icons';

export const ErrorMessage = ({ message, onRetry }) => (
  <Card className="my-6 p-6 text-center max-w-lg mx-auto">
    <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-500">
      <Icons.AlertCircle size={32} />
    </div>
    <h3 className="text-lg font-bold text-dark mb-2">Произошла ошибка</h3>
    <p className="text-sm text-textMuted mb-6 leading-relaxed">{message || 'Не удалось загрузить данные с сервера'}</p>
    {onRetry && (
      <button 
        onClick={onRetry} 
        className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl font-bold bg-primary text-white shadow-sm hover:opacity-90 transition-opacity"
      >
        <Icons.Refresh size={18} />
        <span>Повторить попытку</span>
      </button>
    )}
  </Card>
);
