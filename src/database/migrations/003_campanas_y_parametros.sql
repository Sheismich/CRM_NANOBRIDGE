CREATE TABLE campanas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  canal ENUM('correo', 'whatsapp') NOT NULL DEFAULT 'correo',
  estado ENUM('borrador', 'activa', 'pausada', 'finalizada') NOT NULL DEFAULT 'borrador',
  fecha_inicio DATE NULL,
  fecha_fin DATE NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- statement-break
-- prospectos.campana_id existe desde 001_initial_schema.sql pero nunca tuvo
-- FK (no existía campanas todavía). La agregamos ahora que sí existe.
ALTER TABLE prospectos
  ADD INDEX idx_prospectos_campana (campana_id),
  ADD CONSTRAINT fk_prospectos_campana FOREIGN KEY (campana_id) REFERENCES campanas(id);

-- statement-break
CREATE TABLE parametros_automatizacion (
  clave VARCHAR(80) PRIMARY KEY,
  valor JSON NOT NULL,
  descripcion VARCHAR(255) NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- statement-break
INSERT INTO parametros_automatizacion (clave, valor, descripcion) VALUES
  ('max_contactos_totales', '3', 'Envio inicial + maximo dos recordatorios (PLAN_N8N_DEFINITIVO.md, Politica de contactos)'),
  ('max_intentos_correccion', '2', 'Intentos de correccion automatica de formato antes de pasar a revision manual (diagrama PARTE 1, paso 3/D2)'),
  ('dias_habiles_espera_seguimiento', '5', 'Dias habiles de espera entre el flujo inicial y el seguimiento (tambien usado como ventana de espera de respuesta e intervalo entre recordatorios)'),
  ('sla_tarea_horas', '24', 'Horas de SLA para que el Equipo CRM atienda una tarea de alerta (diagrama PARTE 2, paso 10)'),
  ('scoring_reintentos_max', '3', 'Maximo de reintentos de scoring con Gemini antes de usar scoring por reglas'),
  ('scoring_reintentos_espera_seg', '[5, 30, 120]', 'Esperas entre reintentos de scoring, en segundos'),
  ('whatsapp_habilitado', 'false', 'WhatsApp permanece apagado hasta contar con proveedor y reglas aprobadas'),
  ('correo_via_webhook', 'true', 'Correo entra por webhook del proveedor; no se usa polling');
