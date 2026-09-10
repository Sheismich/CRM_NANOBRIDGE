-- Endpoints "Verificacion de envio" y "Registro de envio" (B1, pasos 9 y
-- 12 de PLAN_N8N_DEFINITIVO.md). Cada fila es un contacto de salida real
-- (envio inicial o recordatorio) hacia un prospecto. La "ventana" es el
-- plazo de espera de 5 dias habiles (politica de contactos) antes de poder
-- mandar el siguiente recordatorio; queda abierta hasta que llega una
-- respuesta (la futura "Respuesta recibida" la cerraria) o vence por
-- tiempo (la futura "Ventanas vencidas" la marca como tal). Maximo 3 filas
-- por prospecto+canal (envio inicial + dos recordatorios).
CREATE TABLE envios (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prospecto_id BIGINT UNSIGNED NOT NULL,
  canal ENUM('correo', 'whatsapp') NOT NULL DEFAULT 'correo',
  numero_contacto TINYINT UNSIGNED NOT NULL,
  ventana_vence_en DATETIME NOT NULL,
  ventana_estado ENUM('abierta', 'vencida', 'cerrada') NOT NULL DEFAULT 'abierta',
  execution_id VARCHAR(100) NULL,
  enviado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_envios_execution_id (execution_id),
  KEY idx_envios_prospecto_canal (prospecto_id, canal),
  CONSTRAINT fk_envios_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id)
);
