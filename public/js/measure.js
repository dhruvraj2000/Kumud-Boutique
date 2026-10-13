// Made-to-measure form pieces shared by the account page and checkout. Inputs are named m_<key> so server field errors map onto them.
import { html } from './core.js';

export const FIELDS = [
  ['bust', 'Bust', 'Around the fullest part, tape level', true],
  ['waist', 'Waist', 'Around your natural waist', true],
  ['hip', 'Hip', 'Around the fullest part of the hips', true],
  ['shoulder', 'Shoulder', 'Across the back, tip to tip'],
  ['blouseLength', 'Blouse length', 'Shoulder to where the choli ends'],
  ['skirtLength', 'Skirt length', 'Waist to floor, in your heels'],
  ['height', 'Height', 'Standing, without shoes']
];

// line positions on the figure (viewBox 0 0 120 260) for each measurement
const GUIDE = { bust: 'M30 78h60', waist: 'M36 104h48', hip: 'M28 134h64', shoulder: 'M26 56h68', blouseLength: 'M98 56v40', skirtLength: 'M102 104v138', height: 'M112 14v232' };

const figure = () => html`<svg class="m-figure" viewBox="0 0 120 260" aria-hidden="true">
  <path class="m-body" d="M60 14c7 0 11 6 11 13s-4 12-11 12-11-5-11-12 4-13 11-13zM50 42c-12 3-24 8-24 16 0 10 6 18 6 28 0 8-2 14-2 18 0 4 6 10 6 14-6 10-10 22-10 34l-8 80h20l8-62 8 62h12l8-62 8 62h20l-8-80c0-12-4-24-10-34 0-4 6-10 6-14 0-4-2-10-2-18 0-10 6-18 6-28 0-8-12-13-24-16"/>
  ${Object.entries(GUIDE).map(([k, d]) => html`<path class="m-line" data-m="${k}" d="${d}"/>`)}
</svg>`;

export const measureFields = (m = {}, { forWhom = true } = {}) => html`<div class="mfit">
  <div class="mfit-art">${figure()}<p>All measurements in <b>inches</b>. Measure over light clothing; keep the tape snug, not tight.</p></div>
  <div class="mfit-fields">
    ${forWhom ? html`<div class="field"><label for="m_forWhom">Who is this for? <small>(optional)</small></label><input id="m_forWhom" name="m_forWhom" maxlength="40" placeholder="Me, my daughter…" value="${m.forWhom || ''}"></div>` : ''}
    <div class="m-grid">${FIELDS.map(([k, l, hint, req]) => html`<div class="field m-field" data-m="${k}"><label for="m_${k}">${l}${req ? '' : html` <small>(optional)</small>`}</label>
      <div class="m-input"><input id="m_${k}" name="m_${k}" type="number" inputmode="decimal" step="0.25" min="8" max="84" value="${m[k] ?? ''}" ${req ? 'required' : ''}><span>in</span></div><small class="hint">${hint}</small></div>`)}</div>
    <div class="field"><label for="m_notes">Fit notes <small>(optional)</small></label><textarea id="m_notes" name="m_notes" rows="2" maxlength="300" placeholder="e.g. prefer a looser choli, blouse with padding…">${m.notes || ''}</textarea></div>
  </div></div>`;

export function readMeasureForm(d) {
  const out = {};
  for (const [k] of FIELDS) if (d['m_' + k] !== undefined && d['m_' + k] !== '') out[k] = Number(d['m_' + k]);
  if (d.m_notes) out.notes = d.m_notes;
  if (d.m_forWhom) out.forWhom = d.m_forWhom;
  return out;
}

/** Highlight the matching guide line on the figure while a field is focused. */
export function bindFigure(root) {
  root.addEventListener('focusin', e => { const f = e.target.closest('.m-field'); if (!f) return; root.querySelectorAll('.m-line').forEach(l => l.classList.toggle('on', l.dataset.m === f.dataset.m)); });
  root.addEventListener('focusout', () => root.querySelectorAll('.m-line.on').forEach(l => l.classList.remove('on')));
}
