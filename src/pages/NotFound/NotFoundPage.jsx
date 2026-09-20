import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/common/Card';
import { Icons } from '../../components/common/Icons';

export const NotFoundPage = () => (
  <div className="min-h-[70vh] flex items-center justify-center p-4">
    <Card className="p-8 text-center max-w-md w-full">
      <div className="w-16 h-16 rounded-full bg-accent/10 mx-auto flex items-center justify-center text-accent mb-4">
        <Icons.AlertCircle size={32} />
      </div>
      <h2 className="text-xl font-bold text-dark mb-2">Страница не найдена</h2>
      <p className="text-xs text-textMuted mb-6">
        Запрашиваемый раздел не существует или был перемещён.
      </p>
      <Link
        to="/"
        className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl font-bold bg-primary text-white text-xs shadow-sm hover:opacity-90"
      >
        <Icons.Home size={16} />
        <span>Вернуться на главную</span>
      </Link>
    </Card>
  </div>
);
