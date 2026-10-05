// Dinero en centavos enteros (D1 del plan de fixes, 5-oct-2026). Antes las
// cotizaciones se calculaban con decimales de JavaScript y toFixed(2):
// 0.5 × 2.01 da 1.00499999… y salía 1.00 en vez de 1.01. Toda la cuenta
// (la de calcular() y la de la validación) pasa por aquí para que las dos
// den exactamente lo mismo.
//
// Los montos de entrada traen a lo más 2 decimales (lo valida Zod con
// tieneMaxDosDecimales), así que pasarlos a centavos con Math.round es
// exacto.

/** ¿El número tiene a lo más 2 decimales? (lo que cabe en DECIMAL(x,2)). */
export function tieneMaxDosDecimales(valor: number): boolean {
  return Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;
}

export function aCentavos(valor: number): number {
  return Math.round(valor * 100);
}

/**
 * Importe de una línea en centavos: cantidad × precio, redondeado a
 * centavos con la mitad hacia arriba. La multiplicación va en BigInt:
 * centavos × centavos puede pasar de 2^53 y perder exactitud.
 */
export function importeEnCentavos(cantidad: number, precioUnitario: number): number {
  // Cantidad y precio en centavos: el producto queda en diezmilésimos.
  const diezmilesimos = BigInt(aCentavos(cantidad)) * BigInt(aCentavos(precioUnitario));
  return Number((diezmilesimos + 50n) / 100n);
}

/** Centavos a texto con 2 decimales, como lo guarda una columna DECIMAL. */
export function deCentavos(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  const absoluto = Math.abs(centavos);
  return `${signo}${Math.floor(absoluto / 100)}.${String(absoluto % 100).padStart(2, "0")}`;
}

/** La cuenta completa de una cotización, en centavos. */
export function calcularCotizacion(partidas: { cantidad: number; precioUnitario: number }[], descuento: number, impuestos: number) {
  const importes = partidas.map((p) => importeEnCentavos(p.cantidad, p.precioUnitario));
  const subtotal = importes.reduce((acc, importe) => acc + importe, 0);
  const total = subtotal - aCentavos(descuento) + aCentavos(impuestos);
  return { importes, subtotal, total };
}
