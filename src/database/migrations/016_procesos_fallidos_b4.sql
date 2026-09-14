-- B4 Error Workflow (PLAN_API_DEFINITIVO.md / PLAN_N8N_DEFINITIVO.md):
-- procesos_fallidos nació en 002_tareas_outbox.sql solo para el outbox
-- interno (eventos_pendientes agotando reintentos) y le faltaban las
-- columnas que necesita el reporte de fallas de n8n -- execution_id,
-- workflow, nodo, endpoint, codigo_http -- y el campo `error` no coincidía
-- con el nombre documentado (`mensaje`). `resuelto` (booleano) se
-- reemplaza por `estado` (ENUM) para poder distinguir "en revisión" de
-- "resuelto", igual que ya hace `incidencias`.
ALTER TABLE procesos_fallidos
  ADD COLUMN execution_id VARCHAR(100) NULL AFTER evento_id,
  ADD COLUMN workflow VARCHAR(120) NULL,
  ADD COLUMN nodo VARCHAR(120) NULL,
  ADD COLUMN endpoint VARCHAR(160) NULL,
  ADD COLUMN codigo_http SMALLINT UNSIGNED NULL,
  ADD COLUMN estado ENUM('abierto', 'en_revision', 'resuelto') NOT NULL DEFAULT 'abierto',
  ADD COLUMN actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- statement-break
-- Backfill antes de tirar la columna vieja: preserva el estado ya
-- registrado (resuelto=TRUE) de cualquier fila existente. Seguro sobre una
-- tabla vacía (no hace nada).
UPDATE procesos_fallidos SET estado = 'resuelto' WHERE resuelto = TRUE;

-- statement-break
-- CHANGE COLUMN en vez de RENAME COLUMN: ambos existen en MySQL 8, pero
-- CHANGE deja explícito el tipo/NOT NULL resultante en vez de asumir que
-- se conserva tal cual.
ALTER TABLE procesos_fallidos
  DROP INDEX idx_procesos_fallidos_resuelto,
  DROP COLUMN resuelto,
  CHANGE COLUMN error mensaje TEXT NOT NULL,
  ADD UNIQUE KEY uq_procesos_fallidos_execution_id (execution_id),
  ADD INDEX idx_procesos_fallidos_estado (estado);
