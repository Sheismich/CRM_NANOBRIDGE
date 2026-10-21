-- Resumen con IA en la ficha del cliente (etapa 4 de las mejoras).
--
-- No hace falta tabla nueva: el resumen se guarda en uso_ia (035) con
-- tipo 'resumen_ficha' y el JSON { resumen, siguiente_paso } en `resultado`.
-- El último resumen de una empresa para una persona es la fila más reciente
-- de esa empresa, persona y tipo (P4.2: se guarda por persona, porque cada
-- quien solo resume lo que puede ver en la ficha).
ALTER TABLE uso_ia
  ADD COLUMN empresa_id BIGINT UNSIGNED NULL AFTER respuesta_id,
  ADD CONSTRAINT fk_uso_ia_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  ADD INDEX idx_uso_ia_empresa (empresa_id, usuario_id, tipo, creado_en);
