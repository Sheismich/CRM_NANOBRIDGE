-- Freno de login POR CUENTA (B1 del plan de fixes, 2-oct-2026). El límite
-- por IP (RateLimitGuard) vive en la memoria de cada instancia: en Cloud Run
-- se reinicia con cada instancia nueva o deploy, cada instancia lleva el
-- suyo, y basta con cambiar de IP para esquivarlo. Esta tabla cuenta los
-- fallos por correo en MySQL, igual para todas las instancias: 10 fallos en
-- 15 minutos bloquean esa cuenta 15 minutos (AuthService.login).
--
-- Una fila por correo intentado, exista o no la cuenta (así el bloqueo no
-- revela qué correos tienen cuenta). Un login correcto borra su fila. Fechas
-- en UTC, comparadas siempre con CURRENT_TIMESTAMP de MySQL.
CREATE TABLE login_fallos (
  correo VARCHAR(254) NOT NULL PRIMARY KEY,
  fallos INT UNSIGNED NOT NULL DEFAULT 0,
  ventana_inicio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bloqueado_hasta DATETIME NULL
);
