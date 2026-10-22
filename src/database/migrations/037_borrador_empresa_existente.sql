-- Nuevo prospecto en una empresa que ya existe (Fabián, 22-oct-2026).
--
-- Antes el alta manual siempre creaba una empresa nueva al confirmar, aunque
-- ya hubiera una con el mismo nombre (el nombre nunca junta registros). Con
-- empresa_id el borrador recuerda la empresa que se eligió en la pantalla y
-- confirmarFila() le cuelga ahí el contacto nuevo. Solo lo usa el alta
-- manual; las filas de CSV lo dejan en NULL.
ALTER TABLE borradores_captura
  ADD COLUMN empresa_id BIGINT UNSIGNED NULL AFTER fila_original,
  ADD CONSTRAINT fk_borradores_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id);
