import React from 'react';

export const Badge = ({ children, type = 'primary', className = '' }) => {
  const types = {
    primary: 'bg-primary text-white',
    secondary: 'bg-secondary text-white',
    accent: 'bg-accent text-white',
    success: 'bg-emerald-600 text-white',
    warning: 'bg-amber-500 text-white',
    danger: 'bg-rose-600 text-white',
    outline: 'border border-accent text-primary bg-transparent dark:text-accent'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full ${types[type] || types.primary} ${className}`}>
      {children}
    </span>
  );
};
