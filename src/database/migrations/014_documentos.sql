-- Expediente documental (PLAN_CRM_DEFINITIVO.md #8): archivos en storage
-- privado (GCS en producción; filesystem local en dev/sin credenciales --
-- ver src/documentos/storage/), metadatos/permisos/vínculos aquí en MySQL.
--
-- Versionado: mismo criterio que cotizaciones (013_cotizaciones.sql) --
-- no hay tabla de "versiones" aparte, cada fila ES una versión inmutable.
-- version=1 y documento_raiz_id=NULL para la primera; las siguientes
-- versiones apuntan a la fila de la versión 1 vía documento_raiz_id, así
-- se recupera toda la cadena con (id = X OR documento_raiz_id = X).
--
-- Estados: 'vigente' (versión utilizable, default) -> 'obsoleto'
-- (reemplazado por una versión nueva; fijado SOLO por POST .../version,
-- igual que cotizaciones -- nunca aparece como destino de un cambio de
-- estado manual) o -> 'archivado' (retirado del expediente activo sin ser
-- reemplazado, ej. por política de retención; puede reactivarse a
-- 'vigente'). 'obsoleto' es terminal.
--
-- empresa_id es obligatorio (el expediente pertenece a la empresa, mismo
-- criterio que "los medios corporativos compartidos pertenecen a la
-- empresa" en el módulo de empresas/contactos); oportunidad_id y
-- contacto_id son vínculos opcionales a la entidad relacionada, igual
-- patrón que ya usa la tabla `actividades` (012_actividades.sql).
--
-- politica_retencion es texto libre configurable (ej. '5_anios',
-- 'indefinida') en vez de un ENUM fijo: el plan dice "La política de
-- retención será configurable y aprobada por la empresa", así que este
-- alcance no puede inventar un catálogo cerrado; queda como campo
-- informativo hasta que exista una pantalla de administración de
-- políticas de retención.
--
-- activo=false: soft-delete, mismo patrón que empresas/contactos ("No se
-- borra información; se desactiva o se marca como obsoleta",
-- PLAN_CRM_DEFINITIVO.md #2). El archivo subyacente en storage NO se
-- borra al desactivar un documento -- la purga real según política de
-- retención queda fuera de este alcance; por eso StorageDriver.eliminar()
-- existe en la interfaz (para un futuro job de purga) pero
-- DocumentosService todavía no lo invoca desde el endpoint de borrado.
CREATE TABLE documentos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id BIGINT UNSIGNED NOT NULL,
  oportunidad_id BIGINT UNSIGNED NULL,
  contacto_id BIGINT UNSIGNED NULL,
  documento_raiz_id BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  nombre_original VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  tamano_bytes BIGINT UNSIGNED NOT NULL,
  storage_driver VARCHAR(20) NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  estado ENUM('vigente', 'obsoleto', 'archivado') NOT NULL DEFAULT 'vigente',
  politica_retencion VARCHAR(60) NULL,
  subido_por BIGINT UNSIGNED NOT NULL,
  revisado_por BIGINT UNSIGNED NULL,
  revisado_en DATETIME NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_documentos_empresa (empresa_id),
  INDEX idx_documentos_oportunidad (oportunidad_id),
  INDEX idx_documentos_contacto (contacto_id),
  INDEX idx_documentos_raiz (documento_raiz_id),
  CONSTRAINT fk_documentos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_documentos_oportunidad FOREIGN KEY (oportunidad_id) REFERENCES oportunidades(id),
  CONSTRAINT fk_documentos_contacto FOREIGN KEY (contacto_id) REFERENCES contactos(id),
  CONSTRAINT fk_documentos_raiz FOREIGN KEY (documento_raiz_id) REFERENCES documentos(id),
  CONSTRAINT fk_documentos_subido_por FOREIGN KEY (subido_por) REFERENCES usuarios(id),
  CONSTRAINT fk_documentos_revisado_por FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
);
