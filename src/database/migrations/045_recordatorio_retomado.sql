-- Recordatorio perdido si PT4 truena a la mitad (#3 de la revisión del
-- 20-nov-2026; Fabián, 23-nov-2026). /envios/vencidas marca la ventana como
-- vencida al entregársela a n8n: si PT4 se caía antes de registrar el envío,
-- ese recordatorio no salía nunca y la persona se quedaba en "serie en curso"
-- (sin poder entrar a sus otras campañas) por 6 meses.
--
-- - ventana_entregada_en: cuándo se le entregó a n8n esta ventana. Solo las
--   que de verdad se entregaron: no las que la API canceló a propósito
--   (omitidas) ni las viejas que se saltaron por un envío más nuevo.
-- - ventana_retomas: cuántas veces se volvió a abrir porque no llegó su
--   resultado. Solo se retoma una vez: PT4 a veces la salta a propósito
--   (prospecto sin campaña, 409 de la API) y no avisa.
ALTER TABLE envios
  ADD COLUMN ventana_entregada_en DATETIME NULL AFTER ventana_estado,
  ADD COLUMN ventana_retomas TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER ventana_entregada_en,
  ADD INDEX idx_envios_ventana_entregada (ventana_estado, ventana_entregada_en);
