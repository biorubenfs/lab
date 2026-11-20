/**
 * Almacenamiento local de solicitudes (localStorage).
 *
 * Todas las solicitudes se guardan como un array JSON bajo una única clave.
 * Los datos viven solo en este navegador y en este PC: si se borran los datos
 * de navegación se pierden, por eso existe Exportar/Importar copia.
 */
(function () {
  'use strict';

  const KEY = 'lga.solicitudes.v1';
  const cfg = LGA.config;

  /** Fecha local de hoy en formato yyyy-mm-dd (el de <input type="date">). */
  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function uid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* contexto no seguro: usamos la alternativa */ }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function emptyInSitu() {
    const o = {};
    cfg.inSitu.forEach((f) => { o[f.key] = ''; });
    return o;
  }

  /**
   * Nueva muestra. Si se pasa `base`, copia matriz y análisis
   * (comportamiento de "Añadir muestra" y de "Duplicar").
   */
  function newMuestra(base) {
    return {
      nevis: '',
      punto: '',
      horaToma: '',         // cada muestra se toma a una hora concreta
      matriz: (base && base.matriz) || '',
      matrizOtro: (base && base.matrizOtro) || '',
      analisis: (base && base.analisis) || '',
      analisisOtro: (base && base.analisisOtro) || '',
      inSitu: emptyInSitu(),
    };
  }

  /** Nueva solicitud vacía (aún no guardada). */
  function create() {
    const now = new Date().toISOString();
    return {
      id: uid(),
      createdAt: now,
      updatedAt: now,
      cliente: '',
      personaEntrega: '',
      fechaRecepcion: today(),
      fechaToma: '',
      ubicacion: '',
      observaciones: '',
      firma: null,          // PNG en data URL
      muestras: [newMuestra()],
      pdfGeneradoEn: null,  // fecha ISO del último PDF generado
      esPlantilla: false,   // true = plantilla reutilizable (no es una solicitud real)
      nombrePlantilla: '',
    };
  }

  /**
   * Completa campos que falten (datos antiguos o importados) y migra
   * versiones anteriores:
   *  - la hora de toma general pasa a las muestras que no tengan hora
   *  - se elimina el antiguo "Nº muestra"
   *  - valores antiguos de texto libre: matriz "Otro" -> "Otra", análisis "Otros" -> "Otro"
   */
  function normalize(sol) {
    const s = Object.assign(create(), sol);
    const horaGeneral = String(s.horaToma || '').trim();
    delete s.horaToma;
    s.muestras = (Array.isArray(sol.muestras) ? sol.muestras : []).map((m) => {
      const n = Object.assign(newMuestra(), m);
      n.inSitu = Object.assign(emptyInSitu(), m && m.inSitu);
      if (!n.horaToma && horaGeneral) n.horaToma = horaGeneral;
      delete n.numMuestra;
      if (n.matriz === 'Otro') n.matriz = cfg.matrizOtro;
      if (n.analisis === 'Otros') n.analisis = cfg.analisisOtros;
      return n;
    });
    if (!s.muestras.length) s.muestras.push(newMuestra());
    if (s.esPlantilla) s.firma = null; // las plantillas no guardan firma (también las antiguas)
    return s;
  }

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('No se pudo leer el almacenamiento', e);
      return [];
    }
  }

  /** Puede lanzar QuotaExceededError: quien llama debe capturarlo. */
  function writeAll(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function all() {
    return readAll().map(normalize);
  }

  function get(id) {
    const s = readAll().find((x) => x.id === id);
    return s ? normalize(s) : null;
  }

  /** Inserta o actualiza. `touch:false` conserva updatedAt. */
  function save(sol, opts) {
    const touch = !opts || opts.touch !== false;
    if (touch) sol.updatedAt = new Date().toISOString();
    const list = readAll();
    const copy = JSON.parse(JSON.stringify(sol));
    const i = list.findIndex((x) => x.id === sol.id);
    if (i >= 0) list[i] = copy; else list.push(copy);
    writeAll(list);
  }

  function remove(id) {
    writeAll(readAll().filter((x) => x.id !== id));
  }

  /**
   * Duplicar: copia cliente, ubicación y, de cada muestra, matriz y análisis.
   * No copia firma ni números Nevis. Fecha de recepción = hoy.
   * (Pendiente de confirmar con el cliente qué más debe copiarse.)
   */
  function duplicate(id) {
    const src = get(id);
    if (!src) return null;
    const d = create();
    d.cliente = src.cliente;
    d.ubicacion = src.ubicacion;
    d.muestras = src.muestras.map((m) => newMuestra(m));
    save(d);
    return d;
  }

  /**
   * Copia de una solicitud sin los datos que cambian en cada entrega:
   * fechas de recepción y de toma, firma, y Nº Nevis y hora de toma de cada
   * muestra. Se conserva todo lo demás (cliente, persona, ubicación,
   * observaciones y el resto de datos de las muestras).
   */
  function reusableCopy(src) {
    const d = create(); // firma: null
    for (const k of ['cliente', 'personaEntrega', 'ubicacion', 'observaciones']) d[k] = src[k];
    d.fechaRecepcion = '';
    d.fechaToma = '';
    d.muestras = src.muestras.map((m) => Object.assign(JSON.parse(JSON.stringify(m)), { nevis: '', horaToma: '' }));
    return d;
  }

  /** Guarda una plantilla nueva a partir de una solicitud. La solicitud no cambia. */
  function saveAsTemplate(src, nombre) {
    const t = reusableCopy(src);
    t.esPlantilla = true;
    t.nombrePlantilla = nombre;
    save(t);
    return t;
  }

  /** Crea y guarda una solicitud nueva a partir de una plantilla (recepción = hoy). */
  function fromTemplate(id) {
    const t = get(id);
    if (!t) return null;
    const s = reusableCopy(t);
    s.fechaRecepcion = today();
    save(s);
    return s;
  }

  /** ¿La muestra tiene datos propios? (matriz y análisis cuentan como plantilla) */
  function sampleHasData(m) {
    return !!(
      String(m.nevis || '').trim() ||
      String(m.punto || '').trim() ||
      String(m.horaToma || '').trim() ||
      Object.values(m.inSitu || {}).some((v) => String(v).trim())
    );
  }

  /** Solicitud sin nada introducido (no merece la pena guardarla). */
  function isBlank(sol) {
    const general = ['cliente', 'personaEntrega', 'ubicacion', 'observaciones', 'fechaToma']
      .some((k) => String(sol[k] || '').trim());
    return !general && !sol.firma &&
      sol.muestras.every((m) => !sampleHasData(m) && !m.matriz && !m.analisis);
  }

  /** Estado de los números Nevis: cuántas muestras lo tienen. */
  function nevisStatus(sol) {
    const muestras = sol.muestras || [];
    const total = muestras.length;
    const done = muestras.filter((m) => String(m.nevis || '').trim()).length;
    return { total, done, complete: total > 0 && done === total };
  }

  /** Texto de la matriz tal y como debe mostrarse (resuelve "Otra"). */
  function matrizLabel(m) {
    if (m.matriz === cfg.matrizOtro) {
      return String(m.matrizOtro || '').trim() || cfg.matrizOtro;
    }
    return m.matriz || '';
  }

  /** Texto del análisis tal y como debe mostrarse (resuelve "Otro"). */
  function analisisLabel(m) {
    if (m.analisis === cfg.analisisOtros) {
      return String(m.analisisOtro || '').trim() || cfg.analisisOtros;
    }
    return m.analisis || '';
  }

  /** Contenido del fichero de copia de seguridad. */
  function exportData() {
    return {
      app: 'lga-solicitudes',
      version: 1,
      exportadoEn: new Date().toISOString(),
      solicitudes: readAll(),
    };
  }

  /** Importa una copia. Si un id ya existe, gana la versión más reciente. */
  function importData(data) {
    const arr = Array.isArray(data) ? data : data && data.solicitudes;
    if (!Array.isArray(arr)) throw new Error('El fichero no es una copia válida');
    const list = readAll();
    let added = 0;
    let updated = 0;
    for (const s of arr) {
      if (!s || typeof s !== 'object' || !s.id || !Array.isArray(s.muestras)) continue;
      const i = list.findIndex((x) => x.id === s.id);
      if (i < 0) { list.push(s); added++; }
      else if (String(s.updatedAt || '') > String(list[i].updatedAt || '')) { list[i] = s; updated++; }
    }
    writeAll(list);
    return { added, updated };
  }

  LGA.store = {
    today, create, newMuestra, all, get, save, remove, duplicate, saveAsTemplate, fromTemplate,
    sampleHasData, isBlank, nevisStatus, matrizLabel, analisisLabel, exportData, importData,
  };
})();
