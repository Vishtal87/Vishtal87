// Логика дневника давления. Не медицинское изделие: показывает категорию по таблице AHA 2017
// и не ставит диагнозов. Решения о лечении принимает врач.
import { translate, localeTag } from './i18n.mjs';

export const CATEGORIES = Object.freeze({
  NORMAL: 'normal',
  ELEVATED: 'elevated',
  STAGE1: 'stage1',
  STAGE2: 'stage2',
  CRISIS: 'crisis',
});

// Категория по систолическому (верхнему) и диастолическому (нижнему) давлению.
// Берём более высокую из двух оценок. Кризис: выше 180 или выше 120 диастолическое.
export function classify(systolic, diastolic) {
  if (systolic > 180 || diastolic > 120) return CATEGORIES.CRISIS;
  if (systolic >= 140 || diastolic >= 90) return CATEGORIES.STAGE2;
  if (systolic >= 130 || diastolic >= 80) return CATEGORIES.STAGE1;
  if (systolic >= 120 && diastolic < 80) return CATEGORIES.ELEVATED;
  return CATEGORIES.NORMAL;
}

// Проверка ввода. Возвращает ключ ошибки перевода или null.
export function validate({ systolic, diastolic, pulse }) {
  const s = Number(systolic);
  const d = Number(diastolic);
  if (!Number.isInteger(s) || s < 60 || s > 260) return 'err_systolic';
  if (!Number.isInteger(d) || d < 30 || d > 160) return 'err_diastolic';
  if (d >= s) return 'err_order';
  if (pulse !== '' && pulse !== undefined && pulse !== null) {
    const p = Number(pulse);
    if (!Number.isInteger(p) || p < 30 || p > 220) return 'err_pulse';
  }
  return null;
}

// Среднее за период. days — сколько последних дней учитывать. now — для тестов.
export function averageForDays(readings, days, now = Date.now()) {
  const since = now - days * 24 * 60 * 60 * 1000;
  const recent = readings.filter((r) => r.takenAt >= since);
  if (recent.length === 0) return null;
  const sum = recent.reduce(
    (acc, r) => ({ s: acc.s + r.systolic, d: acc.d + r.diastolic }),
    { s: 0, d: 0 },
  );
  return {
    count: recent.length,
    systolic: Math.round(sum.s / recent.length),
    diastolic: Math.round(sum.d / recent.length),
  };
}

// Новые сверху.
export function sortNewestFirst(readings) {
  return [...readings].sort((a, b) => b.takenAt - a.takenAt);
}

// Экспорт в CSV. Заголовки и названия категорий — на выбранном языке.
export function toCsv(readings, lang = 'en') {
  const header = [
    translate(lang, 'csv_date'),
    translate(lang, 'csv_systolic'),
    translate(lang, 'csv_diastolic'),
    translate(lang, 'csv_pulse'),
    translate(lang, 'csv_category'),
  ].join(',');
  const rows = sortNewestFirst(readings).map((r) => {
    const pulse = r.pulse ?? '';
    return [
      new Date(r.takenAt).toISOString(),
      r.systolic,
      r.diastolic,
      pulse,
      translate(lang, `cat_${classify(r.systolic, r.diastolic)}`),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

export function makeReading({ systolic, diastolic, pulse }, takenAt = Date.now()) {
  return {
    id: `${takenAt}-${Math.random().toString(36).slice(2, 8)}`,
    takenAt,
    systolic: Number(systolic),
    diastolic: Number(diastolic),
    pulse: pulse === '' || pulse === undefined || pulse === null ? null : Number(pulse),
  };
}

// Дата и время из строки «дд.мм.гггг чч:мм». Пустая строка — сейчас.
// Возвращает миллисекунды или ключ ошибки в поле error.
export function parseTakenAt(text, now = Date.now()) {
  const raw = (text ?? '').trim();
  if (raw === '') return { takenAt: now, error: null };
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return { takenAt: null, error: 'err_date_format' };
  const [, dd, mm, yyyy, hh = '0', mi = '0'] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
  const valid =
    d.getFullYear() === Number(yyyy) &&
    d.getMonth() === Number(mm) - 1 &&
    d.getDate() === Number(dd) &&
    Number(hh) < 24 &&
    Number(mi) < 60;
  if (!valid) return { takenAt: null, error: 'err_date_invalid' };
  if (d.getTime() > now + 60 * 1000) return { takenAt: null, error: 'err_date_future' };
  return { takenAt: d.getTime(), error: null };
}

export { localeTag };
