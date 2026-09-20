import React from 'react';

export const LoadingSpinner = ({ size = 10, text = 'Загрузка данных...' }) => (
  <div className="flex flex-col items-center justify-center py-12 space-y-4">
    <div className={`animate-spin rounded-full border-4 border-primary border-t-transparent h-${size} w-${size}`}></div>
    {text && <p className="text-sm font-medium text-textMuted">{text}</p>}
  </div>
);
