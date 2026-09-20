import React from 'react';

export const Card = ({ children, className = '', onClick }) => (
  <div 
    onClick={onClick}
    className={`bg-card border border-border rounded-2xl shadow-sm transition-colors ${onClick ? 'cursor-pointer' : ''} ${className}`}
  >
    {children}
  </div>
);
