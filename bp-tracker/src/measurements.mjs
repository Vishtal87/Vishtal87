import { translate } from './i18n.mjs';
// Типы измерений. Приложение только записывает и показывает данные, рекомендаций не даёт.
// Все значения хранятся в канонических единицах: сахар в ммоль/л, вес в кг.
export const MMOL_TO_MGDL = 18.0156;
export const LB_PER_KG = 2.20462;

export const TYPES = Object.freeze({
  bp: 'bp',
  glucose: 'glucose',
  weight: 'weight',
});

// Контекст измерения сахара: без него значение сравнивать нельзя.
export const GLUCOSE_CONTEXTS = Object.freeze(['fasting', 'beforeMeal', 'afterMeal', 'bedtime', 'other']);

// Перевод единиц из того, что ввёл пользователь, в канонические.
export function toCanonical(type, value, unit) {
  if (type === TYPES.glucose && unit === 'mgdl') return value / MMOL_TO_MGDL;
  if (type === TYPES.weight && unit === 'lb') return value / LB_PER_KG;
  return value;
}

// Проверка ввода. Возвращает { error, values }: error — ключ перевода или null.
export function validateMeasurement(type, input, units = {}) {
  if (type === TYPES.bp) {
    const s = Number(input.systolic);
    const d = Number(input.diastolic);
    const p = input.pulse === '' || input.pulse === undefined || input.pulse === null ? null : Number(input.pulse);
    if (!Number.isInteger(s) || s < 60 || s > 260) return { error: 'err_systolic', values: null };
    if (!Number.isInteger(d) || d < 30 || d > 160) return { error: 'err_diastolic', values: null };
    if (d >= s) return { error: 'err_order', values: null };
    if (p !== null && (!Number.isInteger(p) || p < 30 || p > 220)) return { error: 'err_pulse', values: null };
    return { error: null, values: { systolic: s, diastolic: d, pulse: p } };
  }

  if (type === TYPES.glucose) {
    const raw = Number(String(input.value).replace(',', '.'));
    if (!Number.isFinite(raw) || raw <= 0) return { error: 'err_glucose', values: null };
    const mmol = toCanonical(type, raw, units.glucose ?? 'mmol');
    if (mmol < 1 || mmol > 45) return { error: 'err_glucose', values: null };
    const context = GLUCOSE_CONTEXTS.includes(input.context) ? input.context : 'other';
    return { error: null, values: { value: Math.round(mmol * 10) / 10, context } };
  }

  if (type === TYPES.weight) {
    const raw = Number(String(input.value).replace(',', '.'));
    if (!Number.isFinite(raw) || raw <= 0) return { error: 'err_weight', values: null };
    const kg = toCanonical(type, raw, units.weight ?? 'kg');
    if (kg < 20 || kg > 300) return { error: 'err_weight', values: null };
    return { error: null, values: { value: Math.round(kg * 10) / 10 } };
  }

  return { error: 'err_type', values: null };
}

// Запись в едином формате.
export function makeRecord(type, values, takenAt = Date.now()) {
  return {
    id: `${takenAt}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    takenAt,
    values,
  };
}

// Старые записи давления (без поля type) переводим в новый формат. Идентификаторы сохраняем.
export function migrateRecords(list) {
  return list.map((r) => {
    if (r.type) return r;
    return {
      id: r.id,
      type: TYPES.bp,
      takenAt: r.takenAt,
      values: { systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse ?? null },
    };
  });
}

// Значение для показа: 120/80, 5.6 ммоль/л, 72.5 кг. Единицы учитываются через настройки.
export function formatValue(record, units = {}) {
  const v = record.values;
  if (record.type === TYPES.bp) return `${v.systolic}/${v.diastolic}`;
  if (record.type === TYPES.glucose) {
    if (units.glucose === 'mgdl') return `${Math.round(v.value * MMOL_TO_MGDL)}`;
    return v.value.toFixed(1);
  }
  if (record.type === TYPES.weight) {
    if (units.weight === 'lb') return (v.value * LB_PER_KG).toFixed(1);
    return v.value.toFixed(1);
  }
  return '';
}

export function unitLabel(type, units = {}, lang = 'ru') {
  if (type === TYPES.bp) return translate(lang, 'unit_mmhg');
  if (type === TYPES.glucose) return translate(lang, units.glucose === 'mgdl' ? 'unit_mgdl' : 'unit_mmol');
  if (type === TYPES.weight) return translate(lang, units.weight === 'lb' ? 'unit_lb' : 'unit_kg');
  return '';
}

// Фильтр и сортировка по типу.
export function ofType(records, type) {
  return records.filter((r) => r.type === type);
}

export function sortNewestFirst(records) {
  return [...records].sort((a, b) => b.takenAt - a.takenAt);
}

// Экспорт всех записей в CSV. Категория давления — информационная, по таблице AHA.
export function toCsvRecords(records, lang, units = {}, classifyBp) {
  const names = {
    date: lang === 'ru' ? 'дата' : 'date',
    type: lang === 'ru' ? 'тип' : 'type',
    value: lang === 'ru' ? 'значение' : 'value',
    unit: lang === 'ru' ? 'единица' : 'unit',
    context: lang === 'ru' ? 'условие' : 'context',
    category: lang === 'ru' ? 'категория' : 'category',
  };
  const header = Object.values(names).join(',');
  const rows = sortNewestFirst(records).map((r) => {
    const value = formatValue(r, units);
    const ctx = r.type === TYPES.glucose ? r.values.context : '';
    const cat = r.type === TYPES.bp && classifyBp ? translate(lang, `cat_${classifyBp(r.values.systolic, r.values.diastolic)}`) : '';
    return [new Date(r.takenAt).toISOString(), r.type, value, unitLabel(r.type, units, lang), ctx, cat].join(',');
  });
  return [header, ...rows].join('\n');
}
