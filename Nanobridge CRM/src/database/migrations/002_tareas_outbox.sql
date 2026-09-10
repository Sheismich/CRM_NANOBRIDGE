CREATE TABLE tareas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('seguimiento', 'clasificacion', 'revision_documento', 'otro') NOT NULL DEFAULT 'seguimiento',
  titulo VARCHAR(255) NOT NULL,
  descripcion TEXT NULL,
  estado ENUM('pendiente', 'en_progreso', 'cerrada', 'cancelada') NOT NULL DEFAULT 'pendiente',
  prioridad ENUM('baja', 'media', 'alta', 'urgente') NOT NULL DEFAULT 'media',
  responsable_id BIGINT UNSIGNED NOT NULL,
  empresa_id BIGINT UNSIGNED NULL,
  contacto_id BIGINT UNSIGNED NULL,
  prospecto_id BIGINT UNSIGNED NULL,
  fecha_limite DATETIME NULL,
  clasificacion VARCHAR(60) NULL,
  resultado TEXT NULL,
  cerrada_en DATETIME NULL,
  creada_por BIGINT UNSIGNED NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tareas_responsable_estado (responsable_id, estado),
  INDEX idx_tareas_tipo_estado (tipo, estado),
  INDEX idx_tareas_empresa (empresa_id),
  INDEX idx_tareas_contacto (contacto_id),
  INDEX idx_tareas_prospecto (prospecto_id),
  CONSTRAINT fk_tareas_responsable FOREIGN KEY (responsable_id) REFERENCES usuarios(id),
  CONSTRAINT fk_tareas_creada_por FOREIGN KEY (creada_por) REFERENCES usuarios(id),
  CONSTRAINT fk_tareas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_tareas_contacto FOREIGN KEY (contacto_id) REFERENCES contactos(id),
  CONSTRAINT fk_tareas_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id)
);

-- statement-break
-- Patrón outbox (obligatorio, PLAN_CRM_DEFINITIVO.md #5): ninguna pantalla
-- llama a n8n directamente. Cerrar una tarea, clasificar o reactivar un
-- prospecto inserta una fila aquí, en la misma transacción; un despachador
-- interno la entrega a n8n de forma asíncrona con reintentos.
CREATE TABLE eventos_pendientes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(100) NOT NULL,
  entidad_tipo VARCHAR(50) NOT NULL,
  entidad_id BIGINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  estado ENUM('pendiente', 'procesando', 'enviado', 'fallido') NOT NULL DEFAULT 'pendiente',
  intentos INT UNSIGNED NOT NULL DEFAULT 0,
  proximo_intento_en DATETIME NULL,
  ultimo_error TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_eventos_estado_intento (estado, proximo_intento_en),
  INDEX idx_eventos_entidad (entidad_tipo, entidad_id)
);

-- statement-break
-- Tras 3 intentos fallidos (5s, 30s, 120s por PLAN_API_DEFINITIVO.md) el
-- evento se marca 'fallido' y queda visible/reintentable aquí, tal como
-- exige PLAN_CRM_DEFINITIVO.md #5.
CREATE TABLE procesos_fallidos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  evento_id BIGINT UNSIGNED NULL,
  tipo VARCHAR(100) NOT NULL,
  payload JSON NOT NULL,
  error TEXT NOT NULL,
  resuelto BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_procesos_fallidos_resuelto (resuelto),
  CONSTRAINT fk_procesos_fallidos_evento FOREIGN KEY (evento_id) REFERENCES eventos_pendientes(id)
);
