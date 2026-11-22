// Tiempos: un cronómetro por persona (hasta 100) y uno general.
// El tiempo se calcula con marcas de reloj (Date.now), nunca contando ticks:
// cada cronómetro guarda lo acumulado (acc) y el instante en que arrancó (start).

const MAX = 100;
const K_SESSION = 'tiempos.sesion.v1';
const K_LISTS = 'tiempos.listas.v1';

const $ = (s, r = document) => r.querySelector(s);
const now = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 10) + now().toString(36).slice(-4);
const elapsed = (t) => t.acc + (t.start ? now() - t.start : 0);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ---------- estado ----------
let S = loadSession();
let lists = [];            // listas visibles (locales o de la cuenta)
let listsSource = 'local'; // 'local' | 'cloud'
let cloud = null;          // módulo nube.js si Firebase está configurado
let user = null;
let editMode = false;
let filterText = '';

function blankSession() {
  return {
    listId: null, listName: null, dirty: false, seq: 0, people: [],
    general: { acc: 0, start: null, laps: [], limit: 10 * 60000 },
    mode: 'up',          // 'up' = cronómetro, 'down' = cuenta regresiva
    limit: 5 * 60000,    // tiempo de cada persona en cuenta regresiva
    alarm: true,         // sonar y vibrar al llegar a cero
  };
}
function loadSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(K_SESSION));
    if (raw && Array.isArray(raw.people)) {
      const b = blankSession();
      return { ...b, ...raw, general: { ...b.general, ...(raw.general || {}) } };
    }
  } catch {}
  return blankSession();
}
function saveSession() {
  try { localStorage.setItem(K_SESSION, JSON.stringify(S)); } catch {}
}
function loadLocalLists() {
  try { const l = JSON.parse(localStorage.getItem(K_LISTS)); return Array.isArray(l) ? l : []; } catch { return []; }
}
function saveLocalLists(l) {
  try { localStorage.setItem(K_LISTS, JSON.stringify(l)); } catch {}
}

// ---------- formato ----------
function fmt(ms) {
  const tenths = Math.floor(ms / 100);
  const d = tenths % 10;
  const totalS = Math.floor(tenths / 10);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}.${d}` : `${p(m)}:${p(s)}.${d}`;
}
// Cuenta regresiva: lo que queda, redondeado hacia arriba (llega justo a 00:00.0);
// pasado el cero muestra el exceso con signo menos.
function fmtLeft(rem) {
  if (rem > 0) return fmt(Math.ceil(rem / 100) * 100);
  return rem === 0 ? fmt(0) : '−' + fmt(-rem);
}
function fmtShort(ms) {
  const s = Math.round(ms / 1000), p = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}
const isDown = () => S.mode === 'down';
const limitOf = (t) => (t === S.general ? S.general.limit : S.limit);
const shown = (t) => (isDown() ? fmtLeft(limitOf(t) - elapsed(t)) : fmt(elapsed(t)));
const isOver = (t) => isDown() && elapsed(t) >= limitOf(t);
function fmtCsv(ms) {
  const cs = Math.floor(ms / 10);
  const p = (n) => String(n).padStart(2, '0');
  const totalS = Math.floor(cs / 100);
  return `${Math.floor(totalS / 3600)}:${p(Math.floor(totalS / 60) % 60)}:${p(totalS % 60)}.${p(cs % 100)}`;
}

// ---------- personas ----------
// Acepta nombres o {name, ms} (al cargar un archivo exportado con tiempos, quedan en pausa).
function addPeople(items) {
  const room = MAX - S.people.length;
  const take = items.slice(0, Math.max(0, room));
  for (const it of take) {
    const name = typeof it === 'string' ? it : it.name;
    const ms = typeof it === 'object' && Number.isFinite(it.ms) && it.ms > 0 ? Math.round(it.ms) : 0;
    S.people.push({ id: uid(), name, seq: S.seq++, acc: ms, start: null });
  }
  syncAlerted();
  if (take.length) markDirty();
  return { added: take.length, skipped: items.length - take.length };
}

// ---------- aviso al llegar a cero ----------
const alerted = new Set(); // ids (y 'g' para el general) que ya pasaron el cero
function syncAlerted() {
  alerted.clear();
  for (const p of S.people) if (isOver(p)) alerted.add(p.id);
  if (isOver(S.general)) alerted.add('g');
}
let audio = null;
function ensureAudio() {
  // El navegador del celular solo deja crear sonido después de un toque del usuario.
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {}
}
function ring() {
  if (!S.alarm) return;
  try { navigator.vibrate?.([180, 90, 180]); } catch {}
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  [0, 0.22].forEach((d) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
    o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.2);
  });
}
document.addEventListener('pointerdown', ensureAudio, { passive: true });
function markDirty() { S.dirty = true; }

function toggle(p) {
  if (p.start) { p.acc += now() - p.start; p.start = null; }
  else p.start = now();
}

// ---------- filas ----------
const rowsEl = $('#rows');
const rowMap = new Map(); // id -> { li, t, go, last }

function icon(id) { return `<svg class="ic"><use href="#${id}"/></svg>`; }
function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderRows() {
  rowMap.clear();
  const f = norm(filterText);
  const html = S.people.map((p, i) => {
    const hide = f && !norm(p.name).includes(f);
    const on = !!p.start, ms = elapsed(p);
    const cls = ['row', on && 'on', !on && ms === 0 && 'zero', isOver(p) && 'over'].filter(Boolean).join(' ');
    const name = editMode
      ? `<input class="name-in" value="${esc(p.name)}" maxlength="60" aria-label="Nombre">`
      : `<span class="name" data-act="toggle">${esc(p.name)}</span>`;
    const side = editMode
      ? `<button class="rb del" data-act="del" aria-label="Quitar a ${esc(p.name)}">${icon('i-x')}</button>`
      : `<button class="rb" data-act="reset" aria-label="Reiniciar a ${esc(p.name)}">${icon('i-reset')}</button>`;
    return `<li class="${cls}" data-id="${p.id}"${hide ? ' hidden' : ''}>
      <span class="n">${i + 1}</span>${name}
      <span class="t" data-act="toggle">${shown(p)}</span>${side}
      <button class="rb go" data-act="toggle" aria-label="${on ? 'Pausar' : 'Iniciar'} a ${esc(p.name)}">${icon(on ? 'i-pause' : 'i-play')}</button>
    </li>`;
  }).join('');
  rowsEl.innerHTML = html;
  rowsEl.classList.toggle('multi', S.people.length > 16);
  for (const li of rowsEl.children) {
    rowMap.set(li.dataset.id, { li, t: li.querySelector('.t'), last: '' });
  }
  renderChrome();
}

function renderRow(p) {
  const r = rowMap.get(p.id);
  if (!r) return;
  const on = !!p.start, ms = elapsed(p);
  r.li.classList.toggle('on', on);
  r.li.classList.toggle('zero', !on && ms === 0);
  r.li.classList.toggle('over', isOver(p));
  const go = r.li.querySelector('.go');
  go.innerHTML = icon(on ? 'i-pause' : 'i-play');
  go.setAttribute('aria-label', `${on ? 'Pausar' : 'Iniciar'} a ${p.name}`);
  r.t.textContent = r.last = shown(p);
}

function renderChrome() {
  const n = S.people.length;
  const running = S.people.filter((p) => p.start).length;
  $('#empty').hidden = n > 0;
  $('#subbar').hidden = n === 0;
  $('#emptyLists').hidden = lists.length === 0;
  $('#count').textContent = `${n} de ${MAX}`;
  $('#gMeta').textContent = n ? `${running ? running + ' corriendo · ' : ''}${n} ${n === 1 ? 'persona' : 'personas'}` : '';
  $('#allStart').disabled = $('#allPause').disabled = $('#allReset').disabled = n === 0;
  $('#btnSort').disabled = $('#btnExport').disabled = n === 0;
  $('#modeLabel').textContent = isDown() ? `Regresiva ${fmtShort(S.limit)}` : 'Cronómetro';
  $('#btnMode').classList.toggle('is-down', isDown());
  $('#listLabel').textContent = S.listName || (n ? 'Lista sin guardar' : 'Sin lista');
  $('#dirtyMark').hidden = !(S.listId && S.dirty);
  $('#addInput').disabled = n >= MAX;
  $('#addInput').placeholder = n >= MAX ? 'Llegaste a 100 personas' : 'Agregar persona';
  $('#btnEdit').setAttribute('aria-pressed', String(editMode));
  $('#clearAll').hidden = !editMode;
  renderGeneral();
}

// ---------- general ----------
const gEl = $('#general'), gTime = $('#gTime');
let gLast = '', titleLast = '';
function renderGeneral() {
  const g = S.general, on = !!g.start;
  gEl.classList.toggle('on', on);
  gEl.classList.toggle('over', isOver(g));
  $('#gLabel').textContent = isDown() ? `General · de ${fmtShort(g.limit)}` : 'General';
  $('#gToggle').innerHTML = `${icon(on ? 'i-pause' : 'i-play')}<span>${on ? 'Pausar' : (g.acc ? 'Seguir' : 'Iniciar')}</span>`;
  $('#gToggle').setAttribute('aria-label', on ? 'Pausar general' : 'Iniciar general');
  $('#gLap').disabled = !on;
  gTime.textContent = gLast = shown(g);
  const laps = $('#laps');
  laps.hidden = g.laps.length === 0;
  laps.innerHTML = g.laps.map((ms, i) => {
    const prev = i ? g.laps[i - 1] : 0;
    return `<li><b>P${i + 1}</b>${fmt(ms)} <span style="color:var(--muted)">+${fmt(ms - prev)}</span></li>`;
  }).reverse().join('');
}

// ---------- bucle de dibujo (solo pinta; el tiempo sale del reloj) ----------
function frame() {
  const g = S.general;
  const gs = shown(g);
  if (gs !== gLast) { gTime.textContent = gLast = gs; }
  if (g.start && isOver(g) && !alerted.has('g')) {
    alerted.add('g'); gEl.classList.add('over'); ring();
  }
  for (const p of S.people) {
    if (!p.start) continue;
    const r = rowMap.get(p.id);
    if (!r) continue;
    const s = shown(p);
    if (s !== r.last) { r.t.textContent = r.last = s; }
    if (isDown() && !alerted.has(p.id) && isOver(p)) {
      alerted.add(p.id); r.li.classList.add('over', 'ring'); ring();
      setTimeout(() => r.li.classList.remove('ring'), 1800);
    }
  }
  const tt = g.start ? `${gs.slice(0, -2)} · Tiempos` : 'Tiempos';
  if (tt !== titleLast) document.title = titleLast = tt;
  requestAnimationFrame(frame);
}

// ---------- eventos de filas ----------
rowsEl.addEventListener('click', (e) => {
  const actEl = e.target.closest('[data-act]');
  if (!actEl) return;
  const li = actEl.closest('.row');
  const p = S.people.find((x) => x.id === li.dataset.id);
  if (!p) return;
  const act = actEl.dataset.act;
  if (act === 'toggle') { toggle(p); renderRow(p); renderChrome(); }
  else if (act === 'reset') { p.acc = 0; p.start = null; alerted.delete(p.id); renderRow(p); renderChrome(); }
  else if (act === 'del') {
    S.people = S.people.filter((x) => x !== p); markDirty(); renderRows();
  }
  saveSession();
});
rowsEl.addEventListener('change', (e) => {
  if (!e.target.classList.contains('name-in')) return;
  const p = S.people.find((x) => x.id === e.target.closest('.row').dataset.id);
  const v = e.target.value.trim();
  if (p && v && v !== p.name) { p.name = v; markDirty(); saveSession(); renderChrome(); }
  else if (p) e.target.value = p.name;
});

// ---------- herramientas ----------
$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#addInput');
  const v = inp.value.trim().slice(0, 60);
  if (!v) return;
  const r = addPeople([v]);
  if (!r.added) toast('Ya hay 100 personas.');
  inp.value = '';
  saveSession(); renderRows();
  const last = rowsEl.lastElementChild;
  if (last && window.innerWidth > 700) last.scrollIntoView({ block: 'nearest' });
});

$('#allStart').onclick = () => { const t = now(); S.people.forEach((p) => { if (!p.start) p.start = t; }); saveSession(); renderRows(); };
$('#allPause').onclick = () => { const t = now(); S.people.forEach((p) => { if (p.start) { p.acc += t - p.start; p.start = null; } }); saveSession(); renderRows(); };
$('#allReset').onclick = async () => {
  if (!S.people.some((p) => p.start || p.acc)) return;
  if (!(await confirmBox('¿Reiniciar los cronómetros de todas las personas? Se detienen y vuelven a cero.', 'Reiniciar'))) return;
  S.people.forEach((p) => { p.acc = 0; p.start = null; }); syncAlerted(); saveSession(); renderRows();
};

$('#btnEdit').onclick = () => { editMode = !editMode; renderRows(); };
$('#clearAll').onclick = async () => {
  if (!(await confirmBox(`¿Quitar a las ${S.people.length} personas de la pantalla? Las listas guardadas no cambian.`, 'Quitar'))) return;
  S.people = []; S.listId = null; S.listName = null; S.dirty = false; editMode = false;
  saveSession(); renderRows();
};

$('#filter').addEventListener('input', (e) => {
  filterText = e.target.value;
  const f = norm(filterText);
  for (const p of S.people) { const r = rowMap.get(p.id); if (r) r.li.hidden = !!f && !norm(p.name).includes(f); }
});

// orden
const sortMenu = $('#sortMenu'), btnSort = $('#btnSort');
btnSort.onclick = (e) => { e.stopPropagation(); const open = sortMenu.hidden; sortMenu.hidden = !open; btnSort.setAttribute('aria-expanded', String(open)); };
document.addEventListener('click', (e) => { if (!sortMenu.hidden && !sortMenu.contains(e.target)) { sortMenu.hidden = true; btnSort.setAttribute('aria-expanded', 'false'); } });
sortMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  const mode = b.dataset.sort;
  const coll = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const snap = new Map(S.people.map((p) => [p, elapsed(p)]));
  const by = {
    desc: (a, b) => snap.get(b) - snap.get(a),
    asc: (a, b) => snap.get(a) - snap.get(b),
    name: (a, b) => coll.compare(a.name, b.name),
    orig: (a, b) => a.seq - b.seq,
  }[mode];
  S.people.sort(by);
  sortMenu.hidden = true;
  saveSession(); renderRows();
  toast({ desc: 'Ordenado: más tiempo primero', asc: 'Ordenado: menos tiempo primero', name: 'Ordenado por nombre', orig: 'Orden de la lista' }[mode]);
});

// ---------- descargar (tiempos o solo la lista, en CSV o JSON) ----------
const stateOf = (t, ms) => (t.start ? 'corriendo' : (ms ? 'pausado' : 'sin iniciar'));
function fileBase(ext) {
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const base = (S.listName || 'tiempos').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'tiempos';
  return `${base}_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`;
}
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCell = (s) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const byList = () => [...S.people].sort((a, b) => a.seq - b.seq);

const exporters = {
  'times-csv'() {
    const down = isDown();
    const head = ['Posición', 'Nombre', 'Tiempo', 'Milisegundos', 'Estado'];
    if (down) head.push('Límite', 'Restante');
    const lines = [head.join(';')];
    const row = (pos, name, t) => {
      const ms = elapsed(t), cells = [pos, csvCell(name), fmtCsv(ms), ms, stateOf(t, ms)];
      if (down) { const lim = limitOf(t), rem = lim - ms; cells.push(fmtCsv(lim), (rem < 0 ? '-' : '') + fmtCsv(Math.abs(rem))); }
      return cells.join(';');
    };
    S.people.forEach((p, i) => lines.push(row(i + 1, p.name, p)));
    lines.push('', row('', 'General', S.general));
    S.general.laps.forEach((ms, i) => lines.push(['', `Parcial ${i + 1}`, fmtCsv(ms), ms, ''].join(';')));
    download(fileBase('csv'), '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  },
  'times-json'() {
    const item = (t) => { const ms = elapsed(t); return { tiempo: fmtCsv(ms), milisegundos: ms, estado: stateOf(t, ms) }; };
    const data = {
      app: 'Tiempos', version: 1, exportado: new Date().toISOString(),
      lista: S.listName || null, modo: isDown() ? 'regresiva' : 'cronometro',
      limite_persona_ms: S.limit, limite_general_ms: S.general.limit,
      personas: S.people.map((p, i) => ({ posicion: i + 1, nombre: p.name, ...item(p) })),
      general: { ...item(S.general), parciales_ms: S.general.laps },
    };
    download(fileBase('json'), JSON.stringify(data, null, 2), 'application/json');
  },
  'list-csv'() {
    download(fileBase('csv').replace('.csv', '_lista.csv'), '﻿' + ['Nombre', ...byList().map((p) => csvCell(p.name))].join('\r\n'), 'text/csv;charset=utf-8');
  },
  'list-json'() {
    download(fileBase('json').replace('.json', '_lista.json'),
      JSON.stringify({ app: 'Tiempos', lista: S.listName || null, personas: byList().map((p) => p.name) }, null, 2), 'application/json');
  },
};
const exportMenu = $('#exportMenu'), btnExport = $('#btnExport');
btnExport.onclick = (e) => { e.stopPropagation(); const open = exportMenu.hidden; exportMenu.hidden = !open; btnExport.setAttribute('aria-expanded', String(open)); };
document.addEventListener('click', (e) => { if (!exportMenu.hidden && !exportMenu.contains(e.target)) { exportMenu.hidden = true; btnExport.setAttribute('aria-expanded', 'false'); } });
exportMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp]'); if (!b) return;
  exportMenu.hidden = true;
  exporters[b.dataset.exp]();
  toast(b.dataset.exp.endsWith('json') ? 'JSON descargado' : 'CSV descargado');
});

// ---------- modo: cronómetro o cuenta regresiva ----------
const dlgMode = $('#dlgMode');
const splitMs = (ms) => { const s = Math.round(ms / 1000); return [Math.floor(s / 60), s % 60]; };
function openMode() {
  dlgMode.querySelector(`input[name=tmode][value=${S.mode}]`).checked = true;
  [[S.limit, 'p'], [S.general.limit, 'g']].forEach(([ms, k]) => {
    const [m, s] = splitMs(ms); $(`#${k}Min`).value = m; $(`#${k}Sec`).value = s;
  });
  $('#alarm').checked = S.alarm;
  syncModeForm();
  dlgMode.returnValue = '';
  dlgMode.showModal();
}
function syncModeForm() {
  $('#limits').classList.toggle('off', dlgMode.querySelector('input[name=tmode]:checked').value !== 'down');
}
dlgMode.addEventListener('change', (e) => { if (e.target.name === 'tmode') syncModeForm(); });
const readLimit = (k, fallback) => {
  const m = Math.max(0, parseInt($(`#${k}Min`).value, 10) || 0), s = Math.max(0, parseInt($(`#${k}Sec`).value, 10) || 0);
  const ms = (m * 60 + s) * 1000;
  return ms > 0 ? Math.min(ms, 100 * 3600000) : fallback;
};
dlgMode.addEventListener('close', () => {
  if (dlgMode.returnValue !== 'ok') return;
  S.mode = dlgMode.querySelector('input[name=tmode]:checked').value;
  S.limit = readLimit('p', S.limit);
  S.general.limit = readLimit('g', S.general.limit);
  S.alarm = $('#alarm').checked;
  syncAlerted(); saveSession(); renderRows();
  toast(isDown() ? `Cuenta regresiva: ${fmtShort(S.limit)} por persona` : 'Modo cronómetro');
});
$('#btnMode').onclick = openMode;

// ---------- general: eventos ----------
$('#gToggle').onclick = () => { toggle(S.general); saveSession(); renderGeneral(); };
$('#gReset').onclick = async () => {
  const g = S.general;
  if (!g.acc && !g.start && !g.laps.length) return;
  if (g.start && !(await confirmBox('El cronómetro general está corriendo. ¿Reiniciarlo?', 'Reiniciar'))) return;
  g.acc = 0; g.start = null; g.laps = []; alerted.delete('g'); saveSession(); renderGeneral();
};
$('#gLap').onclick = () => { const g = S.general; if (!g.start) return; g.laps.push(elapsed(g)); saveSession(); renderGeneral(); };
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  const t = e.target;
  if (t.closest('input, textarea, button, dialog, [contenteditable]')) return;
  e.preventDefault(); $('#gToggle').click();
});

// ---------- importar ----------
const dlgImport = $('#dlgImport'), paste = $('#paste'), preview = $('#preview'), importGo = $('#importGo');
let parsed = [];

const NAME_KEYS = ['nombre', 'name', 'nombres', 'nombre completo', 'full name', 'fullname', 'persona', 'participante', 'alumno', 'alumna', 'estudiante', 'jugador', 'integrante', 'first name', 'firstname', 'primer nombre'];
const LAST_KEYS = ['apellido', 'apellidos', 'last name', 'lastname', 'surname', 'apellido paterno'];

const MS_KEYS = ['milisegundos', 'ms', 'tiempo_ms', 'elapsed_ms'];
let parsedMeta = null; // modo y límites, si el archivo es una descarga de Tiempos

// Normaliza a [{name, ms}]; ms solo si el archivo traía tiempos.
function clean(list) {
  return list.map((it) => {
    const o = typeof it === 'object' && it ? it : { name: it };
    const name = String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const ms = Number(o.ms);
    return Number.isFinite(ms) && ms > 0 ? { name, ms } : { name };
  }).filter((x) => x.name);
}
function fromObj(o) {
  if (o == null) return '';
  if (typeof o === 'string') return o;
  if (typeof o !== 'object') return '';
  const keys = Object.keys(o);
  const find = (cands) => keys.find((k) => cands.includes(norm(k)));
  const nk = find(NAME_KEYS), lk = find(LAST_KEYS), mk = find(MS_KEYS);
  const ms = mk ? Number(o[mk]) : undefined;
  if (nk) return { name: [o[nk], lk ? o[lk] : ''].filter(Boolean).join(' '), ms };
  const firstStr = keys.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim());
  return { name: firstStr || '', ms };
}
function parseJSON(text) {
  let data = JSON.parse(text);
  if (data && !Array.isArray(data) && data.app === 'Tiempos') {
    parsedMeta = {
      lista: data.lista || null,
      mode: data.modo === 'regresiva' ? 'down' : data.modo === 'cronometro' ? 'up' : null,
      limit: Number(data.limite_persona_ms) || null,
      glimit: Number(data.limite_general_ms) || null,
    };
  }
  if (!Array.isArray(data) && data && typeof data === 'object') {
    const pref = ['personas', 'people', 'nombres', 'names', 'lista', 'list', 'participantes', 'members', 'integrantes', 'data'];
    const k = Object.keys(data).find((k) => pref.includes(norm(k)) && Array.isArray(data[k]))
      || Object.keys(data).find((k) => Array.isArray(data[k]));
    data = k ? data[k] : [data];
  }
  return clean(data.map(fromObj));
}
function parseCSVRows(text, delim) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
function guessDelim(line) {
  const c = [',', ';', '\t'].map((d) => [d, line.split(d).length - 1]).sort((a, b) => b[1] - a[1]);
  return c[0][1] > 0 ? c[0][0] : null;
}
function parseCSV(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = guessDelim(first);
  if (!delim) return parseLines(text);
  const rows = parseCSVRows(text, delim);
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  let ni = head.findIndex((h) => NAME_KEYS.includes(h));
  const li = head.findIndex((h) => LAST_KEYS.includes(h));
  const mi = head.findIndex((h) => MS_KEYS.includes(h));
  let body = rows;
  if (ni >= 0 || li >= 0) {
    body = rows.slice(1);
    if (ni < 0) ni = li;
    // CSV de tiempos de esta app: las filas sin posición (General, Parciales) no son personas
    if (head[0] === 'posicion') body = body.filter((r) => (r[0] || '').trim());
  } else {
    // sin encabezado reconocible: la primera columna que no sea número
    ni = Math.max(0, rows[0].findIndex((_, i) => rows.slice(0, 10).filter((r) => r[i] && isNaN(Number(r[i].trim()))).length >= Math.min(rows.length, 10) / 2));
  }
  return clean(body.map((r) => ({
    name: [r[ni], li >= 0 && li !== ni ? r[li] : ''].filter((x) => x && x.trim()).join(' '),
    ms: mi >= 0 ? Number(r[mi]) : undefined,
  })));
}
function parseLines(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  // Una sola columna con encabezado («Nombre»): el encabezado no es una persona.
  if (lines.length && NAME_KEYS.includes(norm(lines[0]))) lines.shift();
  return clean(lines.map((l) => l.replace(/^\s*(\d+[.)-]\s+|[-*•]\s+)/, '')));
}
function parseAny(text, filename = '') {
  parsedMeta = null;
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return [];
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'json' || /^[[{]/.test(t)) {
    try { return parseJSON(t); } catch { if (ext === 'json') throw new Error('El JSON no es válido.'); }
  }
  if (ext === 'txt') return parseLines(t);
  if (ext === 'csv') return parseCSV(t);
  // pegado: CSV si el encabezado es reconocible o todas las líneas tienen el mismo separador
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const d = guessDelim(lines[0]);
  if (d) {
    const head = lines[0].split(d).map(norm);
    const sameCount = lines.length > 1 && lines.every((l) => l.split(d).length === lines[0].split(d).length);
    if (head.some((h) => NAME_KEYS.includes(h) || LAST_KEYS.includes(h)) || sameCount) return parseCSV(t);
  }
  return parseLines(t);
}

function updatePreview(names, err) {
  parsed = names || [];
  importGo.disabled = parsed.length === 0;
  if (err) { preview.innerHTML = `<span class="warn">${esc(err)}</span>`; return; }
  if (!parsed.length) { preview.textContent = paste.value.trim() ? 'No se encontraron nombres.' : ''; return; }
  const append = dlgImport.querySelector('input[name=mode]:checked').value === 'append';
  const room = append ? MAX - S.people.length : MAX;
  const sample = parsed.slice(0, 6).map((x) => esc(x.name)).join(', ') + (parsed.length > 6 ? '…' : '');
  let html = `<b>${parsed.length}</b> ${parsed.length === 1 ? 'nombre' : 'nombres'}: ${sample}`;
  const withTime = parsed.filter((x) => x.ms > 0).length;
  if (withTime) html += `<br>${withTime} con tiempo guardado: se cargan en pausa.`;
  if (parsedMeta?.mode === 'down') html += `<br>Trae cuenta regresiva de ${fmtShort(parsedMeta.limit || S.limit)} por persona.`;
  if (parsed.length > room) html += `<br><span class="warn">Solo entran ${Math.max(0, room)}; el resto se omite.</span>`;
  preview.innerHTML = html;
}
let lastFileName = '';
function readText(text, name) {
  lastFileName = name || '';
  try { updatePreview(parseAny(text, lastFileName)); } catch (e) { updatePreview([], e.message); }
}
paste.addEventListener('input', () => readText(paste.value, ''));
dlgImport.addEventListener('change', (e) => { if (e.target.name === 'mode') readText(paste.value, lastFileName); });
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  paste.value = text;
  readText(text, f.name);
  e.target.value = '';
});
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', async (e) => {
  const f = e.dataTransfer.files[0]; if (!f) return;
  const text = await f.text(); paste.value = text; readText(text, f.name);
});

function openImport() {
  paste.value = ''; lastFileName = ''; dlgImport.returnValue = ''; updatePreview([]);
  dlgImport.querySelector(`input[value=${S.people.length ? 'append' : 'replace'}]`).checked = true;
  dlgImport.showModal();
}
$('#btnImport').onclick = openImport;
dlgImport.addEventListener('close', async () => {
  if (dlgImport.returnValue !== 'ok' || !parsed.length) return;
  const append = dlgImport.querySelector('input[name=mode]:checked').value === 'append';
  if (!append) {
    if (S.people.some((p) => p.start || p.acc) && !(await confirmBox('Reemplazar la lista borra los tiempos actuales. ¿Seguir?', 'Reemplazar'))) return;
    S.people = []; S.listId = null; S.listName = parsedMeta?.lista || null;
  }
  if (parsedMeta?.mode) {
    S.mode = parsedMeta.mode;
    if (parsedMeta.limit > 0) S.limit = parsedMeta.limit;
    if (parsedMeta.glimit > 0) S.general.limit = parsedMeta.glimit;
  }
  const r = addPeople(parsed);
  saveSession(); renderRows();
  toast(r.skipped ? `Se agregaron ${r.added}. ${r.skipped} no entraron (máximo 100).` : `Se agregaron ${r.added} ${r.added === 1 ? 'persona' : 'personas'}.`);
});
importGo.addEventListener('click', () => { dlgImport.returnValue = 'ok'; });

// ---------- listas guardadas ----------
const dlgLists = $('#dlgLists');
function renderLists() {
  $('#where').textContent = listsSource === 'cloud'
    ? `Se guardan en tu cuenta (${user?.email || 'Google'}) y aparecen en todos tus dispositivos.`
    : 'Se guardan en este navegador. Entra con Google para tenerlas en el PC y el celular.';
  $('#saveName').value = S.listName || '';
  $('#saveBtn').textContent = S.listId && lists.some((l) => l.id === S.listId) ? 'Guardar cambios' : 'Guardar';
  $('#saveAsNew').hidden = !(S.listId && lists.some((l) => l.id === S.listId));
  $('#saveBtn').disabled = S.people.length === 0;
  const ul = $('#saved');
  const sorted = [...lists].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  ul.innerHTML = sorted.length ? sorted.map((l) => `
    <li data-id="${l.id}" class="${l.id === S.listId ? 'cur' : ''}">
      <div class="s-main" data-act="open" role="button" tabindex="0">
        <div class="s-name">${esc(l.name)}</div>
        <div class="s-meta">${l.people.length} ${l.people.length === 1 ? 'persona' : 'personas'} · ${new Date(l.updatedAt || 0).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</div>
      </div>
      <button class="btn" data-act="open">Abrir</button>
      <button class="btn btn-icon ghost danger" data-act="del" aria-label="Borrar ${esc(l.name)}">${icon('i-x')}</button>
    </li>`).join('') : '<li class="none">Todavía no hay listas guardadas.</li>';
}
function openLists() { renderLists(); dlgLists.showModal(); }
$('#btnLists').onclick = openLists;
document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => b.dataset.open === 'import' ? openImport() : openLists());
document.querySelectorAll('dialog [data-close]').forEach((b) => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('dialog.sheet').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close('cancel'); }));

async function persistList(list) {
  list.updatedAt = now();
  if (listsSource === 'cloud' && cloud) {
    await cloud.saveList(list);
  } else {
    const all = loadLocalLists().filter((l) => l.id !== list.id);
    all.push(list); saveLocalLists(all); lists = all;
  }
}
async function removeList(id) {
  if (listsSource === 'cloud' && cloud) await cloud.deleteList(id);
  else { const all = loadLocalLists().filter((l) => l.id !== id); saveLocalLists(all); lists = all; }
}
async function saveCurrent(asNew) {
  const name = $('#saveName').value.trim() || S.listName || 'Lista sin nombre';
  const people = [...S.people].sort((a, b) => a.seq - b.seq).map((p) => p.name);
  const id = !asNew && S.listId && lists.some((l) => l.id === S.listId) ? S.listId : uid();
  try {
    await persistList({ id, name, people });
    S.listId = id; S.listName = name; S.dirty = false;
    saveSession(); renderChrome(); renderLists();
    toast(listsSource === 'cloud' ? 'Lista guardada en tu cuenta' : 'Lista guardada');
  } catch (e) { toast('No se pudo guardar: ' + (e.message || e)); }
}
$('#saveForm').addEventListener('submit', (e) => { e.preventDefault(); if (S.people.length) saveCurrent(false); });
$('#saveAsNew').onclick = () => saveCurrent(true);
$('#saved').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const l = lists.find((x) => x.id === b.closest('li').dataset.id); if (!l) return;
  if (b.dataset.act === 'open') {
    if (S.people.some((p) => p.start || p.acc) && !(await confirmBox(`Abrir «${l.name}» reemplaza a las personas actuales y sus tiempos. ¿Seguir?`, 'Abrir'))) return;
    S.people = []; S.listId = l.id; S.listName = l.name;
    addPeople(l.people); S.dirty = false;
    saveSession(); dlgLists.close(); renderRows();
  } else if (b.dataset.act === 'del') {
    const ok = await confirmBox(`¿Borrar la lista «${l.name}»? No se puede deshacer.`, 'Borrar');
    if (ok) {
      try {
        await removeList(l.id);
        if (S.listId === l.id) { S.listId = null; S.listName = null; saveSession(); }
        renderChrome();
      } catch (err) { toast('No se pudo borrar: ' + (err.message || err)); }
    }
    renderLists();
    if (!dlgLists.open) dlgLists.showModal();
  }
});
$('#saved').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-act]')) e.target.click(); });

// ---------- cuenta ----------
const dlgAccount = $('#dlgAccount');
function renderAccount() {
  const body = $('#accountBody');
  if (!cloud) {
    body.innerHTML = `
      <p class="acc-p">Tus listas se guardan en este navegador.</p>
      <button class="btn google" disabled>${icon('i-google')}<span>Entrar con Google</span></button>
      <p class="acc-p" style="color:var(--muted);font-size:13px">El inicio de sesión con Google todavía no está activado en esta copia de la app.</p>`;
  } else if (!user) {
    body.innerHTML = `
      <p class="acc-p">Entra para guardar tus listas en tu cuenta y abrirlas en el PC y en el celular. Las listas de este navegador se copian a tu cuenta.</p>
      <button class="btn google" id="gIn">${icon('i-google')}<span>Entrar con Google</span></button>`;
    $('#gIn').onclick = async () => {
      try { await cloud.signIn(); dlgAccount.close(); }
      catch (e) { if (!/popup-closed|cancelled-popup/.test(e.code || '')) toast('No se pudo entrar: ' + (e.code || e.message)); }
    };
  } else {
    body.innerHTML = `
      <div class="acc-row">
        <span class="avatar">${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : icon('i-user')}</span>
        <div><div class="acc-name">${esc(user.displayName || 'Tu cuenta')}</div><div class="acc-mail">${esc(user.email || '')}</div></div>
      </div>
      <p class="acc-p">Tus listas se guardan en tu cuenta.</p>
      <div class="sheet-f"><button class="btn" id="gOut">Salir</button></div>`;
    $('#gOut').onclick = async () => { await cloud.signOut(); dlgAccount.close(); };
  }
}
$('#btnAccount').onclick = () => { renderAccount(); dlgAccount.showModal(); };
function renderAvatar() {
  $('#avatar').innerHTML = user?.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : icon('i-user');
  $('#btnAccount').setAttribute('aria-label', user ? `Cuenta: ${user.email || ''}` : 'Cuenta');
}

async function startCloud() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) return;
  try {
    cloud = await import('./nube.js');
    cloud.start(cfg, {
      onUser: async (u) => {
        user = u; renderAvatar();
        if (u) {
          listsSource = 'cloud';
          try {
            const n = await cloud.migrate(loadLocalLists());
            if (n) toast(`${n} ${n === 1 ? 'lista copiada' : 'listas copiadas'} a tu cuenta`);
          } catch (e) { console.warn(e); }
        } else {
          listsSource = 'local'; lists = loadLocalLists();
        }
        if (dlgLists.open) renderLists();
        renderChrome();
      },
      onLists: (l) => { if (listsSource !== 'cloud') return; lists = l; if (dlgLists.open) renderLists(); renderChrome(); },
    });
  } catch (e) {
    console.warn('Firebase no disponible', e); cloud = null;
  }
}

// ---------- utilidades de interfaz ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function confirmBox(text, yes = 'Aceptar') {
  const d = $('#dlgConfirm');
  $('#confirmText').textContent = text; $('#confirmYes').textContent = yes;
  d.returnValue = '';
  d.showModal();
  return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true }));
}

// Otra pestaña cambió la sesión: la tomamos.
window.addEventListener('storage', (e) => {
  if (e.key === K_SESSION) { S = loadSession(); renderRows(); }
  if (e.key === K_LISTS && listsSource === 'local') { lists = loadLocalLists(); renderChrome(); }
});

// ---------- arranque ----------
lists = loadLocalLists();
syncAlerted(); // lo que ya pasó el cero antes de recargar no vuelve a sonar
renderRows();
requestAnimationFrame(frame);
startCloud();

// Para pruebas desde la consola
window.__tiempos = { get state() { return S; }, parseAny };
