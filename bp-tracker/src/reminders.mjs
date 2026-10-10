// Напоминания о приёме: только по времени, которое задал пользователь. Дозы не указываются.
import { reminderAllowed } from './entitlements.mjs';

// Сколько лекарств с напоминаниями уже заведено.
export function activeReminderCount(meds) {
  return meds.filter((m) => m.times.length > 0).length;
}

// Можно ли добавить лекарство с напоминанием. Без Pro — только одно.
export function canAddReminder(meds, isPro) {
  return reminderAllowed(activeReminderCount(meds), isPro);
}

// Плоский список «лекарство + время» для планирования уведомлений. Сортировка по времени суток.
export function reminderSlots(meds) {
  const slots = [];
  for (const m of meds) {
    for (const time of m.times) {
      const [h, min] = time.split(':').map(Number);
      slots.push({ key: `${m.id}-${time}`, medId: m.id, name: m.name, time, hour: h, minute: min });
    }
  }
  return slots.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute) || a.name.localeCompare(b.name));
}
