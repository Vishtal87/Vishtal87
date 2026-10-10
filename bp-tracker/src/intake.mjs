// Журнал приёма лекарств: пользователь сам отмечает «принял» или «пропустил».
// Рекомендаций по дозам нет, это только учёт того, что отметил пользователь.
export const INTAKE_STATUS = Object.freeze({ TAKEN: 'taken', MISSED: 'missed' });

export function dateKey(ms) {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Отметка на конкретное время приёма одного лекарства в один день.
export function setIntake(list, { medId, date, time, status }, id = `intake-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`) {
  const rest = list.filter((r) => !(r.medId === medId && r.date === date && r.time === time));
  return [...rest, { id, medId, date, time, status }];
}

export function statusFor(list, medId, date, time) {
  return list.find((r) => r.medId === medId && r.date === date && r.time === time)?.status ?? null;
}

// Сводка за период: сколько отмечено «принял» и «пропустил». Невыбранные времена не считаются.
export function summary(list, medId, fromKey, toKey) {
  const inRange = list.filter((r) => r.medId === medId && r.date >= fromKey && r.date <= toKey);
  const taken = inRange.filter((r) => r.status === INTAKE_STATUS.TAKEN).length;
  const missed = inRange.filter((r) => r.status === INTAKE_STATUS.MISSED).length;
  return { taken, missed, total: taken + missed };
}

// Повторное нажатие на ту же отметку снимает её. Другая отметка заменяет прежнюю.
export function toggleIntake(list, { medId, date, time, status }, id) {
  if (statusFor(list, medId, date, time) === status) {
    return list.filter((r) => !(r.medId === medId && r.date === date && r.time === time));
  }
  return setIntake(list, { medId, date, time, status }, id);
}
