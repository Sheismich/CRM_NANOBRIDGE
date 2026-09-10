-- Historial integral (PLAN_CRM_DEFINITIVO.md #4): "una línea de tiempo
-- unificada por empresa, contacto y oportunidad". Es una vista de lectura
-- que agrega varias fuentes que YA existen (envios, respuestas, tareas
-- cerradas, cambios de estado de prospecto en auditoria) -- esta tabla es
-- solo para lo que NO tiene tabla propia todavía: llamadas y WhatsApp
-- registrados manualmente, y comentarios del asesor.
-- oportunidad_id es opcional y nullable: la mayoría de la actividad de
-- automatización (envios, respuestas) ocurre ANTES de que exista una
-- oportunidad, así que no todo en la línea de tiempo puede anclarse a una.
CREATE TABLE actividades (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id BIGINT UNSIGNED NOT NULL,
  contacto_id BIGINT UNSIGNED NULL,
  oportunidad_id BIGINT UNSIGNED NULL,
  tipo ENUM('llamada', 'whatsapp', 'comentario') NOT NULL,
  resultado VARCHAR(255) NULL,
  proxima_accion VARCHAR(255) NULL,
  comentario TEXT NULL,
  responsable_id BIGINT UNSIGNED NOT NULL,
  ocurrida_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_actividades_empresa (empresa_id),
  INDEX idx_actividades_contacto (contacto_id),
  CONSTRAINT fk_actividades_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_actividades_contacto FOREIGN KEY (contacto_id) REFERENCES contactos(id),
  CONSTRAINT fk_actividades_oportunidad FOREIGN KEY (oportunidad_id) REFERENCES oportunidades(id),
  CONSTRAINT fk_actividades_responsable FOREIGN KEY (responsable_id) REFERENCES usuarios(id)
);
