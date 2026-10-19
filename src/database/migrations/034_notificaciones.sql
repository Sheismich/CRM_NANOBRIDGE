-- Avisos al vendedor (etapa 2 de las mejoras, 19-oct-2026).
--
-- La campanita del CRM: cada fila es un aviso para UNA persona. Se crea en
-- la misma transacción donde pasa la cosa (le asignan una tarea, llega un
-- interesado, se vence una tarea, le rechazan un documento, llega una
-- respuesta por clasificar), así nunca hay aviso de algo que no pasó.
--
-- - enlace: ruta del CRM a la que lleva el clic (ej. /tareas?vista=todas&tarea=5).
-- - correo_estado: 'no_aplica' = solo campanita (el tipo no lleva correo o
--   la persona apagó sus correos); 'pendiente' = el correo sale al terminar
--   la petición; 'enviado' / 'fallido'. Los fallidos se reintentan en el
--   trabajo diario sla-tareas, hasta 3 intentos.
CREATE TABLE notificaciones (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  titulo VARCHAR(200) NOT NULL,
  cuerpo VARCHAR(1000) NULL,
  enlace VARCHAR(300) NULL,
  entidad VARCHAR(40) NULL,
  entidad_id BIGINT UNSIGNED NULL,
  leida_en DATETIME NULL,
  correo_estado ENUM('no_aplica', 'pendiente', 'enviado', 'fallido') NOT NULL DEFAULT 'no_aplica',
  correo_intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  correo_error VARCHAR(500) NULL,
  correo_enviado_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notificaciones_usuario_leida (usuario_id, leida_en),
  INDEX idx_notificaciones_correo (correo_estado, correo_intentos),
  CONSTRAINT fk_notificaciones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- statement-break

-- Interruptor "Recibir avisos por correo" de cada persona (decisión del
-- 19-oct). La campanita sale siempre; esto solo apaga los correos.
ALTER TABLE usuarios ADD COLUMN avisos_por_correo BOOLEAN NOT NULL DEFAULT TRUE;
