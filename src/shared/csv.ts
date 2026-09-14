// Exportación de reportes en CSV (PLAN_CRM_DEFINITIVO.md #9, "Exportación
// de reportes"). El proyecto no tiene ninguna convención previa de
// exportación (ningún otro módulo genera CSV ni Excel), así que se define
// aquí desde cero: CSV simple con cabecera, separador "," y comillas dobles
// alrededor de cualquier valor que contenga coma, comilla o salto de línea
// (regla estándar RFC 4180). Se eligió CSV sobre Excel porque no agrega
// dependencias nuevas (no hay ninguna librería de generación de .xlsx en
// package.json) y cualquier hoja de cálculo lo abre sin conversión.
const UTF8_BOM = "﻿";

// `headers` es obligatorio pasarlo cuando `rows` puede llegar vacío (ej.
// un reporte sin resultados en el rango de fechas pedido): antes, sin
// filas no había de dónde sacar Object.keys(rows[0]) y toCsv devolvía
// "" -- ni BOM ni encabezado, a diferencia de cualquier exportación con
// datos (hallazgo de code review, 14-sep-2026). Si `rows` sí trae datos,
// `headers` es opcional y se sigue infiriendo de la primera fila como
// antes.
export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const columnas = rows.length > 0 ? Object.keys(rows[0]) : headers;
  if (!columnas) return "";
  const lines = [columnas.join(",")];
  for (const row of rows) {
    lines.push(columnas.map((columna) => escapeCsvValue(row[columna])).join(","));
  }
  // BOM UTF-8 al inicio: Excel en Windows detecta la codificación y los
  // acentos ("Título", "Región") no se rompen al abrir el archivo.
  return UTF8_BOM + lines.join("\r\n");
}

// Un valor que empieza con "=", "+", "-" o "@" se interpreta como fórmula
// al abrir el CSV en Excel/Sheets (CSV/formula injection, OWASP). El
// reporte de actividades incluye usuarios.nombre tal cual viene de la BD
// (hallazgo de code review, 11-sep-2026) -- anteponer un apóstrofo fuerza
// esos valores a texto plano sin cambiar lo que el usuario ve.
const FORMULA_TRIGGER = /^[=+\-@]/;

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (FORMULA_TRIGGER.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
