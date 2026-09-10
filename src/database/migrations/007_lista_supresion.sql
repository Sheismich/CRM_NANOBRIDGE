-- La supresion aplica por contacto y medio especifico, no por toda la
-- empresa (PLAN_CRM_DEFINITIVO.md, decisiones de diseno cerradas). Es una
-- tabla independiente de medios_contacto: sigue existiendo aunque el
-- contacto se borre/desactive, y aplica tambien a valores que todavia no
-- tienen un medios_contacto asociado (alguien puede pedir baja antes de
-- que ese correo/telefono exista como prospecto).
CREATE TABLE lista_supresion (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('correo', 'telefono', 'whatsapp') NOT NULL,
  valor_normalizado VARCHAR(512) NOT NULL,
  motivo VARCHAR(255) NOT NULL,
  execution_id VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supresion_tipo_valor (tipo, valor_normalizado)
);
