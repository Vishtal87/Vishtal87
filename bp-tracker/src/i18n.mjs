// Тексты интерфейса. Каждый ключ должен быть в обоих языках (проверяет тест).
export const LANGUAGES = ['ru', 'en'];

const STRINGS = {
  ru: {
    appTitle: 'Дневник давления',
    tabInput: 'Ввод',
    tabHistory: 'История',
    tabCharts: 'Графики',
    disclaimer: 'Приложение показывает категорию по таблице AHA и не ставит диагноз. По лечению обращайтесь к врачу.',
    firstHint: 'Введите первое измерение ниже',
    lastReading: 'Последнее измерение',
    newReading: 'Новое измерение',
    systolic: 'Верхнее',
    diastolic: 'Нижнее',
    pulse: 'Пульс',
    dateLabel: 'Дата и время (необязательно)',
    save: 'Сохранить',
    weekAverage: 'Среднее за 7 дней',
    noWeek: 'Нет записей за неделю',
    records: 'записей',
    historyEmpty: 'Записей пока нет',
    deleteHint: 'Долгое нажатие — удалить запись',
    deleteTitle: 'Удалить запись?',
    cancel: 'Отмена',
    delete: 'Удалить',
    exportTitle: 'Экспорт',
    exportHint: 'CSV для врача или для себя',
    share: 'Поделиться CSV',
    chartEmpty: 'Графики появятся после первых записей',
    chartTitle: 'Последние {n} измерений',
    chartHint: 'Столбик — от нижнего до верхнего давления',
    pulseShort: 'пульс {v}',
    cat_normal: 'Нормальное',
    cat_elevated: 'Повышенное',
    cat_stage1: 'Гипертензия 1 степени',
    cat_stage2: 'Гипертензия 2 степени',
    cat_crisis: 'Высокое, обратитесь к врачу',
    err_systolic: 'Верхнее давление: от 60 до 260',
    err_diastolic: 'Нижнее давление: от 30 до 160',
    err_order: 'Нижнее давление должно быть меньше верхнего',
    err_pulse: 'Пульс: от 30 до 220',
    err_date_format: 'Дата: дд.мм.гггг или дд.мм.гггг чч:мм',
    err_date_invalid: 'Такой даты не существует',
    err_date_future: 'Дата не может быть в будущем',
    csv_date: 'дата',
    csv_systolic: 'верхнее',
    csv_diastolic: 'нижнее',
    csv_pulse: 'пульс',
    csv_category: 'категория',
    shareTitle: 'Дневник давления',
    langSwitch: 'Язык',
  },
  en: {
    appTitle: 'Blood Pressure Diary',
    tabInput: 'Log',
    tabHistory: 'History',
    tabCharts: 'Charts',
    disclaimer: 'The app shows a category based on the AHA 2017 guideline and does not diagnose. For treatment, consult a doctor.',
    firstHint: 'Add your first reading below',
    lastReading: 'Latest reading',
    newReading: 'New reading',
    systolic: 'Systolic',
    diastolic: 'Diastolic',
    pulse: 'Pulse',
    dateLabel: 'Date and time (optional)',
    save: 'Save',
    weekAverage: '7-day average',
    noWeek: 'No readings this week',
    records: 'readings',
    historyEmpty: 'No readings yet',
    deleteHint: 'Long-press a reading to delete it',
    deleteTitle: 'Delete this reading?',
    cancel: 'Cancel',
    delete: 'Delete',
    exportTitle: 'Export',
    exportHint: 'CSV for your doctor or yourself',
    share: 'Share CSV',
    chartEmpty: 'Charts appear after your first readings',
    chartTitle: 'Last {n} readings',
    chartHint: 'Each bar runs from diastolic to systolic',
    pulseShort: 'pulse {v}',
    cat_normal: 'Normal',
    cat_elevated: 'Elevated',
    cat_stage1: 'Hypertension stage 1',
    cat_stage2: 'Hypertension stage 2',
    cat_crisis: 'High, see a doctor',
    err_systolic: 'Systolic: 60 to 260',
    err_diastolic: 'Diastolic: 30 to 160',
    err_order: 'Diastolic must be lower than systolic',
    err_pulse: 'Pulse: 30 to 220',
    err_date_format: 'Date: dd.mm.yyyy or dd.mm.yyyy hh:mm',
    err_date_invalid: 'This date does not exist',
    err_date_future: 'The date cannot be in the future',
    csv_date: 'date',
    csv_systolic: 'systolic',
    csv_diastolic: 'diastolic',
    csv_pulse: 'pulse',
    csv_category: 'category',
    shareTitle: 'Blood Pressure Diary',
    langSwitch: 'Language',
  },
};

// Перевод с подстановкой {имя}. Нет ключа в языке — берём английский, затем сам ключ.
export function translate(lang, key, vars = {}) {
  const text = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? '').toString());
}

export function localeTag(lang) {
  return lang === 'ru' ? 'ru-RU' : 'en-US';
}

// Язык по умолчанию: русский, если телефон на русском, иначе английский.
export function detectLanguage(systemLocale) {
  return String(systemLocale ?? '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export { STRINGS };
