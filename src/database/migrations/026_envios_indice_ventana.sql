-- Índice para /envios/vencidas (B7 del plan de fixes, 2-oct-2026). Esa
-- consulta busca ventana_estado = 'abierta' AND ventana_vence_en <= ahora,
-- ordenada por ventana_vence_en, con FOR UPDATE SKIP LOCKED. Sin índice,
-- MySQL recorría toda la tabla envios y dejaba bloqueada cada fila que
-- revisaba hasta terminar la transacción: un /envios o una respuesta que
-- llegaba para otro envío se quedaba esperando. Con el índice solo toca las
-- filas vencidas.
ALTER TABLE envios
  ADD KEY idx_envios_ventana (ventana_estado, ventana_vence_en);
