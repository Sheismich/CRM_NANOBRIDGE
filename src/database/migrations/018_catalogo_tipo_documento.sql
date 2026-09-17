-- catalogo_tipo_documento (PLAN_CRM_DEFINITIVO.md, "Entidades comerciales")
-- -- el plan nombra la tabla pero no enumera valores (a diferencia de
-- catalogo_etapa_embudo/catalogo_motivo_perdida, 010_oportunidades.sql, que
-- sí traían sus claves exactas); el set semilla lo definió Fabián. Mismo
-- patrón: tabla real, no ENUM, porque el plan la lista como entidad propia.
--
-- tipo_documento_id en `documentos` es NULLABLE a propósito: clasificar el
-- documento es informativo, no un requisito para poder subirlo (mismo
-- criterio que politica_retencion, ya opcional en 014_documentos.sql) --
-- documentos ya existentes y cargas futuras sin clasificar no quedan
-- bloqueadas.
CREATE TABLE catalogo_tipo_documento (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clave VARCHAR(40) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tipo_documento_clave (clave)
);

-- statement-break

INSERT INTO catalogo_tipo_documento (clave, nombre) VALUES
  ('contrato', 'Contrato'),
  ('identificacion_oficial', 'Identificación oficial'),
  ('comprobante_domicilio', 'Comprobante de domicilio'),
  ('acta_constitutiva', 'Acta constitutiva'),
  ('cotizacion_firmada', 'Cotización firmada'),
  ('otro', 'Otro');

-- statement-break

ALTER TABLE documentos
  ADD COLUMN tipo_documento_id BIGINT UNSIGNED NULL AFTER mime_type,
  ADD INDEX idx_documentos_tipo_documento (tipo_documento_id),
  ADD CONSTRAINT fk_documentos_tipo_documento FOREIGN KEY (tipo_documento_id) REFERENCES catalogo_tipo_documento(id);
