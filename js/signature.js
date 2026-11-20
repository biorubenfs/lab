/**
 * Firma digital sobre <canvas>: ratón, lápiz y pantalla táctil (Pointer Events).
 *
 * La firma se exporta como PNG transparente recortado al trazo, para que ocupe
 * poco en localStorage y se coloque bien en el PDF.
 */
(function () {
  'use strict';

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} hintEl   texto "Firme aquí" (se oculta al firmar)
   * @param {(dataUrl: string|null) => void} onChange
   */
  LGA.createSignature = function (canvas, hintEl, onChange) {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let last = null;
    let current = null; // data URL de la firma actual

    function setupPen() {
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f2340';
      ctx.fillStyle = '#0f2340';
    }

    function updateHint(hasInk) {
      if (hintEl) hintEl.hidden = !!hasInk;
    }

    /** Ajusta la resolución interna del canvas a su tamaño en pantalla. */
    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return false; // vista oculta
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setupPen();
      redraw();
      return true;
    }

    function clearCanvas() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    /** Pinta la firma guardada centrada en el canvas. */
    function redraw() {
      clearCanvas();
      updateHint(!!current);
      if (!current) return;
      const src = current;
      const img = new Image();
      img.onload = () => {
        if (src !== current) return; // cambió mientras cargaba
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const s = Math.min(1 / dpr, (r.width - 16) / img.width, (r.height - 16) / img.height);
        const w = img.width * s;
        const h = img.height * s;
        ctx.drawImage(img, (r.width - w) / 2, (r.height - h) / 2, w, h);
      };
      img.src = src;
    }

    /** Recorta el trazo y lo exporta como PNG. */
    function exportImage() {
      try {
        const w = canvas.width;
        const h = canvas.height;
        const data = ctx.getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 0) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) {
          current = null;
        } else {
          const pad = 6;
          minX = Math.max(0, minX - pad);
          minY = Math.max(0, minY - pad);
          maxX = Math.min(w - 1, maxX + pad);
          maxY = Math.min(h - 1, maxY + pad);
          const cw = maxX - minX + 1;
          const ch = maxY - minY + 1;
          const out = document.createElement('canvas');
          out.width = cw;
          out.height = ch;
          out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
          current = out.toDataURL('image/png');
        }
      } catch (err) {
        console.error('No se pudo recortar la firma', err);
        current = canvas.toDataURL('image/png');
      }
      onChange(current);
    }

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      ctx.beginPath();
      ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      updateHint(true);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      for (const ev of (events.length ? events : [e])) {
        const p = pos(ev);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
      }
    });

    function end(e) {
      if (!drawing) return;
      drawing = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ya liberado */ }
      exportImage();
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    return {
      resize,
      /** Carga una firma guardada (o null). */
      load(dataUrl) {
        current = dataUrl || null;
        if (!resize()) redraw();
      },
      clear() {
        current = null;
        redraw();
        onChange(null);
      },
    };
  };
})();
