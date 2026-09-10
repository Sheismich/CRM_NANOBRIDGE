CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clave VARCHAR(30) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- statement-break
INSERT INTO roles (clave, nombre) VALUES
  ('administrador', 'Administrador'),
  ('supervisor', 'Supervisor'),
  ('agente', 'Agente'),
  ('sistema', 'Sistema');

-- statement-break
CREATE TABLE usuarios (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rol_id BIGINT UNSIGNED NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  correo VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_correo (correo),
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles(id)
);

-- statement-break
CREATE TABLE sesiones (
  id CHAR(64) PRIMARY KEY,
  usuario_id BIGINT UNSIGNED NOT NULL,
  expira_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sesiones_expira (expira_en),
  CONSTRAINT fk_sesiones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- statement-break
CREATE TABLE empresas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre_legal VARCHAR(255) NOT NULL,
  nombre_comercial VARCHAR(255) NULL,
  giro VARCHAR(120) NULL,
  tamano ENUM('micro', 'pequena', 'mediana', 'grande') NULL,
  region VARCHAR(120) NULL,
  estado VARCHAR(120) NULL,
  ciudad VARCHAR(120) NULL,
  pais CHAR(2) NOT NULL DEFAULT 'MX',
  sitio_web VARCHAR(2048) NULL,
  linkedin_url VARCHAR(2048) NULL,
  propietario_id BIGINT UNSIGNED NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_empresas_propietario (propietario_id),
  CONSTRAINT fk_empresas_propietario FOREIGN KEY (propietario_id) REFERENCES usuarios(id)
);

-- statement-break
CREATE TABLE contactos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id BIGINT UNSIGNED NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  puesto VARCHAR(160) NULL,
  area VARCHAR(160) NULL,
  linkedin_url VARCHAR(2048) NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contactos_empresa (empresa_id),
  CONSTRAINT fk_contactos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);

-- statement-break
CREATE TABLE medios_contacto (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id BIGINT UNSIGNED NULL,
  contacto_id BIGINT UNSIGNED NULL,
  tipo ENUM('correo', 'telefono', 'whatsapp', 'linkedin', 'sitio_web') NOT NULL,
  valor VARCHAR(512) NOT NULL,
  valor_normalizado VARCHAR(512) NOT NULL,
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  estado_contacto ENUM('activo', 'no_contactar', 'obsoleto') NOT NULL DEFAULT 'activo',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_medio_un_dueno CHECK ((empresa_id IS NOT NULL) <> (contacto_id IS NOT NULL)),
  UNIQUE KEY uq_medio_tipo_valor (tipo, valor_normalizado),
  INDEX idx_medios_empresa (empresa_id),
  INDEX idx_medios_contacto (contacto_id),
  CONSTRAINT fk_medios_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_medios_contacto FOREIGN KEY (contacto_id) REFERENCES contactos(id)
);

-- statement-break
CREATE TABLE prospectos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contacto_id BIGINT UNSIGNED NOT NULL,
  campana_id BIGINT UNSIGNED NULL,
  estado VARCHAR(60) NOT NULL DEFAULT 'capturado',
  score DECIMAL(5,2) NULL,
  prioridad ENUM('alta', 'media', 'baja') NULL,
  fuente_url VARCHAR(2048) NULL,
  confianza ENUM('alta', 'media', 'baja') NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_prospectos_contacto (contacto_id),
  CONSTRAINT fk_prospectos_contacto FOREIGN KEY (contacto_id) REFERENCES contactos(id)
);

-- statement-break
CREATE TABLE auditoria (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id BIGINT UNSIGNED NULL,
  entidad VARCHAR(80) NOT NULL,
  entidad_id BIGINT UNSIGNED NOT NULL,
  accion VARCHAR(80) NOT NULL,
  antes JSON NULL,
  despues JSON NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auditoria_entidad (entidad, entidad_id),
  CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
