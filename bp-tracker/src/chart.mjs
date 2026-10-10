// Данные для графиков. Давление рисуется диапазоном «нижнее–верхнее», сахар и вес — одним значением.
import { TYPES } from './measurements.mjs';

// Последние точки по возрастанию даты. low/high — нижняя и верхняя границы столбика.
export function chartPoints(records, type, limit) {
  return records
    .filter((r) => r.type === type)
    .sort((a, b) => a.takenAt - b.takenAt)
    .slice(-limit)
    .map((r) => {
      if (type === TYPES.bp) return { id: r.id, takenAt: r.takenAt, low: r.values.diastolic, high: r.values.systolic };
      return { id: r.id, takenAt: r.takenAt, low: r.values.value, high: r.values.value };
    });
}

// Шкала по данным с отступом, чтобы столбики не упирались в край. fixed — заданные пределы (для давления).
export function scaleRange(points, fixed) {
  if (fixed) return fixed;
  if (points.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...points.map((p) => p.low));
  const max = Math.max(...points.map((p) => p.high));
  const pad = Math.max((max - min) * 0.15, 0.5);
  return { min: Math.max(0, min - pad), max: max + pad };
}
