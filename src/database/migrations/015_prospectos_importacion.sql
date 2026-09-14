-- Alta manual e importación CSV de prospectos (PLAN_CRM_DEFINITIVO.md módulo
-- 3: "Alta manual e importación CSV... Los borradores viven en
-- borradores_captura, expiran a los 30 días y no activan automatización").
--
-- Una fila de CSV (o un alta manual individual) nunca crea empresas/
-- contactos/prospectos directamente: primero cae aquí como borrador,
-- pasa por validación (correo, teléfono, giro, tamaño, canal) y
-- deduplicación (correo normalizado y después teléfono normalizado, igual
-- que automatizacion.service.ts), y solo se promueve a un prospecto real
-- cuando un usuario de sesión lo confirma explícitamente. Esto separa el
-- camino humano (borradores_captura, requiere revisión) del camino de
-- automatización (automatizacion.service.registrarProspecto, ya
-- confiable por venir de n8n con validaciones previas) sin duplicar la
-- lógica de deduplicación -- ambos reusan normalizeEmail/normalizePhone y
-- el mismo criterio de "coincidencia por correo, luego por teléfono".
CREATE TABLE borradores_captura (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Agrupa todas las filas de una misma carga (un archivo CSV = un lote;
  -- un alta manual individual también genera su propio lote de 1 fila,
  -- así ambos caminos comparten el mismo modelo de revisión/confirmación).
  lote_id VARCHAR(64) NOT NULL,
  fuente VARCHAR(255) NOT NULL,
  fila_numero INT UNSIGNED NOT NULL,
  -- Copia cruda de la fila tal cual llegó (antes de mapear a las columnas
  -- de abajo): permite auditar qué decía el CSV original si el mapeo o la
  -- normalización resulta cuestionable en revisión humana.
  fila_original JSON NOT NULL,

  -- NULL permitido en estas tres columnas (a diferencia de empresas.nombre_legal
  -- y contactos.nombre, que exigen NOT NULL): una fila de CSV genuinamente
  -- incompleta -- sin nombre de empresa, sin nombre de contacto, o con un
  -- canal que no corresponde a ningún medio -- igual se registra aquí como
  -- 'rechazado' con el detalle en `errores`, en vez de descartarse en
  -- silencio o tumbar la importación completa. Solo se exige NOT NULL en
  -- prospectosService antes de promover un borrador a prospecto real.
  empresa_nombre_legal VARCHAR(255) NULL,
  empresa_giro VARCHAR(120) NULL,
  empresa_tamano ENUM('micro', 'pequena', 'mediana', 'grande') NULL,
  empresa_region VARCHAR(120) NULL,
  empresa_estado VARCHAR(120) NULL,
  empresa_ciudad VARCHAR(120) NULL,
  empresa_pais CHAR(2) NOT NULL DEFAULT 'MX',
  empresa_sitio_web VARCHAR(2048) NULL,

  contacto_nombre VARCHAR(160) NULL,
  contacto_puesto VARCHAR(160) NULL,

  correo VARCHAR(254) NULL,
  correo_normalizado VARCHAR(254) NULL,
  telefono VARCHAR(40) NULL,
  telefono_normalizado VARCHAR(40) NULL,
  canal_inicial ENUM('correo', 'telefono', 'whatsapp') NULL,

  confianza ENUM('alta', 'media', 'baja') NULL,
  prioridad ENUM('alta', 'media', 'baja') NULL,
  score DECIMAL(5, 2) NULL,
  fuente_url VARCHAR(2048) NULL,
  observaciones TEXT NULL,

  -- pendiente_revision: pasó validación, sin coincidencia -- lista para
  --   confirmar.
  -- duplicado: coincide por correo/teléfono con un contacto existente (en
  --   BD, match_contacto_id) o con otra fila del mismo lote (dentro del
  --   archivo, ver errores) -- requiere decisión humana, nunca se
  --   fusiona sola (PLAN_CRM_DEFINITIVO.md: "la razón social nunca
  --   fusiona prospectos automáticamente").
  -- importado: confirmada, ya generó empresa/contacto/prospecto real.
  -- rechazado: descartada por un usuario, o por fallar validación.
  -- expirado: pasaron 30 días sin decisión (limpieza automática).
  estado ENUM('pendiente_revision', 'duplicado', 'importado', 'rechazado', 'expirado') NOT NULL DEFAULT 'pendiente_revision',
  match_contacto_id BIGINT UNSIGNED NULL,
  match_motivo ENUM('correo', 'telefono') NULL,
  errores JSON NULL,

  prospecto_id BIGINT UNSIGNED NULL,
  campana_id BIGINT UNSIGNED NULL,

  creado_por BIGINT UNSIGNED NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- creado_en + 30 días, calculado al insertar (no en cada lectura) para
  -- que el índice de limpieza (idx_borradores_estado_expira) pueda
  -- filtrar por columna en vez de una expresión.
  expira_en DATETIME NOT NULL,
  procesado_en DATETIME NULL,
  procesado_por BIGINT UNSIGNED NULL,

  INDEX idx_borradores_lote (lote_id),
  INDEX idx_borradores_estado_expira (estado, expira_en),
  CONSTRAINT fk_borradores_match_contacto FOREIGN KEY (match_contacto_id) REFERENCES contactos(id),
  CONSTRAINT fk_borradores_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id),
  CONSTRAINT fk_borradores_campana FOREIGN KEY (campana_id) REFERENCES campanas(id),
  CONSTRAINT fk_borradores_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_borradores_procesado_por FOREIGN KEY (procesado_por) REFERENCES usuarios(id)
);
