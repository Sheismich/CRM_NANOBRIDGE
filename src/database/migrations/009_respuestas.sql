-- Endpoints "Respuesta recibida" y "Respuesta clasificada" (B2, pasos 16 y
-- 17 de PLAN_API_DEFINITIVO.md). Dos escrituras separadas sobre la misma
-- fila -> dos columnas de execution_id independientes (recepcion y
-- clasificacion), igual que otras tablas de automatizacion que necesitan
-- idempotencia por cada paso.
-- envio_id queda NULL cuando la respuesta llega fuera de una ventana
-- abierta (respuesta tardia: PLAN_N8N_DEFINITIVO.md "procesar respuestas
-- tardias: crear tarea comercial, no reiniciar automaticamente el
-- outbound") o cuando no hay ningun envio previo registrado para ese
-- prospecto+canal.
CREATE TABLE respuestas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prospecto_id BIGINT UNSIGNED NOT NULL,
  envio_id BIGINT UNSIGNED NULL,
  canal ENUM('correo', 'whatsapp') NOT NULL DEFAULT 'correo',
  contenido TEXT NULL,
  tardia BOOLEAN NOT NULL DEFAULT FALSE,
  estado ENUM('pendiente_clasificacion', 'clasificada') NOT NULL DEFAULT 'pendiente_clasificacion',
  clasificacion ENUM('interesado', 'no_interesado', 'baja', 'automatica', 'ambigua') NULL,
  comentario VARCHAR(500) NULL,
  execution_id VARCHAR(100) NULL,
  execution_id_clasificacion VARCHAR(100) NULL,
  recibido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clasificado_en DATETIME NULL,
  UNIQUE KEY uq_respuestas_execution_id (execution_id),
  UNIQUE KEY uq_respuestas_execution_id_clasificacion (execution_id_clasificacion),
  KEY idx_respuestas_prospecto (prospecto_id),
  CONSTRAINT fk_respuestas_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id),
  CONSTRAINT fk_respuestas_envio FOREIGN KEY (envio_id) REFERENCES envios(id)
);
