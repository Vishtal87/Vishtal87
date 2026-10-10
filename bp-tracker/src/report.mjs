// HTML-отчёт для врача: период, средние, таблица измерений, приём лекарств. Без рекомендаций.
import { TYPES, formatValue, unitLabel, sortNewestFirst } from './measurements.mjs';
import { summary, dateKey } from './intake.mjs';
import { translate } from './i18n.mjs';
import { classify } from './bp.mjs';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function average(list, pick) {
  if (list.length === 0) return null;
  return Math.round((list.reduce((a, r) => a + pick(r), 0) / list.length) * 10) / 10;
}

export function buildReportHtml({ records, meds, intake, units = {}, lang = 'ru', fromMs, toMs, dateFmt }) {
  const t = (k, v) => translate(lang, k, v);
  const inRange = sortNewestFirst(records).filter((r) => r.takenAt >= fromMs && r.takenAt <= toMs);
  const bp = inRange.filter((r) => r.type === TYPES.bp);
  const glucose = inRange.filter((r) => r.type === TYPES.glucose);
  const weight = inRange.filter((r) => r.type === TYPES.weight);
  // Ключи дат в локальном времени, как у отметок приёма. Иначе в часовых поясах не UTC будет сдвиг на день.
  const fromKey = dateKey(fromMs);
  const toKey = dateKey(toMs);

  const bpAvg = bp.length
    ? `${Math.round(average(bp, (r) => r.values.systolic))}/${Math.round(average(bp, (r) => r.values.diastolic))}`
    : '—';
  const counts = {};
  for (const r of bp) {
    const c = classify(r.values.systolic, r.values.diastolic);
    counts[c] = (counts[c] || 0) + 1;
  }
  const catRows = Object.entries(counts)
    .map(([c, n]) => `<li>${esc(t(`cat_${c}`))}: ${n}</li>`)
    .join('');

  const rows = inRange
    .map((r) => {
      const cat = r.type === TYPES.bp ? esc(t(`cat_${classify(r.values.systolic, r.values.diastolic)}`)) : '';
      const ctx = r.type === TYPES.glucose ? esc(t(`ctx_${r.values.context}`)) : '';
      return `<tr><td>${esc(dateFmt(r.takenAt))}</td><td>${esc(t(`type_${r.type}`))}</td><td>${esc(formatValue(r, units))} ${esc(unitLabel(r.type, units, lang))}</td><td>${ctx}${cat}</td></tr>`;
    })
    .join('');

  const medRows = meds
    .map((m) => {
      const s = summary(intake, m.id, fromKey, toKey);
      return `<tr><td>${esc(m.name)}</td><td>${esc(m.times.join(', '))}</td><td>${s.taken}</td><td>${s.missed}</td></tr>`;
    })
    .join('');

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
body{font-family:sans-serif;color:#1c1917;padding:24px;font-size:13px}
h1{font-size:20px}h2{font-size:15px;margin-top:20px}
table{width:100%;border-collapse:collapse;margin-top:6px}
td,th{border-bottom:1px solid #e7e5e4;padding:6px;text-align:left}
.note{color:#57534e;font-size:11px;margin-top:20px}
</style></head><body>
<h1>${esc(t('appTitle'))}</h1>
<p>${esc(dateFmt(fromMs))} — ${esc(dateFmt(toMs))}</p>
<h2>${esc(t('reportAverage'))}</h2>
<p>${esc(t('type_bp'))}: <b>${esc(bpAvg)}</b> ${esc(unitLabel(TYPES.bp, units, lang))} · ${esc(t('records'))}: ${bp.length}</p>
<p>${esc(t('type_glucose'))}: ${glucose.length} · ${esc(t('type_weight'))}: ${weight.length}</p>
<ul>${catRows}</ul>
<h2>${esc(t('reportMeasurements'))}</h2>
<table><tr><th>${esc(t('reportDate'))}</th><th>${esc(t('reportType'))}</th><th>${esc(t('reportValue'))}</th><th>${esc(t('reportNote'))}</th></tr>${rows || `<tr><td colspan="4">${esc(t('reportEmpty'))}</td></tr>`}</table>
<h2>${esc(t('reportMedicines'))}</h2>
<table><tr><th>${esc(t('medName'))}</th><th>${esc(t('reportTimes'))}</th><th>${esc(t('reportTaken'))}</th><th>${esc(t('reportMissed'))}</th></tr>${medRows || `<tr><td colspan="4">${esc(t('medEmpty'))}</td></tr>`}</table>
<p class="note">${esc(t('disclaimer'))}</p>
</body></html>`;
}
