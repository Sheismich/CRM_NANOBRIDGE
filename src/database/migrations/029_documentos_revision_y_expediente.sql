-- Documentos del rediseño (bloque 3, 12-oct-2026).
--
-- Revisión con resultado: antes solo se guardaba QUIÉN y CUÁNDO revisó
-- (revisado_por / revisado_en). La pantalla nueva aprueba o rechaza, y el
-- rechazo lleva un motivo rápido (shared/motivos-rechazo-documento.ts) y una
-- explicación. revisado_por / revisado_en siguen diciendo quién y cuándo
-- (aprobó o rechazó). Cada versión trae su propia revisión: una versión
-- nueva empieza en por_revisar.
--
-- Columnas al final: MySQL 8 las agrega sin reescribir la tabla.
ALTER TABLE documentos
  ADD COLUMN revision ENUM('por_revisar', 'aprobado', 'rechazado') NOT NULL DEFAULT 'por_revisar',
  ADD COLUMN motivo_rechazo ENUM('ilegible', 'vencido', 'incompleto', 'no_es_de_la_empresa', 'tipo_equivocado', 'otro') NULL,
  ADD COLUMN motivo_rechazo_detalle VARCHAR(500) NULL;

-- statement-break

-- Lo que ya estaba "revisado" con el botón viejo cuenta como aprobado.
UPDATE documentos SET revision = 'aprobado' WHERE revisado_en IS NOT NULL;

-- statement-break

-- Papeles obligatorios del expediente: se marcan en el catálogo (Fabián,
-- 12-oct-2026) para que si Carlos pide otra lista se cambie desde el CRM,
-- sin código ni migración. De inicio, los 5 del diseño.
ALTER TABLE catalogo_tipo_documento
  ADD COLUMN obligatorio BOOLEAN NOT NULL DEFAULT FALSE;

-- statement-break

UPDATE catalogo_tipo_documento SET obligatorio = TRUE
WHERE clave IN ('acta_constitutiva', 'comprobante_domicilio', 'identificacion_oficial', 'contrato', 'cotizacion_firmada');

-- statement-break

-- Tarea "Corregir documento" que se crea al rechazar: se cierra sola al subir
-- la versión nueva y se cancela si el documento se archiva o se borra. NULL
-- en cualquier otra tarea.
ALTER TABLE tareas
  ADD COLUMN documento_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_tareas_documento (documento_id);
