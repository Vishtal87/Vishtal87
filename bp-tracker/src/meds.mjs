// Лекарства и время приёма. Приложение только хранит расписание, которое задал пользователь.
// Дозы и рекомендации не указываются.
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// times: строка «08:00, 20:00». Возвращает { error, name, times }.
export function validateMed({ name, times }) {
  const cleanName = (name ?? '').trim();
  if (cleanName === '') return { error: 'err_med_name', name: null, times: null };
  if (cleanName.length > 60) return { error: 'err_med_name', name: null, times: null };
  const parts = String(times ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { error: 'err_med_times', name: null, times: null };
  const normalized = [];
  for (const p of parts) {
    const m = p.match(TIME_RE);
    if (!m) return { error: 'err_med_times', name: null, times: null };
    normalized.push(`${m[1].padStart(2, '0')}:${m[2]}`);
  }
  const unique = [...new Set(normalized)].sort();
  return { error: null, name: cleanName, times: unique };
}

export function makeMed({ name, times }, now = Date.now()) {
  return { id: `med-${now}-${Math.random().toString(36).slice(2, 8)}`, name, times };
}
