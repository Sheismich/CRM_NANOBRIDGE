-- Mandar la cotización por correo desde el CRM (Fabián, 3-nov-2026).
--
-- Cada vez que un vendedor manda una cotización con el PDF adjunto. No es un
-- envío de prospección: no va en `envios`, no cuenta para el límite de 3
-- contactos ni abre ventanas, y no lleva link de baja (es algo que el cliente
-- pidió). Si el cliente contesta, le llega directo al vendedor (Reply-To).
--
-- - estado: igual que correos_respuesta, 'enviando' se guarda ANTES de llamar
--   a SendGrid y pasa a 'enviado' o 'fallido' al terminar. Mientras haya uno
--   'enviando' de la misma cotización no se manda otro (evita el doble clic).
-- - empresa_id y contacto_id: para el Historial de la ficha, que filtra por
--   empresa o por contacto.
CREATE TABLE correos_cotizacion (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cotizacion_id BIGINT UNSIGNED NOT NULL,
  empresa_id BIGINT UNSIGNED NOT NULL,
  contacto_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  para VARCHAR(320) NOT NULL,
  asunto VARCHAR(500) NOT NULL,
  texto TEXT NOT NULL,
  estado ENUM('enviando', 'enviado', 'fallido') NOT NULL DEFAULT 'enviando',
  error VARCHAR(300) NULL,
  proveedor_id VARCHAR(255) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_en DATETIME NULL,
  INDEX idx_correos_cotizacion_cotizacion (cotizacion_id, estado),
  INDEX idx_correos_cotizacion_empresa (empresa_id, estado),
  CONSTRAINT fk_correos_cotizacion_cotizacion FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id),
  CONSTRAINT fk_correos_cotizacion_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_correos_cotizacion_contacto FOREIGN KEY (contacto_id) REFERENCES contactos(id),
  CONSTRAINT fk_correos_cotizacion_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
