// Por qué el cliente rechazó una cotización (028_cotizaciones_rechazo_y_detalle.sql),
// en un solo lugar: de aquí salen el ENUM de Drizzle (schema.ts), el z.enum
// del endpoint y la lista que pide el front (GET /cotizaciones/motivos-rechazo).
// El SQL de la migración va escrito a mano; 405-cotizaciones-tablero.spec.ts
// compara el ENUM real de la base contra esta constante.
//
// Sin imports a propósito, igual que clasificaciones.ts: schema.ts lo importa.
// Los valores nuevos van al final (es el orden del ENUM en la base).
export const CLAVES_MOTIVO_RECHAZO = ["precio", "tiempo_entrega", "otro_proveedor", "sin_presupuesto", "ya_no_lo_necesita", "otro"] as const;
export type MotivoRechazoCotizacion = (typeof CLAVES_MOTIVO_RECHAZO)[number];

// Record: si se agrega una clave arriba sin su nombre, no compila.
const NOMBRES: Record<MotivoRechazoCotizacion, string> = {
  precio: "Precio",
  tiempo_entrega: "Tiempo de entrega",
  otro_proveedor: "Eligió otro proveedor",
  sin_presupuesto: "Sin presupuesto",
  ya_no_lo_necesita: "Ya no lo necesita",
  otro: "Otro"
};

export const MOTIVOS_RECHAZO_COTIZACION = CLAVES_MOTIVO_RECHAZO.map((clave) => ({ clave, nombre: NOMBRES[clave] }));
