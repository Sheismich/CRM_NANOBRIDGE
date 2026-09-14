// Exportación de reportes en CSV (PLAN_CRM_DEFINITIVO.md #9, "Exportación
// de reportes"). El proyecto no tiene ninguna convención previa de
// exportación (ningún otro módulo genera CSV ni Excel), así que se define
// aquí desde cero: CSV simple con cabecera, separador "," y comillas dobles
// alrededor de cualquier valor que contenga coma, comilla o salto de línea
// (regla estándar RFC 4180). Se eligió CSV sobre Excel porque no agrega
// dependencias nuevas (no hay ninguna librería de generación de .xlsx en
// package.json) y cualquier hoja de cálculo lo abre sin conversión.
const UTF8_BOM = "﻿";

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(","));
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

// Importación de prospectos (PLAN_CRM_DEFINITIVO.md #3, "importación
// CSV"). Parser manual (RFC 4180) en vez de una librería nueva, por el
// mismo motivo que toCsv() no usa una para exportar: nada más en el
// proyecto parsea CSV todavía, así que no vale la pena la dependencia
// nueva para un formato de por sí simple. Soporta comillas dobles,
// comas dentro de campos citados y comillas escapadas ("").
export function parseCsv(contenido: string): Record<string, string>[] {
  // Quita el BOM UTF-8 si viene (el mismo que escribe toCsv, o el que
  // agrega Excel al exportar "CSV UTF-8" -- sin esto, el primer header
  // queda con el BOM pegado y nunca hace match por nombre de columna).
  const texto = contenido.replace(/^\uFEFF/, "");
  const filas = parseCsvFilas(texto);
  if (filas.length === 0) return [];

  const headers = filas[0]!.map((h) => h.trim());
  return filas.slice(1)
    .filter((fila) => fila.some((valor) => valor.trim() !== "")) // ignora líneas en blanco al final del archivo
    .map((fila) => {
      const row: Record<string, string> = {};
      headers.forEach((header, i) => {
        row[header] = (fila[i] ?? "").trim();
      });
      return row;
    });
}

function parseCsvFilas(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let dentroDeComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const char = texto[i];

    if (dentroDeComillas) {
      if (char === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++; // comilla escapada ("") -> una sola comilla literal
        } else {
          dentroDeComillas = false;
        }
      } else {
        campo += char;
      }
      continue;
    }

    if (char === '"') {
      dentroDeComillas = true;
    } else if (char === ",") {
      fila.push(campo);
      campo = "";
    } else if (char === "\r") {
      // se ignora; \n (solo o precedido de \r) cierra la fila
    } else if (char === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += char;
    }
  }

  // última fila sin salto de línea final
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
}
