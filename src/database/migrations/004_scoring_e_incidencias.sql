CREATE TABLE resultados_scoring (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  execution_id VARCHAR(100) NOT NULL,
  prospecto_id BIGINT UNSIGNED NOT NULL,
  score DECIMAL(5,2) NOT NULL,
  prioridad ENUM('alta', 'media', 'baja') NULL,
  confianza ENUM('alta', 'media', 'baja') NULL,
  metodo ENUM('gemini', 'reglas') NOT NULL DEFAULT 'gemini',
  detalle JSON NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_resultados_scoring_execution_id (execution_id),
  INDEX idx_resultados_scoring_prospecto (prospecto_id),
  CONSTRAINT fk_resultados_scoring_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id)
);

-- statement-break
CREATE TABLE incidencias (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  execution_id VARCHAR(100) NULL,
  prospecto_id BIGINT UNSIGNED NULL,
  tipo VARCHAR(60) NOT NULL,
  severidad ENUM('baja', 'media', 'alta') NOT NULL DEFAULT 'media',
  mensaje TEXT NOT NULL,
  detalle JSON NULL,
  estado ENUM('abierta', 'resuelta') NOT NULL DEFAULT 'abierta',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_incidencias_execution_tipo (execution_id, tipo),
  INDEX idx_incidencias_prospecto (prospecto_id),
  INDEX idx_incidencias_estado (estado),
  CONSTRAINT fk_incidencias_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id)
);
