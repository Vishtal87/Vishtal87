// Локальный статус Pro. Хранится на телефоне в формате { active, checkedAt }.
// checkedAt — время последней успешной проверки в магазине. Без новой проверки статус
// действует не дольше PRO_GRACE_MS: иначе отменённая или истёкшая подписка держалась бы офлайн бесконечно.
const DAY = 24 * 60 * 60 * 1000;
export const PRO_GRACE_MS = 7 * DAY;
const CLOCK_SLACK_MS = DAY;

// Разбор сохранённого значения. Старый формат 'true' / 'false' считаем непроверенным.
export function decodeProState(raw) {
  if (raw === null || raw === undefined) return { active: false, checkedAt: 0 };
  if (raw === 'true' || raw === 'false') return { active: raw === 'true', checkedAt: 0 };
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.active === 'boolean' && Number.isFinite(o.checkedAt)) return { active: o.active, checkedAt: o.checkedAt };
  } catch (e) {
    // Повреждённое значение: считаем, что подписки нет, пока магазин не подтвердит обратное.
  }
  return { active: false, checkedAt: 0 };
}

export function encodeProState(state) {
  return JSON.stringify({ active: state.active, checkedAt: state.checkedAt });
}

// Действует ли Pro сейчас. ttl = Infinity отключает срок (для тестовых сборок).
export function isProNow(state, now = Date.now(), ttl = PRO_GRACE_MS) {
  if (!state.active) return false;
  if (state.checkedAt > now + CLOCK_SLACK_MS) return false; // дата проверки в будущем: часы сбиты, не доверяем
  return now - state.checkedAt <= ttl;
}

// Результат проверки магазина: 'active', 'inactive' или 'unknown' (сеть, магазин недоступен).
// 'unknown' не меняет сохранённый статус и не продлевает срок.
export function nextProState(prev, check, now = Date.now()) {
  if (check === 'unknown') return prev;
  return { active: check === 'active', checkedAt: now };
}
