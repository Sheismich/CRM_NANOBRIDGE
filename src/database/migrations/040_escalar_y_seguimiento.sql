-- Que no se enfríe lo que ya estaba cerca de venderse (Fabián, 4-nov-2026).
--
-- - escalado_en: cuándo se avisó a supervisores que un interesado lleva un día
--   hábil sin atender. Evita avisar dos veces.
-- - cotizacion_id: la cotización de una tarea "Dar seguimiento a cotización".
--   El UNIQUE deja una sola por cotización aunque el trabajo corra dos veces;
--   en las demás tareas es NULL.
ALTER TABLE tareas
  ADD COLUMN escalado_en DATETIME NULL AFTER alertado_en,
  ADD COLUMN cotizacion_id BIGINT UNSIGNED NULL AFTER documento_id,
  ADD UNIQUE INDEX uq_tareas_cotizacion (cotizacion_id),
  ADD CONSTRAINT fk_tareas_cotizacion FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id);
