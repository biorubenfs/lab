/**
 * Configuración editable de la aplicación.
 * Aquí se cambian las listas (matrices, análisis…) sin tocar el resto del código.
 */
window.LGA = window.LGA || {};

LGA.config = {
  /** Matrices disponibles en el desplegable. */
  matrices: [
    'Consumo',
    'Residual',
    'Biológico',
    'Agua continental no tratada',
    'Piscina',
    'Otra',
  ],

  /** Valor de la matriz que habilita un campo de texto libre. */
  matrizOtro: 'Otra',

  /** Matriz que muestra los campos de datos in situ. */
  matrizConInSitu: 'Consumo',

  /**
   * Análisis disponibles. Se muestran en orden alfabético (se ordenan solos
   * más abajo), con "Otro" siempre al final: añadir o quitar aquí sin
   * preocuparse del orden. "Otro" habilita un campo de texto libre.
   */
  analisis: [
    'Parámetros habituales',
    'Según solicitud',
    'Análisis de control',
    'Análisis de grifo',
    'Análisis completo',
    'Control Operacional',
    'Cierre SINAC',
  ],

  /** Valor del análisis que habilita el texto libre. */
  analisisOtros: 'Otro',

  /** Campos in situ (solo matriz Consumo). `short` es la etiqueta del PDF. */
  inSitu: [
    { key: 'temperatura', label: 'Temperatura', unidad: 'ºC', short: 'T' },
    { key: 'cloroLibre', label: 'Cloro libre', unidad: 'mg/L', short: 'Cl libre' },
    { key: 'cloroTotal', label: 'Cloro total', unidad: 'mg/L', short: 'Cl total' },
    { key: 'ph', label: 'pH', unidad: '', short: 'pH' },
  ],

  /** Atajo de residuales: puntos que se crean, todos con matriz Residual. */
  atajoResidual: { matriz: 'Residual', puntos: ['Entrada', 'Salida', 'Biológico'] },
};

// Orden alfabético en español (ignora mayúsculas y tildes) y "Otro" al final.
LGA.config.analisis = LGA.config.analisis
  .filter((a) => a !== LGA.config.analisisOtros)
  .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  .concat(LGA.config.analisisOtros);
