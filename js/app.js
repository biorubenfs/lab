/**
 * Lógica de la interfaz: pantalla "Guardadas" y editor de solicitudes.
 *
 * Navegación con el hash de la URL (el botón Atrás del navegador funciona):
 *   #            -> Guardadas
 *   #/nueva      -> nueva solicitud (se guarda al escribir algo)
 *   #/s/<id>     -> editar solicitud
 */
(function () {
  'use strict';

  const cfg = LGA.config;
  const store = LGA.store;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return y && m && d ? `${d}/${m}/${y}` : String(iso);
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ------------------------------------------------------------------ estado

  let current = null;   // solicitud abierta en el editor
  let isNew = false;    // aún no guardada en localStorage
  let saveTimer = null;
  let sig = null;

  // ------------------------------------------------------------------- toast

  let toastTimer = null;
  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, type === 'error' ? 5000 : 3500);
  }

  // ------------------------------------------------------- estado Nevis / PDF

  /** Texto y clase del estado Nevis, p. ej. "Pendientes 3/3" / "Completados 2/3". */
  function nevisBadge(sol) {
    const st = store.nevisStatus(sol);
    if (st.complete) return { cls: 'complete', text: `Nevis completados ${st.done}/${st.total}` };
    if (st.done === 0) return { cls: 'pending', text: `Nevis pendientes ${st.total}/${st.total}` };
    return { cls: 'partial', text: `Nevis completados ${st.done}/${st.total}` };
  }

  /** Estado del PDF: generado, o desactualizado si se editó después. */
  function pdfChip(sol) {
    if (!sol.pdfGeneradoEn) return null;
    const stale = String(sol.updatedAt) > String(sol.pdfGeneradoEn);
    return {
      cls: stale ? 'chip stale' : 'chip',
      text: stale ? 'PDF desactualizado' : `PDF generado ${fmtDateTime(sol.pdfGeneradoEn)}`,
    };
  }

  // =============================================================== GUARDADAS

  function showList() {
    current = null;
    isNew = false;
    $('#view-editor').hidden = true;
    $('#view-list').hidden = false;
    document.title = 'Solicitudes de análisis · LGA';
    renderList();
  }

  function renderList() {
    const q = norm($('#search').value);
    const all = store.all();
    const items = all.filter((s) => !q || norm([s.cliente, s.ubicacion, s.personaEntrega].join(' ')).includes(q));

    const pendientes = all.filter((s) => !store.nevisStatus(s).complete).length;
    $('#listSummary').textContent = all.length
      ? `${all.length} solicitud${all.length === 1 ? '' : 'es'} guardada${all.length === 1 ? '' : 's'} · ${pendientes} con Nevis pendientes`
      : '';

    if (!items.length) {
      $('#list').innerHTML = `<div class="empty">${all.length
        ? 'Ninguna solicitud coincide con la búsqueda.'
        : 'No hay solicitudes guardadas.<br>Pulsa <b>+ Nueva solicitud</b> para registrar una recepción de muestras.'}</div>`;
      return;
    }

    // Agrupar por cliente (sin distinguir mayúsculas ni acentos)
    const groups = new Map();
    for (const s of items) {
      const key = norm(s.cliente);
      if (!groups.has(key)) groups.set(key, { name: s.cliente.trim() || '(Sin cliente)', items: [] });
      groups.get(key).items.push(s);
    }
    const sorted = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));

    $('#list').innerHTML = sorted.map((g) => {
      g.items.sort((a, b) =>
        String(b.fechaRecepcion).localeCompare(String(a.fechaRecepcion)) ||
        String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return `<section class="group">
        <h3 class="group-title">${esc(g.name)} <span class="count">${g.items.length}</span></h3>
        <div class="cards">${g.items.map(cardHtml).join('')}</div>
      </section>`;
    }).join('');
  }

  function cardHtml(s) {
    const nb = nevisBadge(s);
    const pc = pdfChip(s);
    const n = s.muestras.length;
    return `<article class="req-card" data-id="${esc(s.id)}">
      <button type="button" class="req-main" data-action="open">
        <span class="req-loc">${esc(s.ubicacion || 'Sin ubicación')}</span>
        <span class="req-meta">${esc(fmtDate(s.fechaRecepcion))} · ${n} muestra${n === 1 ? '' : 's'}${s.personaEntrega ? ' · ' + esc(s.personaEntrega) : ''}</span>
        <span class="req-badges">
          <span class="badge ${nb.cls}">${esc(nb.text)}</span>
          ${pc ? `<span class="${pc.cls}">${esc(pc.text)}</span>` : ''}
        </span>
      </button>
      <div class="req-actions">
        <button type="button" data-action="dup">Duplicar</button>
        <button type="button" class="del" data-action="del">Eliminar</button>
      </div>
    </article>`;
  }

  function confirmDelete(s) {
    const quien = [s.cliente || 'sin cliente', s.ubicacion, fmtDate(s.fechaRecepcion)].filter(Boolean).join(' · ');
    const aviso = s.pdfGeneradoEn
      ? 'Asegúrate de que el PDF ya está subido a la carpeta de red.'
      : 'ATENCIÓN: todavía no se ha generado el PDF de esta solicitud.';
    return confirm(`¿Eliminar la solicitud (${quien})?\n\n${aviso}\n\nEsta acción no se puede deshacer.`);
  }

  function onListClick(e) {
    const btn = e.target.closest('[data-action]');
    const card = e.target.closest('.req-card');
    if (!btn || !card) return;
    const id = card.dataset.id;
    const action = btn.dataset.action;
    if (action === 'open') {
      location.hash = '#/s/' + encodeURIComponent(id);
    } else if (action === 'dup') {
      try {
        const d = store.duplicate(id);
        toast('Copia creada con fecha de hoy', 'ok');
        location.hash = '#/s/' + encodeURIComponent(d.id);
      } catch (err) {
        toast('No se pudo duplicar: ' + err.message, 'error');
      }
    } else if (action === 'del') {
      const s = store.get(id);
      if (s && confirmDelete(s)) {
        store.remove(id);
        renderList();
        toast('Solicitud eliminada');
      }
    }
  }

  // ------------------------------------------------------- copia de seguridad

  function exportBackup() {
    const data = store.exportData();
    const fecha = store.today().replace(/-/g, '').slice(2);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fecha}_copia_solicitudes_lga.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`Copia exportada (${data.solicitudes.length} solicitudes)`, 'ok');
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const r = store.importData(JSON.parse(reader.result));
        renderList();
        toast(`Importadas: ${r.added} nuevas, ${r.updated} actualizadas`, 'ok');
      } catch (err) {
        toast('No se pudo importar: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  // ================================================================== EDITOR

  function openEditor(sol, newFlag) {
    current = sol;
    isNew = newFlag;
    $('#view-list').hidden = true;
    $('#view-editor').hidden = false;
    document.title = (sol.cliente || 'Nueva solicitud') + ' · LGA';

    $$('[data-field]').forEach((el) => {
      el.value = current[el.dataset.field] || '';
      el.classList.remove('invalid');
    });
    refreshDatalists();
    renderSamples();
    updateStatus();
    setSaveState('');
    window.scrollTo(0, 0);
    sig.load(current.firma); // la vista ya es visible: el canvas tiene tamaño
    if (newFlag) $('[data-field="cliente"]').focus();
  }

  // ---------------------------------------------------------------- guardado

  function setSaveState(text) {
    $('#saveState').textContent = text;
  }

  function scheduleSave() {
    setSaveState('Guardando…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function saveNow(opts) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!current) return;
    if (isNew && store.isBlank(current)) { setSaveState(''); return; }
    try {
      store.save(current, opts);
      if (isNew) {
        isNew = false;
        history.replaceState(null, '', '#/s/' + encodeURIComponent(current.id));
      }
      setSaveState('Guardado ✓');
      updateStatus();
    } catch (err) {
      console.error(err);
      setSaveState('');
      toast('No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado', 'error');
    }
  }

  function flushSave() {
    if (saveTimer) saveNow();
  }

  function updateStatus() {
    if (!current) return;
    const nb = nevisBadge(current);
    const badge = $('#statusBadge');
    badge.className = 'badge ' + nb.cls;
    badge.textContent = (nb.cls === 'complete' ? 'Completa · ' : 'Pendiente · ') + nb.text;
    const pc = isNew ? null : pdfChip(current);
    const chip = $('#pdfState');
    chip.hidden = !pc;
    if (pc) { chip.className = pc.cls; chip.textContent = pc.text; }
  }

  function refreshDatalists() {
    const all = store.all();
    const fill = (id, values) => {
      const uniq = Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'es'));
      $('#' + id).innerHTML = uniq.map((v) => `<option value="${esc(v)}">`).join('');
    };
    fill('dlClientes', all.map((s) => s.cliente));
    fill('dlPersonas', all.map((s) => s.personaEntrega));
    fill('dlUbicaciones', all.map((s) => s.ubicacion));
    fill('dlPuntos', cfg.atajoResidual.puntos.concat(...all.map((s) => s.muestras.map((m) => m.punto))));
  }

  // ---------------------------------------------------------------- muestras

  function optionsHtml(list, selected, placeholder) {
    const opts = list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`);
    if (selected && !list.includes(selected)) {
      opts.push(`<option value="${esc(selected)}" selected>${esc(selected)}</option>`); // valor antiguo fuera de la lista
    }
    return `<option value=""${selected ? '' : ' selected'}>${esc(placeholder)}</option>` + opts.join('');
  }

  function sampleHtml(m, i) {
    const showOtro = m.analisis === cfg.analisisOtros;
    const showMatrizOtro = m.matriz === cfg.matrizOtro;
    const showInSitu = m.matriz === cfg.matrizConInSitu;
    const nevisPending = !String(m.nevis || '').trim();
    return `<div class="sample" data-index="${i}">
      <div class="sample-head">
        <span class="sample-title">Muestra ${i + 1}</span>
        <button type="button" class="icon-btn" data-action="remove-sample" title="Eliminar muestra" aria-label="Eliminar muestra ${i + 1}">✕</button>
      </div>
      <div class="grid sample-grid">
        <label class="field"><span>Nº Nevis</span>
          <input type="text" class="nevis${nevisPending ? ' is-pending' : ''}" data-sfield="nevis" value="${esc(m.nevis)}" placeholder="Pendiente">
        </label>
        <label class="field"><span>Punto de muestreo</span>
          <input type="text" data-sfield="punto" value="${esc(m.punto)}" list="dlPuntos">
        </label>
        <label class="field"><span>Hora de toma</span>
          <input type="time" data-sfield="horaToma" value="${esc(m.horaToma)}">
        </label>
        <label class="field"><span>Matriz</span>
          <select data-sfield="matriz">${optionsHtml(cfg.matrices, m.matriz, 'Seleccionar…')}</select>
        </label>
        ${showMatrizOtro ? `<label class="field"><span>Especificar matriz</span>
          <input type="text" data-sfield="matrizOtro" value="${esc(m.matrizOtro)}" placeholder="Describe la matriz">
        </label>` : ''}
        <label class="field"><span>Análisis solicitado</span>
          <select data-sfield="analisis">${optionsHtml(cfg.analisis, m.analisis, 'Seleccionar…')}</select>
        </label>
        ${showOtro ? `<label class="field"><span>Especificar análisis</span>
          <input type="text" data-sfield="analisisOtro" value="${esc(m.analisisOtro)}" placeholder="Describe el análisis">
        </label>` : ''}
      </div>
      ${showInSitu ? `<div class="insitu">
        <div class="insitu-title">Datos in situ</div>
        <div class="grid insitu-grid">
          ${cfg.inSitu.map((f) => `<label class="field"><span>${esc(f.label)}</span>
            <span class="unit-input">
              <input type="text" inputmode="decimal" data-sfield="inSitu.${f.key}" value="${esc(m.inSitu[f.key])}">
              ${f.unidad ? `<em>${esc(f.unidad)}</em>` : ''}
            </span>
          </label>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
  }

  function renderSamples() {
    $('#samples').innerHTML = current.muestras.map(sampleHtml).join('');
    const n = current.muestras.length;
    $('#sampleCount').textContent = `(${n})`;
  }

  /** Vuelve a pintar una muestra (al cambiar matriz/análisis) manteniendo el foco. */
  function rerenderSample(i, focusField) {
    const el = $(`.sample[data-index="${i}"]`);
    if (!el) return;
    el.outerHTML = sampleHtml(current.muestras[i], i);
    if (focusField) {
      const f = $(`.sample[data-index="${i}"] [data-sfield="${focusField}"]`);
      if (f) f.focus();
    }
  }

  function focusSample(i, field) {
    const el = $(`.sample[data-index="${i}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const f = $(`[data-sfield="${field || 'punto'}"]`, el);
    if (f) f.focus({ preventScroll: true });
  }

  /** + Añadir muestra: copia matriz y análisis de la anterior. */
  function addSample() {
    const last = current.muestras[current.muestras.length - 1];
    current.muestras.push(store.newMuestra(last));
    renderSamples();
    saveNow();
    focusSample(current.muestras.length - 1);
  }

  /**
   * + Entrada · Salida · Biológico: tres muestras Residual con el análisis
   * de la última muestra. Las muestras finales vacías (sin Nevis, punto, hora
   * ni datos in situ) se sustituyen para no dejar huecos.
   */
  function addResidual() {
    const last = current.muestras[current.muestras.length - 1];
    while (current.muestras.length && !store.sampleHasData(current.muestras[current.muestras.length - 1])) {
      current.muestras.pop();
    }
    const first = current.muestras.length;
    for (const punto of cfg.atajoResidual.puntos) {
      const m = store.newMuestra({ analisis: last && last.analisis, analisisOtro: last && last.analisisOtro });
      m.punto = punto;
      m.matriz = cfg.atajoResidual.matriz;
      current.muestras.push(m);
    }
    renderSamples();
    saveNow();
    focusSample(first, 'horaToma'); // el punto ya viene relleno
  }

  function removeSample(i) {
    const m = current.muestras[i];
    if (store.sampleHasData(m) && !confirm(`¿Eliminar la muestra ${i + 1}?`)) return;
    current.muestras.splice(i, 1);
    if (!current.muestras.length) current.muestras.push(store.newMuestra());
    renderSamples();
    saveNow();
  }

  // ----------------------------------------------------------- eventos editor

  function onFormInput(e) {
    const el = e.target;
    if (el.tagName === 'SELECT') return; // los select se tratan en 'change'

    if (el.dataset.field) {
      current[el.dataset.field] = el.value;
      el.classList.remove('invalid');
      if (el.dataset.field === 'cliente') document.title = (el.value || 'Nueva solicitud') + ' · LGA';
      scheduleSave();
      return;
    }

    const sf = el.dataset.sfield;
    if (sf) {
      const i = Number(el.closest('.sample').dataset.index);
      const m = current.muestras[i];
      if (sf.startsWith('inSitu.')) m.inSitu[sf.slice(7)] = el.value;
      else m[sf] = el.value;
      if (sf === 'nevis') {
        el.classList.toggle('is-pending', !el.value.trim());
        updateStatus();
      }
      scheduleSave();
    }
  }

  function onFormChange(e) {
    const el = e.target;
    if (el.tagName !== 'SELECT' || !el.dataset.sfield) return;
    const i = Number(el.closest('.sample').dataset.index);
    current.muestras[i][el.dataset.sfield] = el.value;
    rerenderSample(i, el.dataset.sfield);
    saveNow();
    // Al elegir "Otra" (matriz) u "Otro" (análisis), llevar el foco al campo de texto libre
    const libre = { matriz: [cfg.matrizOtro, 'matrizOtro'], analisis: [cfg.analisisOtros, 'analisisOtro'] }[el.dataset.sfield];
    if (libre && el.value === libre[0]) {
      const f = $(`.sample[data-index="${i}"] [data-sfield="${libre[1]}"]`);
      if (f) f.focus();
    }
  }

  function onEditorClick(e) {
    const btn = e.target.closest('[data-action], [data-go]');
    if (!btn) return;
    if (btn.dataset.go === 'list') { flushSave(); location.hash = ''; return; }
    switch (btn.dataset.action) {
      case 'add-sample': addSample(); break;
      case 'add-residual': addResidual(); break;
      case 'remove-sample': removeSample(Number(btn.closest('.sample').dataset.index)); break;
      case 'clear-sig': sig.clear(); break;
      case 'pdf': generatePdf(); break;
      case 'delete': deleteCurrent(); break;
    }
  }

  function deleteCurrent() {
    if (isNew) { location.hash = ''; return; }
    if (!confirmDelete(current)) return;
    clearTimeout(saveTimer);
    store.remove(current.id);
    current = null;
    toast('Solicitud eliminada');
    location.hash = '';
  }

  // -------------------------------------------------------------------- PDF

  async function generatePdf() {
    // Obligatorios: Cliente y Persona que entrega
    const missing = ['cliente', 'personaEntrega'].map((f) => {
      const el = $(`[data-field="${f}"]`);
      const bad = !String(current[f] || '').trim();
      el.classList.toggle('invalid', bad);
      return bad ? el : null;
    }).filter(Boolean);
    if (missing.length) {
      missing[0].focus();
      toast('Completa los campos obligatorios: Cliente y Persona que entrega', 'error');
      return;
    }
    if (!current.firma && !confirm('La solicitud no tiene firma. ¿Generar el PDF igualmente?')) return;

    const buttons = $$('[data-action="pdf"]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const name = await LGA.pdf.download(current);
      const now = new Date().toISOString();
      current.pdfGeneradoEn = now;
      current.updatedAt = now;
      saveNow({ touch: false });
      const st = store.nevisStatus(current);
      toast(st.complete
        ? `PDF descargado: ${name}`
        : `PDF descargado: ${name} · Nevis pendientes: ${st.total - st.done}`, 'ok');
    } catch (err) {
      console.error(err);
      toast('Error al generar el PDF: ' + err.message, 'error');
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  // ================================================================= ROUTER

  function route() {
    flushSave();
    const h = location.hash;
    if (h === '#/nueva') {
      openEditor(store.create(), true);
    } else if (h.startsWith('#/s/')) {
      const s = store.get(decodeURIComponent(h.slice(4)));
      if (s) openEditor(s, false);
      else { toast('La solicitud no existe', 'error'); location.hash = ''; }
    } else {
      showList();
    }
  }

  // ================================================================== INICIO

  function init() {
    if (!window.PDFLib) {
      alert('No se ha podido cargar la librería de PDF (lib/pdf-lib.min.js). Revisa que la carpeta de la aplicación esté completa.');
    }

    // Logo en la cabecera y como icono de la pestaña
    $('#brandLogo').innerHTML = `<img src="${LGA.LOGO_IMAGE}" alt="LGA">`;
    $('#favicon').href = LGA.LOGO_IMAGE;

    sig = LGA.createSignature($('#sigCanvas'), $('#sigHint'), (dataUrl) => {
      if (!current) return;
      current.firma = dataUrl;
      saveNow();
    });

    // Guardadas
    $('#btnNew').addEventListener('click', () => { location.hash = '#/nueva'; });
    $('#search').addEventListener('input', renderList);
    $('#list').addEventListener('click', onListClick);
    $('#btnExport').addEventListener('click', exportBackup);
    // Plantillas rellenables: "normal" y "otro" (opción B). Pendiente de elegir una.
    $$('[data-template]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const name = await LGA.pdf.downloadTemplate({ withOther: btn.dataset.template === 'otro' });
        toast('Plantilla descargada: ' + name, 'ok');
      } catch (err) {
        console.error(err);
        toast('Error al generar la plantilla: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }));
    $('#fileImport').addEventListener('change', (e) => {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });

    // Editor
    const form = $('#form');
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('input', onFormInput);
    form.addEventListener('change', onFormChange);
    $('#view-editor').addEventListener('click', onEditorClick);

    // Persistencia al salir
    window.addEventListener('beforeunload', flushSave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
    window.addEventListener('resize', () => { if (current) sig.resize(); });

    window.addEventListener('hashchange', route);
    route();
  }

  init();
})();
