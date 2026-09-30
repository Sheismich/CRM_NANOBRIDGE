-- Modo sugerencia de la IA (decisión del 30-sep-2026): n8n clasifica cada
-- respuesta con IA pero solo PROPONE; la respuesta sigue en la cola de
-- clasificación con la sugerencia a la vista y una persona confirma. Nada
-- (estado del prospecto, bajas, tareas) depende de la IA mientras tanto.
-- POST /automatizacion/respuestas/sugerencia escribe estas columnas; no
-- tocan estado ni clasificacion, que siguen siendo la decisión real.
--
-- - clasificacion_sugerida: los mismos valores que puede mandar n8n
--   (CLASIFICACIONES_N8N en src/shared/clasificaciones.ts; un test compara
--   este ENUM contra esa constante).
-- - confianza_sugerida: 0-100.
-- - execution_id_sugerencia: sin UNIQUE a propósito. Volver a correr el
--   workflow sobre la misma respuesta (otro execution_id) sobrescribe la
--   sugerencia; el mismo execution_id es un reintento y no cambia nada.
--
-- Un solo ALTER: si falla, no queda nada aplicado a medias (MySQL no
-- deshace DDL entre sentencias, ver apply-migrations.ts). El CHECK hace que
-- MySQL 8 copie la tabla; respuestas es chica.
ALTER TABLE respuestas
  ADD COLUMN clasificacion_sugerida ENUM('interesado', 'no_interesado', 'baja', 'automatica', 'ambigua') NULL,
  ADD COLUMN confianza_sugerida TINYINT UNSIGNED NULL,
  ADD COLUMN motivo_sugerencia VARCHAR(500) NULL,
  ADD COLUMN execution_id_sugerencia VARCHAR(100) NULL,
  ADD COLUMN sugerido_en DATETIME NULL,
  ADD CONSTRAINT chk_respuestas_confianza_sugerida CHECK (confianza_sugerida <= 100);
