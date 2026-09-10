-- Cotizaciones (PLAN_CRM_DEFINITIVO.md #7): "una edición crea una nueva
-- versión; la versión anterior queda obsoleta" -- cada fila es una
-- versión. version=1 y cotizacion_raiz_id=NULL para la primera; las
-- siguientes versiones apuntan a la fila de la versión 1 vía
-- cotizacion_raiz_id, así se recupera toda la cadena con
-- (id = X OR cotizacion_raiz_id = X) sin necesitar una tabla aparte.
CREATE TABLE cotizaciones (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id BIGINT UNSIGNED NOT NULL,
  oportunidad_id BIGINT UNSIGNED NOT NULL,
  contacto_id BIGINT UNSIGNED NULL,
  cotizacion_raiz_id BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  moneda CHAR(3) NOT NULL DEFAULT 'MXN',
  subtotal DECIMAL(12, 2) NOT NULL,
  descuento DECIMAL(12, 2) NOT NULL DEFAULT 0,
  impuestos DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total DECIMAL(12, 2) NOT NULL,
  fecha_emision DATE NOT NULL,
  fecha_envio DATE NULL,
  fecha_esperada_cierre DATE NULL,
  probabilidad TINYINT UNSIGNED NULL,
  estado ENUM('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida', 'obsoleta') NOT NULL DEFAULT 'borrador',
  creado_por BIGINT UNSIGNED NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cotizaciones_empresa (empresa_id),
  INDEX idx_cotizaciones_oportunidad (oportunidad_id),
  INDEX idx_cotizaciones_raiz (cotizacion_raiz_id),
  CONSTRAINT fk_cotizaciones_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_cotizaciones_oportunidad FOREIGN KEY (oportunidad_id) REFERENCES oportunidades(id),
  CONSTRAINT fk_cotizaciones_contacto FOREIGN KEY (contacto_id) REFERENCES contactos(id),
  CONSTRAINT fk_cotizaciones_raiz FOREIGN KEY (cotizacion_raiz_id) REFERENCES cotizaciones(id),
  CONSTRAINT fk_cotizaciones_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios(id)
);

-- statement-break

-- Importe = cantidad * precio_unitario, calculado en el servidor (nunca
-- se confía en un total mandado por el cliente).
CREATE TABLE cotizacion_partidas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cotizacion_id BIGINT UNSIGNED NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  cantidad DECIMAL(10, 2) NOT NULL,
  precio_unitario DECIMAL(12, 2) NOT NULL,
  importe DECIMAL(12, 2) NOT NULL,
  orden INT UNSIGNED NOT NULL DEFAULT 0,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cotizacion_partidas_cotizacion (cotizacion_id),
  CONSTRAINT fk_cotizacion_partidas_cotizacion FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id)
);
