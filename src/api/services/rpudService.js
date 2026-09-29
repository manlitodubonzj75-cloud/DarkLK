import * as pdfjsLib from 'pdfjs-dist';
import { cryptoStorage } from '../cryptoStorage';
import { cacheService } from '../cacheService';
import { isCollegeStudent, getStudentCourse } from '../lkUtils';

// Set up worker for pdfjs in Vite/browser environment
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

const RPUD_CONFIG_KEY = 'msal_rpud_config';
const DEFAULT_DISK_URL = 'https://disk.yandex.ru/d/evfRNIuXmo8u7A';
const MEMORY_CACHE = new Map();

/**
 * Normalizes Russian discipline titles for robust fuzzy matching.
 */
export function normalizeDisciplineName(name) {
  if (!name) return '';
  let s = String(name).toLowerCase().replace(/ё/g, 'е');
  // Strip leading code patterns: "ОУП.03", "ОП.01", "ПМ.01", "СГ.02", "ДУП.01"
  s = s.replace(/^(?:оуп|оп|пм|сг|дуп)\.\d+(?:нв\d+)?\s*/i, '');
  // Strip parentheses and brackets: "(РП)", "(ООО)", "(СОО)"
  s = s.replace(/\s*\([^)]*\)/g, ' ');
  // Strip punctuation
  s = s.replace(/[^\w\sа-я]/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes lesson type (lecture, seminar, practice, coursework).
 */
export function normalizeLessonType(rawType) {
  if (!rawType) return 'practice';
  const t = String(rawType).toLowerCase();
  if (t.includes('лекц')) return 'lecture';
  if (t.includes('семинар')) return 'seminar';
  if (t.includes('курсов')) return 'coursework';
  if (t.includes('практик') || t.includes('лаборат')) return 'practice';
  return 'practice';
}

/**
 * Extracts lessons from Section 2.2 ("Тематический план") of RPUD text.
 */
export function parseSection22Text(fullText, disciplineName = '', disciplineCode = '') {
  const s22Idx = fullText.indexOf('2.2. Тематический план');
  const fallbackIdx = s22Idx !== -1 ? s22Idx : fullText.indexOf('Тематический план');

  if (fallbackIdx === -1) {
    return {
      code: disciplineCode,
      discipline: disciplineName,
      lessons: []
    };
  }

  const s3Idx = fullText.indexOf('3. УСЛОВИЯ РЕАЛИЗАЦИИ', fallbackIdx);
  const s22Text = s3Idx !== -1 ? fullText.slice(fallbackIdx, s3Idx) : fullText.slice(fallbackIdx);

  const regex = /(Семинарское занятие|Практическое занятие|Практическая работа|Лекция)\s*№?\s*(\d+)[\.\s]+([\s\S]*?)(?=(?:Семинарское занятие|Практическое занятие|Практическая работа|Лекция)\s*№?\s*\d+|Тема\s+\d+|3\.\s+УСЛОВИЯ|$)/gi;

  let match;
  const lessons = [];

  while ((match = regex.exec(s22Text)) !== null) {
    const rawKind = match[1].trim();
    const number = parseInt(match[2], 10);
    const body = match[3].replace(/\s+/g, ' ').trim();

    // Look for preceding topic code
    const beforeMatch = s22Text.slice(Math.max(0, match.index - 300), match.index);
    const themeMatch = beforeMatch.match(/Тема\s+(\d+(?:\.\d+)?)\.?\s*([^\n\r]+)?/i);

    const themeCode = themeMatch ? `Тема ${themeMatch[1]}` : '';
    const themeTitle = themeMatch && themeMatch[2] ? themeMatch[2].trim().slice(0, 80) : '';

    // Extract plan points (e.g. "1. Вопрос один. 2. Вопрос два.")
    const plan = [];
    const questionMatches = body.match(/\d+\.\s+[^.!?]+[.!?]/g);
    if (questionMatches && questionMatches.length > 0) {
      questionMatches.forEach((q) => {
        const cleaned = q.replace(/^\d+\.\s*/, '').trim();
        if (cleaned.length > 3) plan.push(cleaned);
      });
    }

    const sentences = body.split(/[.!?]\s+/);
    const lessonTitle = sentences[0] ? sentences[0].slice(0, 120).trim() : body.slice(0, 80);

    lessons.push({
      number,
      rawType: `${rawKind} № ${number}`,
      type: normalizeLessonType(rawKind),
      themeCode,
      themeTitle,
      lessonTitle,
      plan: plan.length > 0 ? plan : (sentences.length > 1 ? sentences.slice(1, 6) : [])
    });
  }

  return {
    code: disciplineCode,
    discipline: disciplineName,
    lessons
  };
}

export const rpudService = {
  /**
   * Automatically detects base of education (OOO / SOO) and course from student profile.
   */
  detectDefaults(user = null) {
    const u = user || cryptoStorage.getUser();
    let level = 'ooo';
    let course = 1;
    let specialization = 'court_admin';

    if (u) {
      const group = String(u.group || '').toLowerCase();
      const dep = String(u.department || u.speciality || '').toLowerCase();

      if (group.includes('соо') || dep.includes('среднего общего') || dep.includes(' 11 ')) {
        level = 'soo';
      } else if (group.includes('ооо') || dep.includes('основного общего') || dep.includes(' 9 ')) {
        level = 'ooo';
      }

      course = getStudentCourse(u);

      if (dep.includes('правоохран') || group.includes('под') || group.includes('по')) {
        specialization = 'law_enforcement';
      } else if (dep.includes('судебн') || group.includes('сад') || group.includes('са')) {
        specialization = 'court_admin';
      } else if (dep.includes('обеспеч') || group.includes('пог') || group.includes('подг')) {
        specialization = 'law_organizations';
      }
    }

    return {
      enabled: true,
      academicYear: null, // null means auto-detect latest from Yandex Disk
      specialization,
      level,
      course,
      diskUrl: DEFAULT_DISK_URL,
    };
  },

  /**
   * Get student RPUD settings from storage or defaults.
   */
  getConfig() {
    try {
      const stored = cryptoStorage.getItem(RPUD_CONFIG_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...this.detectDefaults(),
          ...parsed
        };
      }
    } catch {
      // ignore
    }
    return this.detectDefaults();
  },

  /**
   * Save RPUD configuration.
   */
  saveConfig(config) {
    try {
      cryptoStorage.setItem(RPUD_CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('[rpudService] Failed to save config:', e);
    }
  },

  /**
   * Generates standard course key: '1_ooo', '1_soo', '2_ooo', '2_soo', '3_ooo'.
   */
  getCourseKey(config = null) {
    const conf = config || this.getConfig();
    let course = Number(conf.course) || 1;
    if (course < 1) course = 1;
    if (course > 3) course = 3;
    const level = conf.level === 'soo' ? 'soo' : 'ooo';
    if (level === 'soo' && course > 2) course = 2;
    return `${course}_${level}`;
  },

  /**
   * Dynamically inspects Yandex Disk public folder to discover available Academic Years.
   */
  async fetchAcademicYears(diskUrl = DEFAULT_DISK_URL) {
    try {
      const url = `https://cloud-api.yandex.net/v1/disk/public/resources?public_key=${encodeURIComponent(diskUrl)}&path=${encodeURIComponent('/Колледж права')}&limit=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = data._embedded?.items || [];

      const years = items
        .filter((i) => i.type === 'dir' && /\d{4}-\d{4}/.test(i.name))
        .map((i) => i.name)
        .sort((a, b) => b.localeCompare(a)); // latest year first

      return years.length > 0 ? years : ['2026-2027 учебный год'];
    } catch (err) {
      console.warn('[rpudService] Failed to fetch academic years from disk:', err.message);
      return ['2026-2027 учебный год'];
    }
  },

  /**
   * Resolves the active academic year (latest on disk or user selected).
   */
  async resolveAcademicYear(diskUrl = DEFAULT_DISK_URL) {
    const conf = this.getConfig();
    if (conf.academicYear) {
      return conf.academicYear;
    }
    const years = await this.fetchAcademicYears(diskUrl);
    return years[0];
  },

  /**
   * Dynamically lists the PDF files for student's level and course on Yandex Disk.
   */
  async fetchCoursePdfList(config = null) {
    const conf = config || this.getConfig();
    const diskUrl = conf.diskUrl || DEFAULT_DISK_URL;
    const yearFolder = await this.resolveAcademicYear(diskUrl);

    const specMap = {
      court_admin: 'Юрист в сфере судебного администрирования',
      law_enforcement: 'Юрист в сфере правоохранительной деятельности',
      law_organizations: 'Юрист в сфере правового обеспечения деятельности организаций и граждан'
    };
    const directionName = specMap[conf.specialization] || specMap.law_organizations;
    const courseFolderName = `${conf.course} курс ${conf.level.toUpperCase()}`;

    const folderPath = `/Колледж права/${yearFolder}/${directionName}/${courseFolderName}`;

    try {
      const url = `https://cloud-api.yandex.net/v1/disk/public/resources?public_key=${encodeURIComponent(diskUrl)}&path=${encodeURIComponent(folderPath)}&limit=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${folderPath}`);
      const data = await res.json();
      const items = data._embedded?.items || [];

      return items
        .filter((i) => i.type === 'file' && i.name.toLowerCase().endsWith('.pdf'))
        .map((i) => ({
          name: i.name,
          path: i.path,
          file: i.file,
          size: i.size,
          modified: i.modified,
          etag: i.etag || i.md5 || String(i.size),
        }));
    } catch (err) {
      console.warn(`[rpudService] Failed to list PDFs from ${folderPath}:`, err.message);
      return [];
    }
  },

  /**
   * Downloads and parses a single RPUD PDF file dynamically in the client.
   */
  async parsePdfFromUrl(fileUrl, filename) {
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();

      const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
        cMapPacked: true
      }).promise;

      let fullText = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        fullText += '\n' + textContent.items.map((it) => it.str).join(' ');
      }

      // Extract code (e.g. "ОУП.01", "ОП.02") and clean title
      const codeMatch = filename.match(/^([А-Яа-яA-Za-z0-9.]+)\s+(.*)/);
      const code = codeMatch ? codeMatch[1].trim() : '';
      let discName = codeMatch ? codeMatch[2].replace(/\s*\([^)]*\)/g, '').trim() : filename.replace(/\.pdf$/i, '');
      discName = discName.replace(/\.pdf$/i, '').trim();

      return parseSection22Text(fullText, discName, code);
    } catch (err) {
      console.warn(`[rpudService] Error parsing PDF ${filename}:`, err);
      return null;
    }
  },

  /**
   * Performs dynamic synchronization directly from Yandex Disk.
   */
  async syncFromYandexDisk(options = {}) {
    const config = this.getConfig();
    const diskUrl = config.diskUrl || DEFAULT_DISK_URL;
    const academicYear = await this.resolveAcademicYear(diskUrl);
    const courseKey = this.getCourseKey(config);

    if (options.onProgress) {
      options.onProgress({ step: 'discovery', message: `Проверка диска: ${academicYear}...` });
    }

    const pdfList = await this.fetchCoursePdfList(config);
    if (!pdfList || pdfList.length === 0) {
      throw new Error(`На Яндекс.Диске не найдены файлы для ${courseKey} в ${academicYear}`);
    }

    const currentData = (await this.loadRpudData({ force: true })) || {};
    let updatedCount = 0;

    for (let i = 0; i < pdfList.length; i++) {
      const pdf = pdfList[i];
      const itemCacheKey = `rpud_item_${academicYear}_${courseKey}_${pdf.etag}`;

      if (options.onProgress) {
        options.onProgress({
          step: 'downloading',
          current: i + 1,
          total: pdfList.length,
          name: pdf.name,
          message: `Обработка (${i + 1}/${pdfList.length}): ${pdf.name}`
        });
      }

      let parsedDiscipline = cacheService.get(itemCacheKey);
      if (!parsedDiscipline || options.force) {
        parsedDiscipline = await this.parsePdfFromUrl(pdf.file, pdf.name);
        if (parsedDiscipline) {
          cacheService.set(itemCacheKey, parsedDiscipline, { ttl: 30 * 24 * 3600 * 1000 });
          updatedCount++;
        }
      }

      if (parsedDiscipline && parsedDiscipline.discipline) {
        const normKey = normalizeDisciplineName(parsedDiscipline.discipline);
        currentData[normKey] = parsedDiscipline;
      }
    }

    // Save compiled dataset for this course
    const cacheKey = `rpud_data_${courseKey}`;
    MEMORY_CACHE.set(courseKey, currentData);
    cacheService.set(cacheKey, currentData, { ttl: 30 * 24 * 3600 * 1000 });

    this.saveConfig({ ...config, academicYear });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('rpud-config-changed', { detail: currentData }));
    }

    return {
      success: true,
      academicYear,
      totalPdfs: pdfList.length,
      updatedCount,
      disciplinesCount: Object.keys(currentData).length
    };
  },

  /**
   * Loads RPUD dataset for current student's course.
   */
  async loadRpudData(options = {}) {
    const config = this.getConfig();
    if (!config.enabled && !options.force) return null;

    const courseKey = this.getCourseKey(config);
    if (MEMORY_CACHE.has(courseKey) && !options.forceRefresh) {
      return MEMORY_CACHE.get(courseKey);
    }

    const cacheKey = `rpud_data_${courseKey}`;
    const cached = cacheService.get(cacheKey);
    if (cached && !options.forceRefresh) {
      MEMORY_CACHE.set(courseKey, cached);
      return cached;
    }

    // Fallback to static bundled data if online sync hasn't run yet
    try {
      const res = await fetch(`/data/rpud/${courseKey}.json`);
      if (res.ok) {
        const data = await res.json();
        MEMORY_CACHE.set(courseKey, data);
        cacheService.set(cacheKey, data, { ttl: 7 * 24 * 3600 * 1000 });
        return data;
      }
    } catch {
      // ignore
    }

    if (cached) return cached;
    return null;
  },

  /**
   * Resolves discipline from RPUD dataset by student journal/schedule discipline name.
   */
  findDisciplineInRpud(rpudData, disciplineName) {
    if (!rpudData || !disciplineName) return null;
    const norm = normalizeDisciplineName(disciplineName);
    if (!norm) return null;

    if (rpudData[norm]) return rpudData[norm];

    const keys = Object.keys(rpudData);
    for (const k of keys) {
      const entry = rpudData[k];
      const entryNorm = normalizeDisciplineName(entry.discipline);
      if (entryNorm === norm) return entry;
    }

    for (const k of keys) {
      const entry = rpudData[k];
      const entryNorm = normalizeDisciplineName(entry.discipline);
      if (norm.includes(entryNorm) || entryNorm.includes(norm)) {
        return entry;
      }
    }

    return null;
  },

  /**
   * Smartly attaches RPUD topics to schedule days chronologically.
   */
  async enrichScheduleWithThemes(scheduleDays, options = {}) {
    if (!Array.isArray(scheduleDays) || scheduleDays.length === 0) {
      return scheduleDays;
    }

    const isCollege = isCollegeStudent(cryptoStorage.getUser());
    if (!isCollege) return scheduleDays;

    const config = this.getConfig();
    if (!config.enabled && !options.force) return scheduleDays;

    const rpudData = await this.loadRpudData();
    if (!rpudData) return scheduleDays;

    // Flatten all schedule pairs chronologically
    const allPairs = [];
    scheduleDays.forEach((day, dayIdx) => {
      const dayDate = day.title || day.date;
      const items = Array.isArray(day.data) ? day.data : [];
      items.forEach((item, itemIdx) => {
        allPairs.push({
          dayDate,
          dayIdx,
          itemIdx,
          item,
          discipline: item.discipline || item.title || '',
          type: item.type || '',
          time: item.time || item.start || '',
          isCancelled: Boolean(item.isCancelled || item.canceled || String(item.type).toLowerCase().includes('отмен')),
        });
      });
    });

    // Sort chronologically (date + time)
    allPairs.sort((a, b) => {
      const cmpDate = String(a.dayDate).localeCompare(String(b.dayDate));
      if (cmpDate !== 0) return cmpDate;
      return String(a.time).localeCompare(String(b.time));
    });

    // Sequentially allocate topics by discipline and type
    const counters = new Map();
    const assignedThemes = new Map();

    for (const pair of allPairs) {
      if (pair.isCancelled) continue;

      const discEntry = this.findDisciplineInRpud(rpudData, pair.discipline);
      if (!discEntry || !Array.isArray(discEntry.lessons)) continue;

      const normType = normalizeLessonType(pair.type);
      const discKey = normalizeDisciplineName(discEntry.discipline);
      const counterKey = `${discKey}__${normType}`;

      const currentCount = counters.get(counterKey) || 0;
      const targetNumber = currentCount + 1;

      const typeLessons = discEntry.lessons.filter((l) => l.type === normType);
      let matchedLesson = typeLessons.find((l) => l.number === targetNumber);

      if (!matchedLesson && currentCount < typeLessons.length) {
        matchedLesson = typeLessons[currentCount];
      }

      if (matchedLesson) {
        counters.set(counterKey, targetNumber);
        assignedThemes.set(`${pair.dayIdx}_${pair.itemIdx}`, {
          disciplineCode: discEntry.code,
          disciplineName: discEntry.discipline,
          rawType: matchedLesson.rawType,
          lessonNumber: matchedLesson.number,
          themeCode: matchedLesson.themeCode,
          themeTitle: matchedLesson.themeTitle,
          lessonTitle: matchedLesson.lessonTitle,
          plan: matchedLesson.plan || [],
        });
      }
    }

    // Map enriched themes back to structure
    return scheduleDays.map((day, dayIdx) => {
      const items = Array.isArray(day.data) ? day.data : [];
      const enrichedItems = items.map((item, itemIdx) => {
        const theme = assignedThemes.get(`${dayIdx}_${itemIdx}`);
        if (theme) {
          return {
            ...item,
            rpudTheme: theme,
          };
        }
        return item;
      });

      return {
        ...day,
        data: enrichedItems,
      };
    });
  },

  /**
   * Smartly enriches student disciplines list and journal lessons with RPUD topics.
   */
  async enrichDisciplinesWithThemes(disciplines, scheduleDays = null) {
    if (!Array.isArray(disciplines) || disciplines.length === 0) {
      return disciplines;
    }

    const isCollege = isCollegeStudent(cryptoStorage.getUser());
    if (!isCollege) return disciplines;

    const config = this.getConfig();
    if (!config.enabled) return disciplines;

    const rpudData = await this.loadRpudData();
    if (!rpudData) return disciplines;

    return disciplines.map((disc) => {
      const discEntry = this.findDisciplineInRpud(rpudData, disc.name);
      if (!discEntry) return disc;

      const lessons = Array.isArray(disc.lessons) ? disc.lessons : [];
      const discLessons = discEntry.lessons || [];

      const enrichedLessons = lessons.map((l, lIdx) => {
        const normType = normalizeLessonType(l.type || 'practice');
        const typeLessons = discLessons.filter((item) => item.type === normType);
        const lessonNumber = lIdx + 1;
        const matched = typeLessons.find((item) => item.number === lessonNumber) || typeLessons[lIdx];

        if (matched) {
          return {
            ...l,
            rpudTheme: {
              disciplineCode: discEntry.code,
              disciplineName: discEntry.discipline,
              rawType: matched.rawType,
              lessonNumber: matched.number,
              themeCode: matched.themeCode,
              themeTitle: matched.themeTitle,
              lessonTitle: matched.lessonTitle,
              plan: matched.plan || [],
            }
          };
        }
        return l;
      });

      return {
        ...disc,
        rpudDiscipline: {
          code: discEntry.code,
          name: discEntry.discipline,
        },
        lessons: enrichedLessons,
      };
    });
  }
};
