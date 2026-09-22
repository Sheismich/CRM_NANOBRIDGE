-- Facebook e Instagram junto a LinkedIn (PLAN_FRONTEND.md, pregunta abierta
-- "redes sociales"). Mismo patron que linkedin_url: columnas de la propia
-- empresa/contacto, NO filas de medios_contacto -- esa tabla es de canales
-- por los que la automatizacion puede escribir (correo/telefono/whatsapp,
-- con UNIQUE global y estado no_contactar), y un perfil de red social es un
-- dato de referencia que no se contacta ni se deduplica.
ALTER TABLE empresas
  ADD COLUMN facebook_url VARCHAR(2048) NULL AFTER linkedin_url,
  ADD COLUMN instagram_url VARCHAR(2048) NULL AFTER facebook_url;

-- statement-break

ALTER TABLE contactos
  ADD COLUMN facebook_url VARCHAR(2048) NULL AFTER linkedin_url,
  ADD COLUMN instagram_url VARCHAR(2048) NULL AFTER facebook_url;
