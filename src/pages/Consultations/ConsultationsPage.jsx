import React, { useState, useEffect, useCallback, useRef } from 'react';
import { lkService, formatISODate, getMondayOfWeek, cacheService } from '../../api';
import { Card } from '../../components/common/Card';
import { Icons } from '../../components/common/Icons';
import { Badge } from '../../components/common/Badge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

export const ConsultationsPage = () => {
  // 1. Instant Cache Initialization (0 ms cold start)
  const [myConsultations, setMyConsultations] = useState(() => {
    return cacheService.get('consultation_student_list') || cacheService.get('consultation_my_list') || [];
  });
  const [loadingMy, setLoadingMy] = useState(false);
  const [errorMy, setErrorMy] = useState(null);

  // Booking state with fast cache
  const [disciplines, setDisciplines] = useState(() => cacheService.get('student_disciplines') || []);
  const [selectedDiscipline, setSelectedDiscipline] = useState('');
  
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');

  const [availableSlots, setAvailableSlots] = useState([]);
  const [themes, setThemes] = useState(() => cacheService.get('consultation_themes') || []);
  const [selectedTheme, setSelectedTheme] = useState('');
  
  const [loadingBookingData, setLoadingBookingData] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [bookMessage, setBookMessage] = useState({ text: '', type: '' });
  // Счётчики запросов: ответ на старый выбор дисциплины/преподавателя не должен затирать новый
  const teachersReqRef = useRef(0);
  const slotsReqRef = useRef(0);

  // Optimal 21-day window for instant 1C backend responses (under 400ms)
  const [startDate] = useState(() => {
    const monday = getMondayOfWeek(new Date());
    return formatISODate(monday);
  });
  const [endDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    return formatISODate(d);
  });

  // Load My Consultations / Отработки
  const loadMyConsultations = useCallback(async (force = false) => {
    setLoadingMy(true);
    setErrorMy(null);
    try {
      const data = await lkService.getMyConsultations(startDate, endDate, { forceRefresh: force === true });
      const list = Array.isArray(data) ? data : [];
      // Keep any locally booked slots that might not yet be in server response
      setMyConsultations(prev => {
        const localOnly = prev.filter(p => p.isCreatedByApp && !list.some(s => s.startConsultation === p.startConsultation));
        const combined = [...localOnly, ...list];
        const sorted = combined.sort((a, b) => new Date(a.startConsultation || a.start) - new Date(b.startConsultation || b.start));
        cacheService.set('consultation_student_list', sorted);
        return sorted;
      });
    } catch (err) {
      console.warn('Load consultations warning:', err);
      setErrorMy(err.message === 'UNAUTHORIZED' 
        ? 'Требуется повторная авторизация' 
        : (err.message || 'Не удалось загрузить записи'));
    } finally {
      setLoadingMy(false);
    }
  }, [startDate, endDate]);

  // Load Disciplines & Themes
  const loadDisciplinesAndThemes = useCallback(async () => {
    setLoadingBookingData(true);
    setBookMessage({ text: '', type: '' });
    try {
      const [discData, themesData] = await Promise.all([
        lkService.getMyDisciplines(),
        lkService.getConsultationThemes()
      ]);
      const validDisc = Array.isArray(discData) ? discData : [];
      const validThemes = Array.isArray(themesData) ? themesData : [];
      setDisciplines(validDisc);
      setThemes(validThemes);
      cacheService.set('student_disciplines', validDisc);
      cacheService.set('consultation_themes', validThemes);
    } catch (err) {
      console.warn('Load disciplines warning:', err);
      setBookMessage({ 
        text: err.message === 'UNAUTHORIZED'
          ? 'Сессия истекла. Пожалуйста, войдите снова.'
          : 'Ошибка загрузки списка дисциплин с сервера вуза', 
        type: 'error' 
      });
    } finally {
      setLoadingBookingData(false);
    }
  }, []);

  // Initial loads
  useEffect(() => {
    loadMyConsultations();
  }, [loadMyConsultations]);

  useEffect(() => {
    loadDisciplinesAndThemes();
  }, [loadDisciplinesAndThemes]);

  // Pull-to-refresh listener without wiping cache
  useEffect(() => {
    const handlePull = () => {
      loadMyConsultations(true);
      loadDisciplinesAndThemes();
    };
    window.addEventListener("app-pull-to-refresh", handlePull);
    return () => window.removeEventListener("app-pull-to-refresh", handlePull);
  }, [loadMyConsultations, loadDisciplinesAndThemes]);

  // Load Teachers when Discipline changes
  const loadTeachers = useCallback(async (discId) => {
    if (!discId) return;
    const reqId = ++teachersReqRef.current;
    setTeachers([]);
    setLoadingBookingData(true);
    try {
      const data = await lkService.getDisciplineTeachers(discId);
      if (reqId !== teachersReqRef.current) return;
      setTeachers(Array.isArray(data) ? data : []);
    } catch (err) {
      if (reqId !== teachersReqRef.current) return;
      setBookMessage({ text: 'Ошибка загрузки преподавателей кафедры', type: 'error' });
    } finally {
      setLoadingBookingData(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDiscipline) {
      loadTeachers(selectedDiscipline);
      setAvailableSlots([]);
      setSelectedTeacher('');
    } else {
      teachersReqRef.current++;
      setTeachers([]);
      setSelectedTeacher('');
      setAvailableSlots([]);
    }
  }, [selectedDiscipline, loadTeachers]);

  // Load Slots when Teacher changes
  const loadSlots = useCallback(async (discId, teacherId, from, to) => {
    const reqId = ++slotsReqRef.current;
    setAvailableSlots([]);
    setLoadingBookingData(true);
    try {
      const data = await lkService.getConsultationsForDisciplineTeacher(discId, teacherId, from, to);
      if (reqId !== slotsReqRef.current) return;
      setAvailableSlots(Array.isArray(data) ? data : []);
    } catch (err) {
      if (reqId !== slotsReqRef.current) return;
      setBookMessage({ text: 'Ошибка загрузки свободных слотов', type: 'error' });
    } finally {
      setLoadingBookingData(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDiscipline && selectedTeacher && startDate && endDate) {
      loadSlots(selectedDiscipline, selectedTeacher, startDate, endDate);
    } else {
      slotsReqRef.current++;
      setAvailableSlots([]);
    }
  }, [selectedDiscipline, selectedTeacher, startDate, endDate, loadSlots]);

  const formatTime = (isoString) => {
    if (!isoString) return '--:--';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return String(isoString).slice(0, 5);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '--:--';
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch (_) {
      return '';
    }
  };

  const handleBook = async (slot) => {
    if (isBooking) return;
    if (!selectedTheme) {
      setBookMessage({ text: 'Пожалуйста, выберите тему / причину отработки', type: 'error' });
      return;
    }
    
    setIsBooking(true);
    setBookMessage({ text: '', type: '' });
    try {
      // value у <select> всегда строка, а id с сервера может прийти числом
      const disciplineObj = disciplines.find(d => String(d.id) === String(selectedDiscipline));
      const teacherObj = teachers.find(t => String(t.id) === String(selectedTeacher));
      const themeObj = themes.find(t => String(t.id) === String(selectedTheme));
      
      const payload = {
        day: slot.day,
        start: slot.start,
        end: slot.end,
        startConsultation: slot.startConsultation,
        endConsultation: slot.endConsultation,
        between: slot.between,
        typeConsultation: slot.typeConsultation || { remote: false, offline: true },
        teacher: teacherObj,
        discipline: disciplineObj,
        auditory: slot.auditory || null,
        corps: slot.corps || '',
        record: false,
        theme: selectedTheme,
        free: true,
        duration: 10
      };
      
      const res = await lkService.bookConsultation(payload);
      const msg = res?.return?.TextMessage || res?.return?.Status || 'Вы успешно записались на отработку!';
      setBookMessage({ text: msg, type: 'success' });
      
      // Auto-add the new appointment immediately
      const newBooking = {
        ...payload,
        isCreatedByApp: true,
        theme: themeObj?.name || selectedTheme
      };

      setMyConsultations(prev => {
        const updated = [newBooking, ...prev];
        cacheService.set('consultation_student_list', updated);
        return updated;
      });

      // Clear slots to prevent double booking
      setAvailableSlots(prev => prev.filter(s => s.startConsultation !== slot.startConsultation));
      // ...и в кэше слотов, иначе занятый слот вернётся при повторном выборе преподавателя
      const slotsKey = `consultations_${selectedDiscipline}_${selectedTeacher}_${startDate}_${endDate}`;
      const cachedSlots = cacheService.get(slotsKey);
      if (Array.isArray(cachedSlots)) {
        cacheService.set(slotsKey, cachedSlots.filter(s => s.startConsultation !== slot.startConsultation));
      }
    } catch (err) {
      setBookMessage({ text: err.message || 'Ошибка бронирования', type: 'error' });
    } finally {
      setIsBooking(false);
    }
  };

  const handleCancel = async (slot) => {
    const dateStr = formatDate(slot.startConsultation || slot.start);
    const timeStr = formatTime(slot.startConsultation || slot.start);
    if (!window.confirm(`Вы действительно хотите отменить запись на отработку (${dateStr}, ${timeStr})?`)) {
      return;
    }
    
    setLoadingMy(true);
    try {
      await lkService.cancelConsultation({
        teacher: slot.teacher?.id || slot.teacher,
        startConsultation: slot.startConsultation
      });
      
      // Убираем и из кэша ответа сервера (TTL 3 мин), иначе отменённая запись вернётся при обновлении
      const myKey = `consultation_my_${startDate}_${endDate}`;
      const cachedMy = cacheService.get(myKey);
      if (Array.isArray(cachedMy)) {
        cacheService.set(myKey, cachedMy.filter(item => item.startConsultation !== slot.startConsultation));
      }

      // Remove locally immediately
      setMyConsultations(prev => {
        const updated = prev.filter(item => item.startConsultation !== slot.startConsultation);
        cacheService.set('consultation_student_list', updated);
        return updated;
      });
    } catch (err) {
      alert(err.message || 'Ошибка отмены записи');
    } finally {
      setLoadingMy(false);
    }
  };

  const hasBookings = myConsultations && myConsultations.length > 0;

  // Render Section 1: Bookings List
  const renderBookingsBlock = () => (
    <div className="space-y-3.5 min-w-0 w-full">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
          Мои записи на отработку ({myConsultations.length})
        </h2>
        <button
          onClick={() => loadMyConsultations(true)}
          disabled={loadingMy}
          className="text-xs font-semibold text-secondary dark:text-[#38BDF8] hover:underline flex items-center space-x-1"
        >
          <Icons.Refresh size={13} className={loadingMy ? 'animate-spin' : ''} />
          <span>Обновить</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 min-w-0 w-full">
        {myConsultations.map((item, idx) => {
          const startTime = item.startConsultation || item.start;
          const endTime = item.endConsultation || item.end;
          const isPast = new Date(endTime || startTime) < new Date();
          
          return (
            <Card key={idx} className={`p-4 sm:p-5 overflow-hidden w-full min-w-0 transition-all border border-border dark:border-[#2B3242] ${isPast ? 'opacity-65' : 'hover:border-accent dark:hover:border-[#38BDF8]'}`}>
              {/* Top Row: Date & Time + Status Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 w-full min-w-0">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className={`p-2 rounded-xl shrink-0 ${isPast ? 'bg-bg dark:bg-[#12151B] text-textMuted' : 'bg-primary/10 text-primary dark:text-[#38BDF8]'}`}>
                    <Icons.Calendar size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-dark dark:text-white truncate">
                      {formatDate(startTime)}
                    </div>
                    <div className="text-xs font-semibold text-textMuted dark:text-[#8E98A8]">
                      {formatTime(startTime)} — {formatTime(endTime)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  {item.isCreatedByApp && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-accent/15 text-accent dark:text-[#38BDF8]">
                      Приложение
                    </span>
                  )}
                  <Badge type={isPast ? 'outline' : 'primary'} className="shrink-0 text-[11px]">
                    {isPast ? 'Прошла' : 'Предстоящая'}
                  </Badge>
                </div>
              </div>
              
              {/* Details */}
              <div className="space-y-2 mt-3 pt-3 border-t border-border dark:border-[#2B3242] text-xs">
                {item.discipline && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-textMuted dark:text-[#8E98A8] tracking-wider">Дисциплина</p>
                    <p className="text-sm font-bold text-dark dark:text-white leading-snug break-words mt-0.5">
                      {item.discipline?.name || item.discipline}
                    </p>
                  </div>
                )}
                
                {item.teacher && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-textMuted dark:text-[#8E98A8] tracking-wider">Преподаватель</p>
                    <div className="flex items-center space-x-1.5 mt-0.5 text-secondary dark:text-[#38BDF8] font-semibold">
                      <Icons.User size={14} className="shrink-0" />
                      <span className="truncate">{item.teacher?.name || item.teacher}</span>
                    </div>
                  </div>
                )}

                {item.theme && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-textMuted dark:text-[#8E98A8] tracking-wider">Тема / Причина</p>
                    <p className="text-xs text-dark dark:text-white mt-0.5">
                      {typeof item.theme === 'object' ? item.theme?.name : item.theme}
                    </p>
                  </div>
                )}
                
                {(item.auditory || item.corps) && (
                  <div className="flex items-center space-x-1.5 text-textMuted dark:text-[#8E98A8]">
                    <span className="font-semibold text-dark dark:text-white">
                      Аудитория: {item.auditory?.name || item.auditory || '—'}
                    </span>
                    {item.corps && <span>({item.corps})</span>}
                  </div>
                )}
              </div>
              
              {/* Action */}
              {!isPast && (
                <div className="mt-4 pt-3 border-t border-border dark:border-[#2B3242]">
                  <button 
                    onClick={() => handleCancel(item)}
                    disabled={loadingMy}
                    className="w-full py-2 text-xs font-bold text-rose-500 hover:text-rose-600 bg-rose-500/10 hover:bg-rose-500/20 rounded-xl transition-colors disabled:opacity-50"
                  >
                    Отменить запись
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );

  // Render Section 2: Booking Form & Slots
  const renderBookingBlock = () => (
    <div className="space-y-4 min-w-0 w-full">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
          Параметры записи на отработку
        </h2>
      </div>

      {bookMessage.text && (
        <div className={`p-4 rounded-2xl text-xs sm:text-sm font-bold border flex items-center space-x-2.5 ${
          bookMessage.type === 'error' 
            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300' 
            : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300'
        }`}>
          <Icons.AlertCircle size={18} className="shrink-0" />
          <span>{bookMessage.text}</span>
        </div>
      )}

      {/* Form Selection Card */}
      <Card className="p-5 space-y-4 min-w-0 w-full border border-border dark:border-[#2B3242]">
        <div className="space-y-3.5">
          {/* Discipline Select */}
          <div>
            <label className="block text-xs font-bold text-dark dark:text-white mb-1.5">
              1. Дисциплина
            </label>
            <select 
              className="w-full p-3 bg-bg dark:bg-[#12151B] border border-border dark:border-[#2B3242] rounded-xl text-xs sm:text-sm font-medium text-dark dark:text-white focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
              value={selectedDiscipline}
              onChange={(e) => setSelectedDiscipline(e.target.value)}
              disabled={loadingBookingData || disciplines.length === 0}
            >
              <option value="">
                {disciplines.length === 0
                  ? (loadingBookingData ? '-- Дисциплины загружаются... --' : '-- Нет доступных дисциплин --')
                  : '-- Выберите дисциплину --'}
              </option>
              {disciplines.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            {disciplines.length === 0 && !loadingBookingData && (
              <button
                onClick={loadDisciplinesAndThemes}
                className="mt-2 text-xs font-bold text-secondary dark:text-[#38BDF8] hover:underline"
              >
                Повторить загрузку дисциплин →
              </button>
            )}
          </div>

          {/* Teacher Select */}
          {selectedDiscipline && (
            <div>
              <label className="block text-xs font-bold text-dark dark:text-white mb-1.5">
                2. Преподаватель
              </label>
              <select 
                className="w-full p-3 bg-bg dark:bg-[#12151B] border border-border dark:border-[#2B3242] rounded-xl text-xs sm:text-sm font-medium text-dark dark:text-white focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                value={selectedTeacher}
                onChange={(e) => setSelectedTeacher(e.target.value)}
                disabled={loadingBookingData || teachers.length === 0}
              >
                <option value="">
                  {teachers.length === 0 && loadingBookingData 
                    ? '-- Поиск преподавателей кафедры... --' 
                    : '-- Выберите преподавателя --'}
                </option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          
          {/* Theme Select */}
          {selectedDiscipline && selectedTeacher && (
            <div>
              <label className="block text-xs font-bold text-dark dark:text-white mb-1.5">
                3. Причина отработки / тема
              </label>
              <select 
                className="w-full p-3 bg-bg dark:bg-[#12151B] border border-border dark:border-[#2B3242] rounded-xl text-xs sm:text-sm font-medium text-dark dark:text-white focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                value={selectedTheme}
                onChange={(e) => setSelectedTheme(e.target.value)}
                disabled={loadingBookingData || themes.length === 0}
              >
                <option value="">-- Выберите причину обращения --</option>
                {themes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      {/* Slots Section */}
      {selectedDiscipline && selectedTeacher && (
        <div className="space-y-3 min-w-0 w-full pt-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8] px-1">
            Доступные слоты для записи
          </h3>
          
          {loadingBookingData ? (
            <Card className="p-8 text-center flex flex-col items-center justify-center border border-border dark:border-[#2B3242]">
              <LoadingSpinner size={6} text="Поиск открытых слотов преподавателя..." />
            </Card>
          ) : availableSlots.length === 0 ? (
            <Card className="p-8 text-center bg-transparent border border-dashed border-border dark:border-[#2B3242]">
              <div className="w-12 h-12 rounded-full bg-accent/10 dark:bg-[#1E6685]/30 flex items-center justify-center mx-auto mb-3 text-accent dark:text-[#38BDF8]">
                <Icons.Calendar size={22} />
              </div>
              <p className="text-sm font-bold text-dark dark:text-white">
                Нет открытых слотов на ближайшие даты
              </p>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
                Попробуйте выбрать другого преподавателя кафедры
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 min-w-0 w-full">
              {availableSlots.map((slot, idx) => (
                <button
                  key={idx}
                  disabled={isBooking}
                  onClick={() => handleBook(slot)}
                  className="text-left w-full bg-card border border-border dark:border-[#2B3242] p-4 rounded-2xl hover:border-accent dark:hover:border-[#38BDF8] hover:shadow-md transition-all disabled:opacity-50 group min-w-0 overflow-hidden"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2 w-full min-w-0">
                    <span className="font-bold text-xs sm:text-sm text-dark dark:text-white truncate">
                      {formatDate(slot.startConsultation || slot.start)}
                    </span>
                    <Badge type="secondary" className="shrink-0 text-[11px] group-hover:bg-accent group-hover:text-white transition-colors">
                      {formatTime(slot.startConsultation || slot.start)}
                    </Badge>
                  </div>
                  
                  <div className="text-xs text-textMuted dark:text-[#8E98A8] mt-2 pt-2 border-t border-border dark:border-[#2B3242] space-y-1">
                    <div className="flex justify-between">
                      <span>Длительность:</span>
                      <span className="font-semibold text-dark dark:text-white">{slot.between || '15 мин'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Аудитория:</span>
                      <span className="font-semibold text-dark dark:text-white truncate ml-2">
                        {slot.auditory?.name || slot.auditory || 'Кафедра'} {slot.corps ? `(${slot.corps})` : ''}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Render Section 3: Empty State Notice
  const renderEmptyNotice = () => (
    <Card className="p-6 sm:p-7 text-center border border-border dark:border-[#2B3242] bg-card dark:bg-[#181C26]">
      <div className="w-12 h-12 rounded-2xl bg-accent/10 dark:bg-[#1E6685]/30 flex items-center justify-center mx-auto mb-3.5 text-accent dark:text-[#38BDF8]">
        <Icons.UserCheck size={26} />
      </div>
      <p className="text-xs sm:text-sm text-textMuted dark:text-[#8E98A8] leading-relaxed max-w-xl mx-auto font-medium">
        Имеющихся записей нет или запись велась через сайт ВУЗа. В таком случае запись может отобразиться с задержкой из-за особенностей работы сайта. Как же хорошо, что записи через приложение отображаются без задержек.
      </p>
    </Card>
  );

  return (
    <div className="space-y-6 pb-8 w-full min-w-0">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black text-dark dark:text-white tracking-wide">
            Отработки
          </h1>
          <p className="text-xs font-medium text-textMuted dark:text-[#8E98A8] mt-0.5">
            Запись на отработки, консультации и приём академических задолженностей
          </p>
        </div>
      </div>

      {errorMy && (
        <div className="p-4 rounded-2xl text-xs sm:text-sm font-bold border flex items-center space-x-2.5 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300">
          <Icons.AlertCircle size={18} className="shrink-0" />
          <span className="min-w-0 break-words">{errorMy}</span>
        </div>
      )}

      {/* Dynamic Unified Layout:
          If bookings exist: Bookings block TOP -> Booking params block BOTTOM
          If NO bookings: Booking params block TOP -> Explanatory notice BOTTOM */}
      {hasBookings ? (
        <div className="space-y-8">
          {renderBookingsBlock()}
          <div className="pt-2 border-t border-border dark:border-[#212634]">
            {renderBookingBlock()}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {renderBookingBlock()}
          <div className="pt-2">
            {loadingMy ? (
              <LoadingSpinner size={6} text="Загрузка ваших записей..." />
            ) : (
              renderEmptyNotice()
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsultationsPage;
