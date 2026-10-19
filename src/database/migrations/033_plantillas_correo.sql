-- Plantillas de correo editables (etapa 1 de las mejoras, 19-oct-2026).
--
-- El texto de los correos de prospección vivía en el nodo "Armar correo
-- SendGrid" de PT1b (texto TEMPORAL de prueba). Ahora vive aquí: un
-- administrador o supervisor lo cambia desde Administración y
-- POST /automatizacion/envios le regresa a n8n el correo ya armado.
--
-- - numero: 1 = correo inicial, 2 = recordatorio 1, 3 = recordatorio 2 (el
--   número de contacto de la persona en su ciclo, numero_en_ciclo).
-- - giro: '' = general. Por ahora solo hay generales (decisión del 19-oct);
--   la columna deja lugar a versiones por giro sin otra migración. Va como
--   '' y no NULL para que el UNIQUE no deje dos generales del mismo número.
-- - Las 3 generales se siembran aquí con un borrador: nunca falta plantilla.
CREATE TABLE plantillas_correo (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  giro VARCHAR(120) NOT NULL DEFAULT '',
  numero TINYINT UNSIGNED NOT NULL,
  asunto VARCHAR(200) NOT NULL,
  cuerpo TEXT NOT NULL,
  actualizado_por BIGINT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plantillas_correo_giro_numero (giro, numero),
  CONSTRAINT chk_plantillas_correo_numero CHECK (numero BETWEEN 1 AND 3),
  CONSTRAINT fk_plantillas_correo_usuario FOREIGN KEY (actualizado_por) REFERENCES usuarios(id)
);

-- statement-break

INSERT INTO plantillas_correo (giro, numero, asunto, cuerpo) VALUES
  ('', 1, 'Una propuesta para {{empresa}}', 'Hola {{primer_nombre}},\n\nLe escribo de NANOBRIDGE. Nos gustaría conocer a {{empresa}} y platicarle cómo podemos apoyarles.\n\n¿Le parece bien una llamada breve de 15 minutos esta semana o la próxima? Si me responde este correo con el día y la hora que le acomoden, con gusto me adapto.\n\nSaludos,\nEquipo NANOBRIDGE'),
  ('', 2, 'Seguimiento: propuesta para {{empresa}}', 'Hola {{primer_nombre}},\n\nLe escribí hace unos días y quería saber si tuvo oportunidad de leer mi correo.\n\nSi le interesa, en una llamada de 15 minutos le cuento cómo podemos apoyar a {{empresa}}. Basta con responder este correo.\n\nSaludos,\nEquipo NANOBRIDGE'),
  ('', 3, 'Último mensaje para {{empresa}}', 'Hola {{primer_nombre}},\n\nEste es mi último mensaje, para no llenar su bandeja. Si más adelante les interesa conocer lo que hacemos en NANOBRIDGE, con gusto le atiendo: solo responda este correo.\n\nGracias por su tiempo.\n\nSaludos,\nEquipo NANOBRIDGE');

-- statement-break

-- Pie de todos los correos de prospección (domicilio y enlace al aviso de
-- privacidad). Vacío hasta que Carlos pase el domicilio. El link de baja no
-- va aquí: lo sigue poniendo SendGrid (subscription_tracking de PT1b).
INSERT INTO parametros_automatizacion (clave, valor, descripcion) VALUES
  ('pie_correo', '""', 'Pie de los correos de prospeccion (domicilio, aviso de privacidad); se edita en Administracion');

-- statement-break

-- Qué texto salió en cada envío: plantilla_id para volver a armarlo en un
-- reintento de n8n, asunto para el historial.
ALTER TABLE envios
  ADD COLUMN plantilla_id BIGINT UNSIGNED NULL,
  ADD COLUMN asunto VARCHAR(200) NULL;
