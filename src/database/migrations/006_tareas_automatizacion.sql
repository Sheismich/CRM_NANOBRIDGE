-- Habilita que n8n cree tareas directamente (diagrama PARTE 1/2, pasos 3a y
-- 10): quedan sin responsable ("bandeja sin asignar", cualquier agente o
-- supervisor las puede tomar), sin creada_por (NULL = creada por
-- automatización, no por un usuario de sesión) y con execution_id para
-- idempotencia, igual que el resto de los endpoints de automatización.
ALTER TABLE tareas
  MODIFY COLUMN responsable_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN creada_por BIGINT UNSIGNED NULL,
  ADD COLUMN execution_id VARCHAR(100) NULL AFTER prospecto_id,
  ADD UNIQUE KEY uq_tareas_execution_id (execution_id);
