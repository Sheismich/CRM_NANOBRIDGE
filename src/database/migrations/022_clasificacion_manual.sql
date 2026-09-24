-- Clasificación manual (cola de clasificación del CRM) que por fin aplica su
-- decisión, en vez de solo cerrar la tarea y encolar un evento para n8n
-- (hallazgo de revisión, 24-sep-2026).
--
-- 1) tareas.respuesta_id: la tarea que crea una respuesta "ambigua" guardaba
-- solo prospecto_id, así que con dos respuestas del mismo prospecto no había
-- forma de saber cuál estaba resolviendo la persona. NULL para todo lo que no
-- nace de una respuesta (tareas de seguimiento, de corrección, las creadas a
-- mano).
--
-- Columna, índice y FK en un solo ALTER: si falla, no queda nada aplicado a
-- medias (MySQL no deshace DDL entre sentencias, ver apply-migrations.ts).
-- La FK copia la tabla en MySQL 8; tareas es chica.
ALTER TABLE tareas
  ADD COLUMN respuesta_id BIGINT UNSIGNED NULL AFTER prospecto_id,
  ADD KEY idx_tareas_respuesta (respuesta_id),
  ADD CONSTRAINT fk_tareas_respuesta FOREIGN KEY (respuesta_id) REFERENCES respuestas(id);

-- statement-break
-- Backfill de las tareas de clasificación que ya existían: clasificarRespuesta
-- las crea con execution_id = 'resp-clasif-' + execution_id de la
-- clasificación de la respuesta, y ese valor es único en las dos tablas.
UPDATE tareas t
  JOIN respuestas r ON t.execution_id = CONCAT('resp-clasif-', r.execution_id_clasificacion)
  SET t.respuesta_id = r.id
  WHERE t.tipo = 'clasificacion' AND t.respuesta_id IS NULL;

-- statement-break
-- 2) Los dos valores que solo existen en la clasificación manual. Agregados
-- AL FINAL de la lista a propósito: así MySQL 8 lo resuelve como cambio de
-- metadatos (instantáneo), sin reescribir la tabla.
ALTER TABLE respuestas
  MODIFY COLUMN clasificacion ENUM('interesado', 'no_interesado', 'baja', 'automatica', 'ambigua', 'invalido', 'reagendar') NULL;
