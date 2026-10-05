// Dinero en centavos enteros: copia de src/comercial/dinero.ts del backend
// (D1, 5-oct-2026). Con decimales de JavaScript 0.5 × 2.01 da 1.00499… y
// salía 1.00 en vez de 1.01; el total que se muestra antes de guardar debe
// ser el mismo que calcula el backend. Lo que manda es lo que él devuelve.

/** ¿El número tiene a lo más 2 decimales? (lo que cabe en DECIMAL(x,2)). */
export function tieneMaxDosDecimales(valor: number): boolean {
  return Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;
}

export function aCentavos(valor: number): number {
  return Math.round(valor * 100);
}

/** Cantidad × precio de una línea, en centavos, con la mitad hacia arriba. */
export function importeEnCentavos(cantidad: number, precioUnitario: number): number {
  const diezmilesimos = BigInt(aCentavos(cantidad)) * BigInt(aCentavos(precioUnitario));
  return Number((diezmilesimos + 50n) / 100n);
}

/** La cuenta completa de una cotización, en centavos. */
export function calcularCotizacion(partidas: { cantidad: number; precioUnitario: number }[], descuento: number, impuestos: number) {
  const subtotal = partidas.reduce((acc, p) => acc + importeEnCentavos(p.cantidad, p.precioUnitario), 0);
  const total = subtotal - aCentavos(descuento) + aCentavos(impuestos);
  return { subtotal, total };
}
