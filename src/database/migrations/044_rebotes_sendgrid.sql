-- Rebotes de SendGrid directo a la API (Fabián, 20-nov-2026). Antes el Event
-- Webhook llegaba a n8n (PT3) y un rebote solo suprimía el correo: el
-- prospecto seguía igual y no quedaba ni el tipo ni el motivo.
--
-- eventos_sendgrid: cada evento que manda SendGrid, una vez (sg_event_id es
-- único: SendGrid puede mandar el mismo evento dos veces). De aquí sale la
-- cuenta de rebotes suaves seguidos y la del freno del dominio.
-- - tipo: el `type` de un evento bounce ('bounce' = duro, 'blocked' = suave).
-- - ocurrio_en: el `timestamp` de SendGrid (los eventos llegan en desorden).
-- - resultado: qué hizo la API con él.
CREATE TABLE eventos_sendgrid (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sg_event_id VARCHAR(255) NOT NULL,
  evento VARCHAR(40) NOT NULL,
  tipo VARCHAR(20) NULL,
  motivo VARCHAR(300) NULL,
  estado_smtp VARCHAR(20) NULL,
  clasificacion VARCHAR(60) NULL,
  correo VARCHAR(512) NULL,
  prospecto_id BIGINT UNSIGNED NULL,
  envio_id BIGINT UNSIGNED NULL,
  ocurrio_en DATETIME NOT NULL,
  recibido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resultado ENUM('desactivado', 'contado', 'suprimido', 'baja_persona', 'ignorado') NOT NULL,
  UNIQUE KEY uq_eventos_sendgrid_sg_event_id (sg_event_id),
  INDEX idx_eventos_sendgrid_prospecto (prospecto_id, ocurrio_en),
  INDEX idx_eventos_sendgrid_evento (evento, tipo, recibido_en)
);

-- statement-break

-- El último rebote que desactivó al prospecto (estado 'rebotado'), para
-- verlo en Administración y poder reactivarlo (estado_previo_rebote).
ALTER TABLE prospectos
  ADD COLUMN tipo_rebote ENUM('duro', 'suave') NULL AFTER fila_estado_previo,
  ADD COLUMN motivo_rebote VARCHAR(300) NULL AFTER tipo_rebote,
  ADD COLUMN fecha_rebote DATETIME NULL AFTER motivo_rebote,
  ADD COLUMN estado_previo_rebote VARCHAR(60) NULL AFTER fecha_rebote,
  ADD INDEX idx_prospectos_fecha_rebote (fecha_rebote);
