-- Modulo Oportunidades y pipeline (PLAN_CRM_DEFINITIVO.md #6). Las 7 etapas
-- y los 8 motivos de perdida son fijos por ahora (no hay pantalla de
-- administracion de catalogos en este alcance), pero viven en tabla real
-- -- no ENUM -- porque PLAN_CRM_DEFINITIVO.md los lista como entidades
-- propias (catalogo_etapa_embudo, catalogo_motivo_perdida).
CREATE TABLE catalogo_etapa_embudo (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clave VARCHAR(40) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  probabilidad TINYINT UNSIGNED NOT NULL,
  orden TINYINT UNSIGNED NOT NULL,
  es_cierre BOOLEAN NOT NULL DEFAULT FALSE,
  es_ganada BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_etapa_embudo_clave (clave)
);

-- statement-break

INSERT INTO catalogo_etapa_embudo (clave, nombre, probabilidad, orden, es_cierre, es_ganada) VALUES
  ('calificada', 'Calificada', 10, 1, FALSE, FALSE),
  ('descubrimiento', 'Descubrimiento', 25, 2, FALSE, FALSE),
  ('propuesta', 'Propuesta', 50, 3, FALSE, FALSE),
  ('negociacion', 'Negociación', 75, 4, FALSE, FALSE),
  ('verbalmente_ganada', 'Verbalmente ganada', 90, 5, FALSE, FALSE),
  ('ganada', 'Ganada', 100, 6, TRUE, TRUE),
  ('perdida', 'Perdida', 0, 7, TRUE, FALSE);

-- statement-break

CREATE TABLE catalogo_motivo_perdida (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clave VARCHAR(40) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  requiere_explicacion BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_motivo_perdida_clave (clave)
);

-- statement-break

INSERT INTO catalogo_motivo_perdida (clave, nombre, requiere_explicacion) VALUES
  ('sin_presupuesto', 'Sin presupuesto', FALSE),
  ('sin_necesidad', 'Sin necesidad', FALSE),
  ('sin_respuesta', 'Sin respuesta', FALSE),
  ('competidor', 'Perdida ante competidor', FALSE),
  ('fuera_de_perfil', 'Fuera de perfil', FALSE),
  ('decision_pospuesta', 'Decisión pospuesta', FALSE),
  ('contacto_invalido', 'Contacto inválido', FALSE),
  ('otro', 'Otro', TRUE);

-- statement-break

-- "Las oportunidades se crean cuando un prospecto interesado es tomado por
-- un asesor, no automáticamente por score alto" (PLAN_CRM_DEFINITIVO.md,
-- decisiones cerradas) -- por eso prospecto_id es opcional: una
-- oportunidad tambien puede nacer sin haber pasado por automatizacion.
CREATE TABLE oportunidades (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id BIGINT UNSIGNED NOT NULL,
  contacto_id BIGINT UNSIGNED NULL,
  prospecto_id BIGINT UNSIGNED NULL,
  titulo VARCHAR(255) NOT NULL,
  etapa_id BIGINT UNSIGNED NOT NULL,
  responsable_id BIGINT UNSIGNED NOT NULL,
  valor_estimado DECIMAL(12, 2) NULL,
  fecha_cierre_estimada DATE NULL,
  motivo_perdida_id BIGINT UNSIGNED NULL,
  motivo_perdida_detalle VARCHAR(500) NULL,
  cerrada BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_oportunidades_empresa (empresa_id),
  INDEX idx_oportunidades_responsable (responsable_id),
  CONSTRAINT fk_oportunidades_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_oportunidades_contacto FOREIGN KEY (contacto_id) REFERENCES contactos(id),
  CONSTRAINT fk_oportunidades_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id),
  CONSTRAINT fk_oportunidades_etapa FOREIGN KEY (etapa_id) REFERENCES catalogo_etapa_embudo(id),
  CONSTRAINT fk_oportunidades_responsable FOREIGN KEY (responsable_id) REFERENCES usuarios(id),
  CONSTRAINT fk_oportunidades_motivo_perdida FOREIGN KEY (motivo_perdida_id) REFERENCES catalogo_motivo_perdida(id)
);

-- statement-break

-- Bitácora de cada cambio de etapa (incluye la creación y cada
-- reapertura); nunca se borra, ni siquiera al reabrir una perdida
-- (PLAN_CRM_DEFINITIVO.md: "puede reabrirse, conservando su historial").
CREATE TABLE historial_etapa_oportunidad (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  oportunidad_id BIGINT UNSIGNED NOT NULL,
  etapa_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  motivo_perdida_id BIGINT UNSIGNED NULL,
  comentario VARCHAR(500) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_historial_etapa_oportunidad (oportunidad_id),
  CONSTRAINT fk_historial_etapa_oportunidad FOREIGN KEY (oportunidad_id) REFERENCES oportunidades(id),
  CONSTRAINT fk_historial_etapa_catalogo FOREIGN KEY (etapa_id) REFERENCES catalogo_etapa_embudo(id),
  CONSTRAINT fk_historial_etapa_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT fk_historial_etapa_motivo_perdida FOREIGN KEY (motivo_perdida_id) REFERENCES catalogo_motivo_perdida(id)
);
