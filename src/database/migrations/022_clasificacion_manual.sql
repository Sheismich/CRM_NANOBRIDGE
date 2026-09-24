-- Clasificación manual (cola de clasificación del CRM) que por fin aplica su
-- decisión, en vez de solo cerrar la tarea y encolar un evento para n8n
-- (hallazgo de revisión, 24-sep-2026).
--
-- 1) tareas.respuesta_id: la tarea que crea una respuesta "ambigua" guardaba
-- solo prospecto_id, así que con dos respuestas del mismo prospecto no había
-- forma de saber cuál estaba resolviendo la persona. NULL para todo lo que no
-- nace de una respuesta (tareas de seguimiento, de corrección, las creadas a
-- mano, y las de clasificación anteriores a esta migración).
ALTER TABLE tareas
  ADD COLUMN respuesta_id BIGINT UNSIGNED NULL AFTER prospecto_id;

-- statement-break
-- Aparte de la columna: la FK sí copia la tabla en MySQL 8 (con
-- foreign_key_checks activo), la columna sola no. tareas es chica.
ALTER TABLE tareas
  ADD CONSTRAINT fk_tareas_respuesta FOREIGN KEY (respuesta_id) REFERENCES respuestas(id);

-- statement-break
-- 2) Los dos valores que solo existen en la clasificación manual. Agregados
-- AL FINAL de la lista a propósito: así MySQL 8 lo resuelve como cambio de
-- metadatos (instantáneo), sin reescribir la tabla.
ALTER TABLE respuestas
  MODIFY COLUMN clasificacion ENUM('interesado', 'no_interesado', 'baja', 'automatica', 'ambigua', 'invalido', 'reagendar') NULL;
