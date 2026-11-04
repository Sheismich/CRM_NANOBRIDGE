-- A quién salió cada correo y qué pasó con él (diagnóstico, 4-nov-2026).
--
-- envios se registra ANTES de mandar (n8n necesita el reply_to firmado), así
-- que hasta ahora un correo que SendGrid rechazaba contaba como enviado.
-- - destinatario: la dirección que eligió la API. NULL en filas viejas.
-- - estado: 'registrado' al crearse; n8n lo confirma después de SendGrid
--   (POST /automatizacion/envios/:id/confirmacion).
-- - proveedor_id: el id del mensaje en SendGrid.
ALTER TABLE envios
  ADD COLUMN destinatario VARCHAR(512) NULL AFTER asunto,
  ADD COLUMN estado ENUM('registrado', 'enviado', 'fallido') NOT NULL DEFAULT 'registrado' AFTER destinatario,
  ADD COLUMN proveedor_id VARCHAR(255) NULL AFTER estado,
  ADD COLUMN error VARCHAR(300) NULL AFTER proveedor_id,
  ADD INDEX idx_envios_estado (estado, enviado_en);

-- statement-break

-- Qué evento de SendGrid causó la supresión (bounce, spamreport...). NULL si
-- vino de otro lado. Lo usa el freno automático del dominio.
ALTER TABLE lista_supresion
  ADD COLUMN evento VARCHAR(40) NULL AFTER motivo,
  ADD INDEX idx_supresion_evento (evento, creado_en);
