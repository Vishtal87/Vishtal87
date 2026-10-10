// Платные функции. Покупок пока нет: флаг Pro хранится на телефоне.
// Настоящая оплата подключается отдельным шагом через магазины приложений.
export const PRO_FEATURES = Object.freeze({
  pdfReport: 'pdfReport',
  unlimitedReminders: 'unlimitedReminders',
  backup: 'backup',
  intakeLog: 'intakeLog',
  healthSync: 'healthSync',
});

// Бесплатно можно одно лекарство с напоминанием.
export const FREE_REMINDER_LIMIT = 1;

export function isUnlocked(feature, isPro) {
  // Журнал приёма и все остальные функции из списка доступны только с Pro.
  return Boolean(isPro) || !Object.values(PRO_FEATURES).includes(feature);
}

export function reminderAllowed(activeReminderCount, isPro) {
  return Boolean(isPro) || activeReminderCount < FREE_REMINDER_LIMIT;
}
