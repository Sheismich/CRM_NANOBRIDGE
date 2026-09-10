ALTER TABLE prospectos
  ADD COLUMN execution_id VARCHAR(100) NULL AFTER campana_id,
  ADD UNIQUE KEY uq_prospectos_execution_id (execution_id);
