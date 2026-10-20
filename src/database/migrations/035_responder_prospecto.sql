-- Responder al prospecto desde el CRM, con borrador de IA (etapa 3 de las
-- mejoras, plan aprobado por Fabián el 20-oct-2026).
--
-- respuestas: el Message-ID y el asunto del correo del cliente, si PT2 los
-- manda. Con el Message-ID la respuesta del vendedor lleva In-Reply-To y
-- References y queda en el mismo hilo; sin él se arma "Re: <asunto>" con el
-- correo que se le mandó, que Gmail y Outlook casi siempre juntan igual.
ALTER TABLE respuestas
  ADD COLUMN message_id VARCHAR(255) NULL,
  ADD COLUMN asunto VARCHAR(500) NULL;

-- statement-break

-- Lo que el vendedor le contestó al prospecto. No es un envío de
-- prospección: no va en `envios`, no cuenta para el límite de 3 contactos ni
-- abre ventanas (P3.5).
--
-- - estado: 'enviando' se guarda ANTES de llamar a SendGrid y pasa a
--   'enviado' o 'fallido' al terminar (propuesta de Fabián): así nunca hay
--   un correo que salió sin registro. Mientras haya uno 'enviando' de la
--   misma respuesta no se manda otro (evita el doble clic).
-- - uso_ia: si se mandó sin IA, el borrador tal cual o editado (P3.11).
-- - Un prospecto con algún correo 'enviado' está "en conversación": sus
--   respuestas nuevas le llegan a ese vendedor en vez de ir a la cola.
CREATE TABLE correos_respuesta (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  respuesta_id BIGINT UNSIGNED NOT NULL,
  prospecto_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  para VARCHAR(320) NOT NULL,
  asunto VARCHAR(500) NOT NULL,
  texto TEXT NOT NULL,
  uso_ia ENUM('sin_ia', 'tal_cual', 'editado') NOT NULL DEFAULT 'sin_ia',
  estado ENUM('enviando', 'enviado', 'fallido') NOT NULL DEFAULT 'enviando',
  error VARCHAR(300) NULL,
  proveedor_id VARCHAR(255) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_en DATETIME NULL,
  INDEX idx_correos_respuesta_respuesta (respuesta_id, estado),
  INDEX idx_correos_respuesta_prospecto (prospecto_id, estado),
  CONSTRAINT fk_correos_respuesta_respuesta FOREIGN KEY (respuesta_id) REFERENCES respuestas(id),
  CONSTRAINT fk_correos_respuesta_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id),
  CONSTRAINT fk_correos_respuesta_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- statement-break

-- Cada vez que alguien le pide algo a la IA desde el CRM: sirve para el
-- límite diario por persona (P3.12) y para comparar el borrador con lo que se
-- mandó (P3.11). La etapa 4 (resumen de la ficha) la reutiliza con otro tipo.
CREATE TABLE uso_ia (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  respuesta_id BIGINT UNSIGNED NULL,
  resultado TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uso_ia_usuario_fecha (usuario_id, creado_en),
  CONSTRAINT fk_uso_ia_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
