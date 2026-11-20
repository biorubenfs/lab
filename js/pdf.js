/**
 * Generación del PDF de la solicitud con pdf-lib (sin imprimir desde el navegador).
 *
 * Todo se dibuja con coordenadas, por lo que no aparecen URL, fechas de
 * impresión ni cabeceras/pies del navegador. Incluye:
 *  - cabecera en cada página (título, logo a la derecha, línea horizontal)
 *  - tablas con ajuste de texto por celda, altura de fila automática,
 *    contenido centrado verticalmente y saltos de página (repitiendo encabezados)
 *  - observaciones (pueden ocupar varias páginas) y firma
 *  - numeración "Página X de N"
 *
 * Coordenadas pdf-lib: origen abajo a la izquierda, unidades en puntos (1/72").
 */
(function () {
  'use strict';

  const { PDFDocument, StandardFonts, PDFName, PDFString, rgb } = PDFLib;
  const cfg = LGA.config;
  const store = LGA.store;

  const PAGE = { w: 595.28, h: 841.89 };            // A4 vertical
  const M = { l: 40, r: 40, t: 36, b: 48 };          // márgenes
  const CONTENT_W = PAGE.w - M.l - M.r;

  const COLORS = {
    text: rgb(0.1, 0.12, 0.16),
    muted: rgb(0.45, 0.48, 0.53),
    line: rgb(0.55, 0.58, 0.62),
    brand: rgb(0.239, 0.451, 0.188),     // #3d7330 verde corporativo (títulos)
    brandLogo: rgb(0.380, 0.627, 0.294), // #61a04b verde del logo (línea de cabecera)
    headBg: rgb(0.898, 0.937, 0.878),    // #e5efe0 encabezados de tabla
    labelBg: rgb(0.949, 0.965, 0.941),   // #f2f6f0 etiquetas de datos generales
  };

  // ---------------------------------------------------------------- utilidades

  /** yyyy-mm-dd -> dd/mm/yyyy */
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return y && m && d ? `${d}/${m}/${y}` : String(iso);
  }

  /** Sin acentos, minúsculas, solo [a-z0-9] separados por "_". */
  function slug(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /** AAMMDD_cliente_ubicacion.pdf */
  function fileName(sol) {
    const fecha = String(sol.fechaRecepcion || store.today()).replace(/-/g, '').slice(2);
    return [fecha, slug(sol.cliente), slug(sol.ubicacion)].filter(Boolean).join('_') + '.pdf';
  }

  // ------------------------------------------------------------ escritor de PDF

  class Writer {
    constructor(doc, fonts, logo) {
      this.doc = doc;
      this.f = fonts;
      this.logo = logo;
      // Caracteres que puede escribir Helvetica (WinAnsi: incluye acentos, ñ, º, €...)
      this.charset = new Set(fonts.regular.getCharacterSet());
      this.page = null;
      this.y = 0;
    }

    /** Elimina caracteres que Helvetica no puede escribir (emojis, etc.). */
    clean(s) {
      let out = '';
      for (const ch of String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
        if (ch === '\n' || this.charset.has(ch.codePointAt(0))) out += ch;
      }
      return out;
    }

    /** Divide el texto en líneas que caben en maxW (parte palabras demasiado largas). */
    wrap(text, font, size, maxW) {
      const lines = [];
      for (const para of this.clean(text).split('\n')) {
        const words = para.split(/ +/).filter(Boolean);
        if (!words.length) { lines.push(''); continue; }
        let cur = '';
        for (let w of words) {
          while (font.widthOfTextAtSize(w, size) > maxW) {
            if (cur) { lines.push(cur); cur = ''; }
            let i = 1;
            while (i < w.length && font.widthOfTextAtSize(w.slice(0, i + 1), size) <= maxW) i++;
            lines.push(w.slice(0, i));
            w = w.slice(i);
          }
          if (!w) continue;
          const test = cur ? cur + ' ' + w : w;
          if (font.widthOfTextAtSize(test, size) <= maxW) cur = test;
          else { if (cur) lines.push(cur); cur = w; }
        }
        if (cur) lines.push(cur);
      }
      return lines.length ? lines : [''];
    }

    newPage() {
      this.page = this.doc.addPage([PAGE.w, PAGE.h]);
      this.y = PAGE.h - M.t;
      this.drawHeader();
    }

    /** Si no caben `h` puntos en la página actual, crea otra. Devuelve true si la creó. */
    ensure(h) {
      if (this.y - h < M.b) { this.newPage(); return true; }
      return false;
    }

    drawHeader() {
      const top = PAGE.h - M.t;
      const right = PAGE.w - M.r;
      this.drawLogo(right, top, 46);
      this.page.drawText('SOLICITUD DE ANÁLISIS', {
        x: M.l, y: top - 30, size: 17, font: this.f.bold, color: COLORS.text,
      });
      this.page.drawLine({
        start: { x: M.l, y: top - 56 }, end: { x: right, y: top - 56 },
        thickness: 1.2, color: COLORS.brandLogo,
      });
      this.y = top - 74;
    }

    /** Logo alineado arriba a la derecha, dentro de una caja de alto `h`. */
    drawLogo(right, top, h) {
      if (!this.logo) return;
      const s = Math.min(h / this.logo.height, 140 / this.logo.width);
      const w = this.logo.width * s;
      const hh = this.logo.height * s;
      this.page.drawImage(this.logo, { x: right - w, y: top - hh, width: w, height: hh });
    }

    sectionTitle(text, keepWith) {
      this.ensure(18 + (keepWith || 40)); // no dejar el título solo al final de página
      this.page.drawText(this.clean(text), {
        x: M.l, y: this.y - 11, size: 10, font: this.f.bold, color: COLORS.brand,
      });
      this.y -= 18;
    }

    /**
     * Tabla genérica.
     * @param columns [{header, width}]
     * @param rows    filas de celdas; cada celda es texto o {text, bold, italic, color, bg}
     * @param opts    header, size, headerSize, pad,
     *                minRowHeight: alto mínimo de las filas del cuerpo,
     *                onCell({page, x, y, w, h, row, col}): se llama por cada celda del
     *                cuerpo ya dibujada (la plantilla lo usa para colocar campos).
     */
    table(columns, rows, opts) {
      const o = Object.assign({ header: true, size: 9, headerSize: 8.5, pad: 5, minRowHeight: 0 }, opts);
      const lineH = (s) => s * 1.25;

      const measure = (cells, isHeader) => {
        const items = cells.map((c, i) => {
          const cell = (c && typeof c === 'object') ? c : { text: c };
          const font = (isHeader || cell.bold) ? this.f.bold : (cell.italic ? this.f.italic : this.f.regular);
          const size = isHeader ? o.headerSize : o.size;
          const lines = this.wrap(cell.text == null ? '' : cell.text, font, size, columns[i].width - 2 * o.pad);
          return { cell, font, size, lines };
        });
        const h = Math.max(...items.map((it) => it.lines.length * lineH(it.size))) + 2 * o.pad;
        return { items, h: isHeader ? h : Math.max(h, o.minRowHeight) };
      };

      const drawRow = (row, isHeader, rowIndex) => {
        const top = this.y;
        let x = M.l;
        row.items.forEach((it, i) => {
          const w = columns[i].width;
          const bg = isHeader ? COLORS.headBg : it.cell.bg;
          const rect = { x, y: top - row.h, width: w, height: row.h, borderColor: COLORS.line, borderWidth: 0.6 };
          if (bg) rect.color = bg;
          this.page.drawRectangle(rect);

          // Bloque de texto centrado verticalmente en la celda.
          const L = lineH(it.size);
          const capH = it.size * 0.72; // altura de mayúsculas de Helvetica
          let lineTop = top - (row.h - it.lines.length * L) / 2;
          for (const line of it.lines) {
            if (line) {
              const tw = it.font.widthOfTextAtSize(line, it.size);
              this.page.drawText(line, {
                x: isHeader ? x + (w - tw) / 2 : x + o.pad,
                y: lineTop - L + (L - capH) / 2,
                size: it.size,
                font: it.font,
                color: it.cell.color || COLORS.text,
              });
            }
            lineTop -= L;
          }
          if (!isHeader && o.onCell) {
            o.onCell({ page: this.page, x, y: top - row.h, w, h: row.h, row: rowIndex, col: i });
          }
          x += w;
        });
        this.y -= row.h;
      };

      const head = o.header ? measure(columns.map((c) => c.header), true) : null;
      const body = rows.map((r) => measure(r, false));

      if (head) {
        this.ensure(head.h + (body[0] ? body[0].h : 0)); // encabezado + primera fila juntos
        drawRow(head, true);
      }
      body.forEach((row, i) => {
        if (this.ensure(row.h) && head) drawRow(head, true); // repetir encabezado
        drawRow(row, false, i);
      });
    }

    /** Recuadro de texto libre que puede continuar en páginas siguientes. */
    textBox(text, opts) {
      const o = Object.assign({ size: 9.5, pad: 6 }, opts);
      const font = o.font || this.f.regular;
      const L = o.size * 1.3;
      const capH = o.size * 0.72;
      const lines = this.wrap(text, font, o.size, CONTENT_W - 2 * o.pad);
      while (lines.length) {
        const fit = Math.floor((this.y - M.b - 2 * o.pad) / L);
        if (fit < 1) { this.newPage(); continue; }
        const chunk = lines.splice(0, fit);
        const h = chunk.length * L + 2 * o.pad;
        this.page.drawRectangle({
          x: M.l, y: this.y - h, width: CONTENT_W, height: h, borderColor: COLORS.line, borderWidth: 0.6,
        });
        let lineTop = this.y - o.pad;
        for (const line of chunk) {
          if (line) {
            this.page.drawText(line, {
              x: M.l + o.pad, y: lineTop - L + (L - capH) / 2, size: o.size, font, color: o.color || COLORS.text,
            });
          }
          lineTop -= L;
        }
        this.y -= h;
        if (lines.length) this.newPage();
      }
    }

    /** Recuadro de firma con la imagen ajustada y el nombre debajo. */
    signature(img, name) {
      const boxW = 230;
      const boxH = 95;
      const pad = 6;
      this.ensure(boxH + 18);
      const top = this.y;
      this.page.drawRectangle({
        x: M.l, y: top - boxH, width: boxW, height: boxH, borderColor: COLORS.line, borderWidth: 0.6,
      });
      if (img) {
        const s = Math.min((boxW - 2 * pad) / img.width, (boxH - 2 * pad) / img.height);
        const w = img.width * s;
        const h = img.height * s;
        this.page.drawImage(img, { x: M.l + (boxW - w) / 2, y: top - boxH + (boxH - h) / 2, width: w, height: h });
      } else {
        const t = 'Sin firma';
        const tw = this.f.italic.widthOfTextAtSize(t, 9);
        this.page.drawText(t, { x: M.l + (boxW - tw) / 2, y: top - boxH / 2 - 3, size: 9, font: this.f.italic, color: COLORS.muted });
      }
      this.y -= boxH;
      if (name) {
        const lines = this.wrap(name, this.f.regular, 8.5, boxW);
        this.page.drawText(lines[0], { x: M.l, y: this.y - 12, size: 8.5, font: this.f.regular, color: COLORS.muted });
      }
      this.y -= 18;
    }

    pageNumbers() {
      const pages = this.doc.getPages();
      pages.forEach((p, i) => {
        const t = `Página ${i + 1} de ${pages.length}`;
        const tw = this.f.regular.widthOfTextAtSize(t, 8);
        p.drawText(t, { x: (PAGE.w - tw) / 2, y: 24, size: 8, font: this.f.regular, color: COLORS.muted });
      });
    }
  }

  // --------------------------------------------------------- contenido del PDF

  const muted = (text) => ({ text, color: COLORS.muted });
  const value = (t) => (String(t == null ? '' : t).trim() ? String(t) : muted('—'));
  const label = (t) => ({ text: t, bold: true, bg: COLORS.labelBg });

  function inSituText(m) {
    if (m.matriz !== cfg.matrizConInSitu) return muted('—');
    const parts = cfg.inSitu
      .filter((f) => String((m.inSitu && m.inSitu[f.key]) || '').trim())
      .map((f) => `${f.short}: ${String(m.inSitu[f.key]).trim()}${f.unidad ? ' ' + f.unidad : ''}`);
    return parts.length ? parts.join('\n') : { text: 'Sin datos', italic: true, color: COLORS.muted };
  }

  async function embedImage(doc, dataUrl) {
    if (!dataUrl) return null;
    try {
      return /^data:image\/jpe?g/i.test(dataUrl) ? await doc.embedJpg(dataUrl) : await doc.embedPng(dataUrl);
    } catch (e) {
      console.error('No se pudo incrustar la imagen', e);
      return null;
    }
  }

  /** Documento nuevo con metadatos, fuentes, logo y la primera página. */
  async function createDocument(title) {
    const doc = await PDFDocument.create();
    doc.setTitle(title);
    doc.setAuthor('LGA');
    doc.setCreator('LGA Solicitudes');
    doc.setProducer('LGA Solicitudes');
    const fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    };
    const logo = await embedImage(doc, LGA.LOGO_IMAGE);
    const w = new Writer(doc, fonts, logo);
    w.newPage();
    return { doc, fonts, w };
  }

  /** Genera el PDF y devuelve { bytes, fileName }. */
  async function generate(sol) {
    const { doc, w } = await createDocument('Solicitud de análisis' + (sol.cliente ? ' - ' + sol.cliente : ''));
    const firma = await embedImage(doc, sol.firma);

    // Datos generales
    w.sectionTitle('Datos de la solicitud');
    const lw = 95;
    const vw = (CONTENT_W - 2 * lw) / 2;
    w.table(
      [{ width: lw }, { width: vw }, { width: lw }, { width: vw }],
      [
        [label('Cliente'), value(sol.cliente), label('Persona que entrega'), value(sol.personaEntrega)],
        [label('Fecha recepción'), value(fmtDate(sol.fechaRecepcion)), label('Fecha toma'), value(fmtDate(sol.fechaToma))],
        [label('Nº de muestras'), String(sol.muestras.length), label('Ubicación'), value(sol.ubicacion)],
      ],
      { header: false }
    );
    w.y -= 16;

    // Muestras
    const base = [
      { header: 'Nº Nevis', width: 72 },
      { header: 'Punto de muestreo', width: 105 },
      { header: 'Hora toma', width: 50 },
      { header: 'Matriz', width: 78 },
      { header: 'Análisis solicitado', width: 115 },
      { header: 'Datos in situ', width: 100 },
    ];
    const k = CONTENT_W / base.reduce((a, c) => a + c.width, 0);
    const columns = base.map((c) => ({ header: c.header, width: c.width * k }));
    const rows = sol.muestras.map((m) => [
      String(m.nevis || '').trim() ? m.nevis : { text: 'Pendiente', italic: true, color: COLORS.muted },
      value(m.punto),
      value(m.horaToma),
      value(store.matrizLabel(m)),
      value(store.analisisLabel(m)),
      inSituText(m),
    ]);
    w.sectionTitle(`Muestras (${sol.muestras.length})`, 60);
    w.table(columns, rows);
    w.y -= 16;

    // Observaciones
    w.sectionTitle('Observaciones', 30);
    const obs = String(sol.observaciones || '').trim();
    if (obs) w.textBox(obs);
    else w.textBox('—', { color: COLORS.muted });
    w.y -= 16;

    // Firma
    w.sectionTitle('Firma de la persona que entrega', 113);
    w.signature(firma, sol.personaEntrega);

    w.pageNumbers();
    return { bytes: await doc.save(), fileName: fileName(sol) };
  }

  // ------------------------------------------------------ plantilla rellenable

  const TEMPLATE_ROWS = 10;

  /**
   * Plantilla PDF en blanco con campos de formulario (AcroForm) rellenables
   * desde cualquier visor de PDF: misma estructura que la solicitud (sin firma), con
   * 10 filas de muestras y columna Nº muestra. Todo en una página.
   *
   * Dos variantes (pendiente de decidir con cuál nos quedamos):
   *  - normal: Matriz y Análisis son desplegables editables (se puede escribir
   *    un valor que no esté en la lista), sin opción "Otra"/"Otro".
   *  - withOther (opción B): desplegables no editables con "Otra" (matriz) y
   *    "Otro" (análisis) y, debajo, en la misma celda, un campo "Otra:"/"Otro:"
   *    siempre visible para el texto libre.
   *
   * Devuelve { bytes, fileName }.
   */
  async function generateTemplate(opts) {
    const withOther = !!(opts && opts.withOther);
    const { doc, fonts, w } = await createDocument('Solicitud de análisis (plantilla)');
    const form = doc.getForm();
    const FIELD_BG = rgb(0.961, 0.976, 0.949); // #f5f9f2 tono suave para distinguir los campos
    const fontSizes = new Map(); // tamaño previsto de cada campo (0 = automático)

    /** Coloca un widget dentro de la celda dejando 1 pt para el borde de la tabla. */
    const place = (field, c) => field.addToPage(c.page, {
      x: c.x + 1, y: c.y + 1, width: c.w - 2, height: c.h - 2,
      font: fonts.regular, textColor: COLORS.text, backgroundColor: FIELD_BG, borderWidth: 0,
    });
    const textField = (name, c, opts) => {
      const o = Object.assign({ size: 9, multiline: false }, opts);
      const f = form.createTextField(name);
      if (o.multiline) f.enableMultiline();
      place(f, c);
      f.setFontSize(o.size);
      fontSizes.set(name, o.size);
      return f;
    };
    const dropdown = (name, options, c, editable) => {
      const f = form.createDropdown(name);
      f.addOptions(options);
      if (editable) f.enableEditing(); // permite escribir un valor que no esté en la lista
      place(f, c);
      f.setFontSize(8);
      fontSizes.set(name, 8);
      return f;
    };

    /**
     * Opción B: celda dividida en dos, arriba el desplegable (con "Otra"/"Otro")
     * y debajo un campo de texto siempre visible con la etiqueta "Otra:"/"Otro:" para el
     * valor libre. Funciona en cualquier visor (sin JavaScript) y sobre papel.
     */
    const choiceWithOther = (name, options, otherLabel, c) => {
      const half = c.h / 2;
      dropdown(name, options, Object.assign({}, c, { y: c.y + half, h: half }), false);
      c.page.drawLine({
        start: { x: c.x, y: c.y + half }, end: { x: c.x + c.w, y: c.y + half },
        thickness: 0.4, color: COLORS.line, dashArray: [2, 2],
      });
      const label = otherLabel + ':';
      const size = 7;
      const labelW = fonts.regular.widthOfTextAtSize(label, size) + 6;
      c.page.drawText(label, {
        x: c.x + 3, y: c.y + (half - size * 0.72) / 2, size, font: fonts.regular, color: COLORS.muted,
      });
      textField(`${name}_otro`, Object.assign({}, c, { x: c.x + labelW, w: c.w - labelW, h: half }), { size: 7.5 });
    };

    // Datos generales: campos en las columnas de valor (1 y 3)
    w.sectionTitle('Datos de la solicitud');
    const lw = 95;
    const vw = (CONTENT_W - 2 * lw) / 2;
    const generalNames = [
      ['cliente', 'persona_entrega'],
      ['fecha_recepcion', 'fecha_toma'],
      ['num_muestras', 'ubicacion'],
    ];
    w.table(
      [{ width: lw }, { width: vw }, { width: lw }, { width: vw }],
      [
        [label('Cliente'), '', label('Persona que entrega'), ''],
        [label('Fecha recepción'), '', label('Fecha toma'), ''],
        [label('Nº de muestras'), '', label('Ubicación'), ''],
      ],
      {
        header: false,
        minRowHeight: 22,
        onCell: (c) => { if (c.col % 2) textField(generalNames[c.row][(c.col - 1) / 2], c); },
      }
    );
    w.y -= 16;

    // Muestras: 10 filas, con columna Nº muestra
    const base = [
      { header: 'Nº muestra', width: 46, field: 'numero' },
      { header: 'Nº Nevis', width: 62, field: 'nevis' },
      { header: 'Punto de muestreo', width: withOther ? 88 : 92, field: 'punto' },
      { header: 'Hora toma', width: 42, field: 'hora' },
      { header: 'Matriz', width: withOther ? 80 : 72, field: 'matriz' },
      { header: 'Análisis solicitado', width: 99, field: 'analisis' },
      { header: 'Datos in situ', width: withOther ? 98 : 102, field: 'insitu' },
    ];
    const k = CONTENT_W / base.reduce((a, c) => a + c.width, 0);
    const columns = base.map((c) => ({ header: c.header, width: c.width * k }));
    // Variante normal: "Otra"/"Otro" sobra porque los desplegables admiten texto libre
    const matrices = cfg.matrices.filter((a) => a !== cfg.matrizOtro);
    const analisis = cfg.analisis.filter((a) => a !== cfg.analisisOtros);
    w.sectionTitle('Muestras', 60);
    w.table(columns, Array.from({ length: TEMPLATE_ROWS }, () => columns.map(() => '')), {
      minRowHeight: withOther ? 40 : 36, // opción B: dos mitades de 20 pt
      onCell: (c) => {
        const name = `muestra_${c.row + 1}_${base[c.col].field}`;
        if (base[c.col].field === 'matriz') {
          if (withOther) choiceWithOther(name, cfg.matrices, cfg.matrizOtro, c);
          else dropdown(name, matrices, c, true);
        } else if (base[c.col].field === 'analisis') {
          if (withOther) choiceWithOther(name, cfg.analisis, cfg.analisisOtros, c);
          else dropdown(name, analisis, c, true);
        }
        else if (base[c.col].field === 'insitu') textField(name, c, { multiline: true, size: 7 });   // hasta 4 líneas
        // Multilínea para nombres largos (los visores alinean arriba este tipo de campo).
        else if (base[c.col].field === 'punto') textField(name, c, { multiline: true, size: 8 });
        else textField(name, c, { size: 8.5 });
      },
    });
    w.y -= 14;

    // Observaciones (la plantilla no lleva firma), a todo el ancho
    const boxH = withOther ? 85 : 100; // opción B: más bajo para caber en una página
    w.sectionTitle('Observaciones', boxH);
    const obsCell = { page: w.page, x: M.l, y: w.y - boxH, w: CONTENT_W, h: boxH };
    w.page.drawRectangle({ x: obsCell.x, y: obsCell.y, width: obsCell.w, height: obsCell.h, borderColor: COLORS.line, borderWidth: 0.6 });
    textField('observaciones', obsCell, { multiline: true, size: 9 });
    w.y -= boxH;

    w.pageNumbers();

    // Apariencia inicial de los campos con nuestra Helvetica (evita incrustar otra).
    form.updateFieldAppearances(fonts.regular);

    // Declarar en el formulario la fuente de los campos (/DR) y hacer que todos
    // la usen (/Helv, Helvetica con codificación WinAnsi: tildes, ñ, º...) con su
    // tamaño previsto (updateFieldAppearances sustituye el 0 automático por un
    // tamaño fijo, así que se vuelve a escribir aquí).
    // Sin esto, cuando el usuario rellena un campo el visor no encuentra la
    // fuente con la que redibujarlo y puede no mostrar el valor elegido
    // (p. ej. "Análisis de control" en los desplegables).
    const acro = form.acroForm.dict;
    acro.set(PDFName.of('DR'), doc.context.obj({ Font: { Helv: fonts.regular.ref } }));
    acro.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'));
    const c = COLORS.text;
    const color = `${c.red} ${c.green} ${c.blue} rg`;
    for (const field of form.getFields()) {
      const da = `${color} /Helv ${fontSizes.get(field.getName())} Tf`;
      field.acroField.setDefaultAppearance(da);
      for (const widget of field.acroField.getWidgets()) widget.setDefaultAppearance(da);
    }

    const bytes = await doc.save({ updateFieldAppearances: false });
    return {
      bytes,
      fileName: withOther ? 'plantilla_solicitud_analisis_otro.pdf' : 'plantilla_solicitud_analisis.pdf',
    };
  }

  /** Descarga unos bytes PDF con el nombre indicado. */
  function saveBytes(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return name;
  }

  /** Genera y descarga el PDF de una solicitud. Devuelve el nombre del fichero. */
  async function download(sol) {
    const { bytes, fileName: name } = await generate(sol);
    return saveBytes(bytes, name);
  }

  /** Genera y descarga la plantilla rellenable ({withOther} = opción B). Devuelve el nombre. */
  async function downloadTemplate(opts) {
    const { bytes, fileName: name } = await generateTemplate(opts);
    return saveBytes(bytes, name);
  }

  LGA.pdf = { generate, generateTemplate, download, downloadTemplate, fileName, slug };
})();
