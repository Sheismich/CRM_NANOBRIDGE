-- Cotizaciones del rediseño (bloque 2, 12-oct-2026).
--
-- Motivo de rechazo: la pantalla nueva dice "Rechazada · Motivo: precio" y
-- antes no se guardaba por qué el cliente dijo que no, así que tampoco se
-- podía contar cuántas se perdieron por precio. Clave de una lista corta
-- (shared/motivos-rechazo-cotizacion.ts) + explicación libre, igual que el
-- motivo de pérdida de una oportunidad. NULL: las rechazadas de antes no lo
-- tienen, y por ahora es opcional (el front publicado no lo manda).
--
-- Columnas NULL al final: MySQL 8 las agrega sin reescribir la tabla.
ALTER TABLE cotizaciones
  ADD COLUMN motivo_rechazo ENUM('precio', 'tiempo_entrega', 'otro_proveedor', 'sin_presupuesto', 'ya_no_lo_necesita', 'otro') NULL,
  ADD COLUMN motivo_rechazo_detalle VARCHAR(500) NULL;

-- statement-break

-- Segunda línea gris de cada partida en el documento ("Acero P20, incluye
-- pruebas", "4 visitas"). Opcional.
ALTER TABLE cotizacion_partidas
  ADD COLUMN detalle VARCHAR(255) NULL;
