// Логика дневника давления. Не медицинское изделие: показывает категорию по таблице AHA 2017
// и не ставит диагнозов. Решения о лечении принимает врач.

export const CATEGORIES = Object.freeze({
  NORMAL: 'normal',
  ELEVATED: 'elevated',
  STAGE1: 'stage1',
  STAGE2: 'stage2',
  CRISIS: 'crisis',
});

export const CATEGORY_LABELS = Object.freeze({
  normal: 'Нормальное',
  elevated: 'Повышенное',
  stage1: 'Гипертензия 1 степени',
  stage2: 'Гипертензия 2 степени',
  crisis: 'Высокое, обратитесь к врачу',
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

// Проверка ввода. Возвращает текст ошибки или null.
export function validate({ systolic, diastolic, pulse }) {
  const s = Number(systolic);
  const d = Number(diastolic);
  if (!Number.isInteger(s) || s < 60 || s > 260) return 'Верхнее давление: от 60 до 260';
  if (!Number.isInteger(d) || d < 30 || d > 160) return 'Нижнее давление: от 30 до 160';
  if (d >= s) return 'Нижнее давление должно быть меньше верхнего';
  if (pulse !== '' && pulse !== undefined && pulse !== null) {
    const p = Number(pulse);
    if (!Number.isInteger(p) || p < 30 || p > 220) return 'Пульс: от 30 до 220';
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

// Экспорт в CSV для врача или для себя. Дата в ISO, разделитель запятая.
export function toCsv(readings) {
  const header = 'дата,верхнее,нижнее,пульс,категория';
  const rows = sortNewestFirst(readings).map((r) => {
    const pulse = r.pulse ?? '';
    return [
      new Date(r.takenAt).toISOString(),
      r.systolic,
      r.diastolic,
      pulse,
      CATEGORY_LABELS[classify(r.systolic, r.diastolic)],
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

export function makeReading({ systolic, diastolic, pulse }, now = Date.now()) {
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    takenAt: now,
    systolic: Number(systolic),
    diastolic: Number(diastolic),
    pulse: pulse === '' || pulse === undefined || pulse === null ? null : Number(pulse),
  };
}
