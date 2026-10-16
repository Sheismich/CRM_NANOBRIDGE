-- Fila de automatización (botón "Mandar a automatización", 16-oct-2026).
--
-- Un prospecto del CRM (importado o dado de alta a mano) nacía en
-- "capturado" y nunca recibía correo: PT1 solo sabía arrancar registrando
-- uno nuevo. Ahora un administrador o supervisor lo pone en la fila
-- (estado 'en_fila'; la columna estado es VARCHAR, no hay ENUM que cambiar)
-- y PT1 los toma de a pocos al día (POST /automatizacion/prospectos/fila/tomar).
--
-- - fila_desde: cuándo entró a la fila; da el orden de salida. Cambiarle la
--   campaña no lo mueve (no pierde su lugar).
-- - fila_por: quién lo mandó.
-- - fila_tomado_en / fila_execution_id: cuándo y en qué ejecución de PT1 lo
--   tomó. La misma ejecución vuelve a recibir los mismos (reintentos de n8n);
--   uno tomado que en 24 h no avanzó se puede volver a tomar.
-- - fila_estado_previo: con qué estado entró (capturado o excluido), para
--   que la auditoría de "sacar de la fila" diga de dónde venía.
--
-- Columnas al final: MySQL 8 las agrega sin reescribir la tabla.
ALTER TABLE prospectos
  ADD COLUMN fila_desde DATETIME NULL,
  ADD COLUMN fila_por BIGINT UNSIGNED NULL,
  ADD COLUMN fila_tomado_en DATETIME NULL,
  ADD COLUMN fila_execution_id VARCHAR(100) NULL,
  ADD COLUMN fila_estado_previo VARCHAR(60) NULL,
  ADD INDEX idx_prospectos_fila (estado, fila_desde),
  ADD INDEX idx_prospectos_fila_execution (fila_execution_id);
