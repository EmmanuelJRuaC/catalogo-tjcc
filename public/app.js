'use strict';

/* ====== Configuración (edita aquí) ====== */
const CONFIG = {
  marca: 'Taller Joyeria CC',          // nombre de tu joyería
  moneda: 'COP',            // COP, MXN, PEN, EUR, etc.
  locale: 'es-419',
  maxFotos: 5,
  categorias: ['Anillos', 'Collares', 'Aretes', 'Pulseras', 'Relojes', 'Dijes'],
};
const SESSION_MS = 10 * 60 * 1000;

const $ = (s, r = document) => r.querySelector(s);
const state = { products: [], q: '', cat: 'Todas', estado: 'todas', orden: 'recientes', exp: 0, tick: null, editing: null, items: [] };

const money = (n) => new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.moneda, maximumFractionDigits: 0 }).format(n || 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const img = (k) => `/api/img/${k}`;
const GEM = '<svg viewBox="0 0 120 100" fill="none" stroke="currentColor" stroke-width="2"><path d="M30 6h60l26 30-56 62L4 36zM4 36h112M30 6l30 30 30-30"/></svg>';

/* ====== API ====== */
async function api(path, { method = 'GET', body, raw, type } = {}) {
  const headers = {};
  let payload;
  if (raw) { payload = raw; headers['content-type'] = type; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await fetch('/api/' + path, { method, headers, body: payload, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') { lock(); throw new Error('Sesión expirada'); }
  if (!res.ok) throw new Error(data.error || 'Ocurrió un error');
  return data;
}

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3500);
}

/* ====== Sesión (10 min, sobrevive a recargas gracias a la cookie) ====== */
function startSession(exp) {
  state.exp = exp;
  $('#login').hidden = true;
  $('#app').hidden = false;
  clearInterval(state.tick);
  updateClock();
  state.tick = setInterval(updateClock, 1000);
  loadProducts();
}

function updateClock() {
  const left = state.exp - Date.now();
  if (left <= 0) return lock();
  const s = Math.ceil(left / 1000);
  $('#clockTxt').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('#ring').style.strokeDashoffset = 94.25 * (1 - left / SESSION_MS);
  $('#clock').classList.toggle('low', left < 60000);
}

function lock() {
  clearInterval(state.tick);
  state.products = [];
  $('#grid').innerHTML = '';
  $('#detailBody').innerHTML = '';
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $('#app').hidden = true;
  $('#expired').hidden = false;
  $('#reloadBtn').focus();
}

async function boot() {
  document.querySelectorAll('[data-brand]').forEach((n) => (n.textContent = CONFIG.marca));
  document.title = `${CONFIG.marca} · Catálogo`;
  try {
    const { exp } = await api('session');
    startSession(exp);
  } catch { /* sin sesión: se queda el login */ }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn'), err = $('#loginErr');
  btn.disabled = true; btn.textContent = 'Verificando…'; err.hidden = true;
  try {
    const { exp } = await api('login', { method: 'POST', body: { password: $('#pw').value } });
    $('#pw').value = '';
    startSession(exp);
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    const card = $('#loginForm'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    $('#pw').select();
  } finally { btn.disabled = false; btn.textContent = 'Entrar al catálogo'; }
});
$('#pwToggle').addEventListener('click', () => {
  const i = $('#pw'), show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  $('#pwToggle').textContent = show ? 'Ocultar' : 'Ver';
});
$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});
$('#reloadBtn').addEventListener('click', () => location.reload());

/* ====== Catálogo ====== */
async function loadProducts() {
  $('#grid').innerHTML = '<div class="skel"></div>'.repeat(6);
  try {
    state.products = (await api('products')).products;
    render();
  } catch (e) { if (!$('#app').hidden) { $('#grid').innerHTML = ''; toast(e.message, true); } }
}

function visible() {
  const q = state.q.trim().toLowerCase();
  let list = state.products.filter((p) => {
    if (state.cat !== 'Todas' && p.categoria !== state.cat) return false;
    if (state.estado === 'disponible' && p.vendido) return false;
    if (state.estado === 'vendida' && !p.vendido) return false;
    return !q || [p.nombre, p.codigo, p.material, p.piedra, p.categoria].join(' ').toLowerCase().includes(q);
  });
  const sorts = {
    recientes: (a, b) => b.creado - a.creado,
    'precio-asc': (a, b) => a.precio - b.precio,
    'precio-desc': (a, b) => b.precio - a.precio,
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
  };
  return list.sort(sorts[state.orden]);
}

function render() {
  const all = state.products, sold = all.filter((p) => p.vendido).length;
  $('#stats').innerHTML = `<li><b>${all.length}</b>Piezas</li><li><b>${all.length - sold}</b>Disponibles</li><li><b>${sold}</b>Vendidas</li>`;

  const cats = ['Todas', ...new Set(all.map((p) => p.categoria).filter(Boolean))];
  if (!cats.includes(state.cat)) state.cat = 'Todas';
  $('#chips').innerHTML = cats.map((c) => `<button class="chip" role="tab" aria-selected="${c === state.cat}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('#cats').innerHTML = [...new Set([...CONFIG.categorias, ...cats.slice(1)])].map((c) => `<option value="${esc(c)}">`).join('');

  const list = visible();
  $('#grid').innerHTML = list.map((p) => `
    <article class="card ${p.vendido ? 'sold' : ''}" data-id="${p.id}" tabindex="0" aria-label="${esc(p.nombre)}">
      <div class="media">
        ${p.imagenes[0] ? `<img loading="lazy" src="${img(p.imagenes[0])}" alt="${esc(p.nombre)}">` : `<div class="noimg">${GEM}</div>`}
        ${p.imagenes[1] ? `<img class="alt" loading="lazy" src="${img(p.imagenes[1])}" alt="">` : ''}
        ${p.vendido ? '<span class="tag">Vendida</span>' : ''}
      </div>
      <div class="info">
        <p class="cat">${esc(p.categoria || 'Sin categoría')}</p>
        <h3>${esc(p.nombre)}</h3>
        <p class="price">${money(p.precio)}</p>
      </div>
    </article>`).join('');

  const empty = $('#empty');
  empty.hidden = list.length > 0;
  if (!list.length) {
    empty.innerHTML = all.length
      ? '<h3>Sin resultados</h3><p>Prueba con otra búsqueda o cambia los filtros.</p>'
      : '<h3>Aún no hay piezas</h3><p>Agrega la primera con el botón “Nueva pieza”.</p>';
  }
}

$('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('#estado').addEventListener('change', (e) => { state.estado = e.target.value; render(); });
$('#orden').addEventListener('change', (e) => { state.orden = e.target.value; render(); });
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (b) { state.cat = b.dataset.cat; render(); }
});
const openCard = (el) => { const c = el.closest('.card'); if (c) showDetail(c.dataset.id); };
$('#grid').addEventListener('click', (e) => openCard(e.target));
$('#grid').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(e.target); } });

/* ====== Detalle ====== */
function showDetail(id, idx = 0) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const specs = [['Código', p.codigo], ['Categoría', p.categoria], ['Material', p.material], ['Piedra', p.piedra], ['Peso', p.peso], ['Medidas', p.medidas]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const main = p.imagenes[idx] ? `<img class="main" src="${img(p.imagenes[idx])}" alt="${esc(p.nombre)}">` : `<div class="noimg">${GEM}</div>`;
  const thumbs = p.imagenes.length > 1
    ? `<div class="gthumbs">${p.imagenes.map((k, i) => `<button data-i="${i}" aria-label="Foto ${i + 1}" aria-current="${i === idx}"><img src="${img(k)}" alt=""></button>`).join('')}</div>` : '';
  const soldDate = p.vendidoEn ? new Date(p.vendidoEn).toLocaleDateString(CONFIG.locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  $('#detailBody').innerHTML = `
    <div class="gallery">${main}${thumbs}</div>
    <div class="dinfo">
      ${p.vendido ? `<span class="badge-sold">Vendida${soldDate ? ' el ' + soldDate : ''}</span>` : ''}
      <h2>${esc(p.nombre)}</h2>
      <p class="price">${money(p.precio)}</p>
      ${specs ? `<dl class="specs">${specs}</dl>` : ''}
      ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : ''}
      <div class="actions">
        <button class="btn primary" data-act="sold">${p.vendido ? 'Revertir venta' : 'Marcar como vendida'}</button>
        <button class="btn ghost-btn" data-act="edit">Editar</button>
        <button class="btn ghost-btn" data-act="del">Eliminar</button>
      </div>
    </div>`;
  const dlg = $('#detail');
  dlg.dataset.id = id;
  if (!dlg.open) dlg.showModal();
}

$('#detailBody').addEventListener('click', async (e) => {
  const id = $('#detail').dataset.id;
  const th = e.target.closest('[data-i]');
  if (th) return showDetail(id, +th.dataset.i);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const p = state.products.find((x) => x.id === id);
  if (act === 'edit') { $('#detail').close(); return openForm(p); }
  if (act === 'sold') {
    const btn = e.target.closest('button'); btn.disabled = true;
    try {
      const { product } = await api(`products/${id}/sold`, { method: 'POST', body: { vendido: !p.vendido } });
      Object.assign(p, product);
      toast(product.vendido ? 'Pieza marcada como vendida' : 'Venta revertida');
      render(); showDetail(id);
    } catch (ex) { toast(ex.message, true); btn.disabled = false; }
  }
  if (act === 'del') {
    if (!(await ask('¿Eliminar esta pieza?', `“${p.nombre}” y sus fotos se borrarán definitivamente.`))) return;
    try {
      await api(`products/${id}`, { method: 'DELETE' });
      state.products = state.products.filter((x) => x.id !== id);
      $('#detail').close(); render(); toast('Pieza eliminada');
    } catch (ex) { toast(ex.message, true); }
  }
});

function ask(title, msg) {
  $('#confirmTitle').textContent = title;
  $('#confirmMsg').textContent = msg;
  const d = $('#confirmDlg');
  return new Promise((res) => {
    d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
    d.returnValue = 'no';
    d.showModal();
  });
}

/* ====== Formulario (crear / editar) ====== */
function openForm(p = null) {
  state.editing = p;
  state.items = (p?.imagenes || []).map((k) => ({ key: k, url: img(k) }));
  const f = $('#form');
  f.reset();
  $('#formTitle').textContent = p ? 'Editar pieza' : 'Nueva pieza';
  ['nombre', 'categoria', 'codigo', 'precio', 'peso', 'material', 'piedra', 'medidas', 'descripcion'].forEach((n) => { f.elements[n].value = p?.[n] ?? ''; });
  $('#formErr').hidden = true;
  renderThumbs();
  $('#formDlg').showModal();
}
$('#newBtn').addEventListener('click', () => openForm());

function renderThumbs() {
  $('#thumbs').innerHTML = state.items.map((it, i) => `
    <li><img src="${it.url}" alt="Foto ${i + 1}">
      <button type="button" class="rm" data-rm="${i}" aria-label="Quitar foto">×</button>
      ${i === 0 ? '' : `<button type="button" class="cover" data-cover="${i}">Portada</button>`}
    </li>`).join('');
}
$('#thumbs').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]'), cv = e.target.closest('[data-cover]');
  if (rm) { const [it] = state.items.splice(+rm.dataset.rm, 1); if (it.file) URL.revokeObjectURL(it.url); }
  if (cv) state.items.unshift(...state.items.splice(+cv.dataset.cover, 1));
  renderThumbs();
});

function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (state.items.length >= CONFIG.maxFotos) { toast(`Máximo ${CONFIG.maxFotos} fotos por pieza`, true); break; }
    state.items.push({ file, url: URL.createObjectURL(file) });
  }
  renderThumbs();
}
$('#files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

// Reduce la foto antes de subirla (más rápido y ahorra espacio en el servidor)
async function compress(file) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo procesar la imagen'))), 'image/webp', 0.86));
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('#formErr'), btn = $('#saveBtn');
  err.hidden = true;
  if (!f.elements.nombre.value.trim()) { err.textContent = 'Escribe el nombre de la pieza.'; err.hidden = false; f.elements.nombre.focus(); return; }
  btn.disabled = true;
  try {
    const keys = [];
    let n = 0; const total = state.items.filter((i) => i.file).length;
    for (const it of state.items) {
      if (!it.file) { keys.push(it.key); continue; }
      btn.textContent = `Subiendo fotos ${++n}/${total}…`;
      const blob = await compress(it.file);
      const { key } = await api('upload', { method: 'POST', raw: blob, type: blob.type });
      keys.push(key);
    }
    btn.textContent = 'Guardando…';
    const data = Object.fromEntries(['nombre', 'categoria', 'codigo', 'precio', 'peso', 'material', 'piedra', 'medidas', 'descripcion'].map((k) => [k, f.elements[k].value]));
    data.imagenes = keys;
    if (state.editing) {
      const { product } = await api(`products/${state.editing.id}`, { method: 'PUT', body: data });
      Object.assign(state.editing, product);
      toast('Cambios guardados');
    } else {
      const { product } = await api('products', { method: 'POST', body: data });
      state.products.unshift(product);
      toast('Pieza agregada');
    }
    state.items.forEach((i) => i.file && URL.revokeObjectURL(i.url));
    $('#formDlg').close(); render();
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Guardar pieza'; }
});

/* ====== Cierre de diálogos ====== */
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
});

boot();
