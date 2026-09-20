import React from 'react';

export const Logo = ({ size = 40, className = '' }) => {
  return (
    <img
      src="./logo.svg"
      alt="DarkMSAL Logo"
      width={size}
      height={size}
      className={`rounded-2xl object-contain shadow-sm ${className}`}
    />
  );
};
