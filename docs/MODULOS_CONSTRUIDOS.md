# Módulos construidos — referencia

Qué hace cada módulo del backend, ya implementado en `main`. A diferencia de `docs/planes/` (que describe lo que *se planeó* antes de construir), esto describe lo que *ya existe y corre*, con base en el código real, no en la intención original — donde hubo una decisión de diseño no explícita en los planes, se marca como tal.

Todos los endpoints viven bajo `/api/v1/*` salvo `GET /health`. Dos mecanismos de autenticación conviven en la API:

- **Sesión de usuario** (cookie, `SessionAuthGuard` + `RolesGuard`): todo lo que usa el CRM.
- **`X-API-Key`** (`ApiKeyGuard`): solo `/api/v1/automatizacion/*`, que es lo que consume n8n.

## Auth (`src/auth/`)

- `POST /auth/bootstrap` — crea el primer usuario (rol `administrador`) si todavía no existe ninguno; si ya hay usuarios, rechaza. A partir de ese primer usuario, dar de alta más cuentas es cosa de `POST /api/v1/usuarios` (ver sección "Usuarios y auditoría" abajo) — bootstrap solo resuelve el arranque en frío.
- `POST /auth/login` / `POST /auth/logout` — cookie de sesión (`SESSION_COOKIE_NAME`), contraseña con Argon2id.
- `GET /auth/me` — usuario actual.
- Roles: `administrador`, `supervisor`, `agente`, `sistema`. El rol `sistema` está excluido de autenticar por cookie (es para procesos internos, no para login humano) y también excluido de los roles asignables desde `POST/PATCH /usuarios` — una cuenta con ese rol nunca podría iniciar sesión.

## CRM — Empresas y contactos (`src/crm/empresas.controller.ts`)

- `GET/POST /empresas`, `GET/PATCH/DELETE /empresas/:id`.
- `POST/PATCH/DELETE /empresas/:id/contactos/:contactoId` — gestión de contactos anidada bajo su empresa.
- `GET/POST /contactos`, `GET/PATCH/DELETE /contactos/:id` (`src/crm/contactos.controller.ts`) — vista plana para buscar/abrir un contacto sin conocer su empresa (filtros `empresaId`, `q` por nombre; paginado por contacto). Las escrituras delegan en `EmpresasService`, así que comparten validaciones, bloqueo, 409 por medio duplicado y auditoría con las rutas anidadas. Diferencia de contrato: los medios de contacto van anidados en `medios` (una fila por contacto), no una fila por medio como en `GET /empresas/:id`. Mismo scoping: un agente solo ve/edita contactos de sus empresas; lo ajeno responde 404.
- Cada empresa tiene un `propietarioId`: un `agente` solo ve/edita las suyas; `supervisor`/`administrador` ven todas.
- Borrado es lógico (`activo`), nunca físico — consistente con "no se borra información; se desactiva" del plan.
- Redes sociales (22-sep-2026, migración `021_redes_sociales.sql`): además de `linkedin_url`/`sitio_web`, empresas y contactos tienen `facebook_url`/`instagram_url`. Los cuatro campos son `http`/`https` únicamente (`src/shared/http-url.ts`) — antes aceptaban cualquier esquema, incluido `javascript:`.

## CRM — Actividades (`src/crm/actividades.controller.ts`)

- `GET /actividades` (timeline por empresa/contacto/oportunidad) y `POST /actividades` (registro manual — llamadas y WhatsApp se capturan a mano, como define el plan).
- Exige que la empresa esté activa y que el usuario sea dueño (o supervisor/admin) antes de dejar registrar o ver.

## CRM — Prospectos (`src/crm/prospectos.controller.ts`)

Alta manual e importación CSV vía `borradores_captura` — ver `docs/planes/S3_ESQUEMA_PROSPECTOS_Y_PLAN_PRUEBAS.md` para el detalle completo del esquema y las pruebas.

## Tareas y cola de clasificación (`src/tareas/`)

- `GET/POST /tareas`, `GET /tareas/:id`, `PATCH /tareas/:id/cerrar`.
- Tipos: `seguimiento`, `clasificacion`, `revision_documento`, `otro`. Prioridades: `baja`, `media`, `alta`, `urgente`.
- `GET /cola-clasificacion` — atajo que filtra `tareas` a `tipo=clasificacion, estado=pendiente` (no es una tabla aparte).
- `POST /cola-clasificacion/:id/clasificar` — solo `administrador`/`supervisor`. Aplica la decisión (`interesado`, `no_interesado`, `baja`, `invalido`, `reagendar`) en la misma transacción y genera un evento en `eventos_pendientes` (outbox) como aviso, nunca llama a n8n directo. Detalle de cada clasificación en el README ("Cola de clasificación").

## Usuarios y auditoría (`src/usuarios/`)

- `GET /usuarios`, `GET /usuarios/:id` (`administrador`/`supervisor`), `POST/PATCH/DELETE /usuarios/:id` (solo `administrador`) — CRUD de cuentas; `DELETE` es baja lógica (`activo=false`), igual que empresas.
- Roles asignables desde aquí: `administrador`, `supervisor`, `agente` — `sistema` queda fuera a propósito (ver Auth arriba).
- `passwordHash` nunca sale de la capa de datos: ni en las respuestas de `list()`/`get()` ni en los payloads de `auditoria` que genera `create()`/`update()` (que registran `password: "actualizada"`, nunca el valor).
- Guard de "no te quedes sin administradores": `update()` (cuando el rol sale de `administrador`) y `deactivate()` verifican que quede al menos un administrador activo antes de aplicar el cambio (`409` si no); una cuenta no puede desactivarse a sí misma (`409`) tampoco.
- Concurrencia: `update()`/`deactivate()` toman los locks siempre en el mismo orden (fila del rol `administrador` primero, luego la fila del usuario objetivo) para que dos solicitudes simultáneas sobre dos administradores distintos no terminen en deadlock de MySQL en vez de un `409` limpio.
- `GET /auditoria` (`administrador`/`supervisor`, solo lectura) — log de cambios (`antes`/`despues` en JSON) que escriben el resto de los módulos (empresas, usuarios, tareas, etc.); filtra por `entidad`, `entidad_id`, `usuario_id`, `accion`, `desde`/`hasta`, y ordena más reciente primero (a diferencia de las listas normales del CRM, que ordenan por id/nombre ascendente).

## Outbox / eventos pendientes / procesos fallidos (`src/outbox/`)

- Patrón outbox obligatorio: ninguna pantalla del CRM llama a n8n directamente; todo pasa por `eventos_pendientes`.
- `OutboxDispatcherService` — job por `@Interval` (`OUTBOX_DISPATCH_INTERVAL_MS`) que entrega a n8n en lotes de 20, con `SELECT ... FOR UPDATE SKIP LOCKED` para que no se dupliquen entregas si corre más de una instancia del backend.
- Reintentos: 3 intentos después del inicial (4 en total) con backoff 5s / 30s / 120s. Si se agotan, el evento pasa a `procesos_fallidos`.
- `GET /eventos-pendientes`, `POST /eventos-pendientes/:id/reintentar` (manual), `POST /eventos-pendientes/despachar` (forzar una corrida) — los tres solo para `administrador`.
- `GET /procesos-fallidos`, `PATCH /procesos-fallidos/:id/estado` (solo `administrador`) — ya no es solo el respaldo del outbox interno: desde que se sumó B4 Error Workflow (`POST /automatizacion/errores-workflow`), la tabla también recibe fallas reportadas por n8n con `execution_id`, `workflow`, `nodo`, `endpoint`, `codigo_http`. El viejo booleano `resuelto` se reemplazó por `estado` (`abierto` / `en_revision` / `resuelto`) para poder distinguir "en revisión" de "resuelto", igual que `incidencias`.

## Automatización — n8n (`src/automatizacion/`)

Los 18 endpoints de `PLAN_API_DEFINITIVO.md` (17 originales + `POST /errores-workflow` de B4 Error Workflow), todos protegidos con `X-API-Key` (nunca sesión de usuario): parámetros, catálogos, scoring, incidencias, errores de workflow, registro y estado de prospecto, validaciones, tareas, verificación/registro de envío, ventanas vencidas, campaña activa, supresión (consulta y registro), respuesta recibida y clasificada.

Reglas clave:
- Idempotencia por `execution_id` — un reintento del mismo evento de n8n devuelve `200` con `ya_existia: true` en vez de duplicar.
- `registrarEnvio()` valida supresión dentro de la misma transacción con `FOR UPDATE` sobre el medio de contacto, para que un `registrarSupresion()` concurrente no se cuele entre el chequeo y la confirmación.
- Nunca se envía correo, teléfono, descripción libre ni documentos a Gemini para el scoring (regla de `PLAN_N8N_DEFINITIVO.md`).

## Comercial — Oportunidades (`src/comercial/oportunidades.controller.ts`)

- Pipeline dinámico: las etapas viven en la tabla `catalogo_etapa_embudo` (con su `probabilidad`, `orden`, `es_cierre`, `es_ganada`), no como enum fijo en código — se pueden ajustar sin migrar.
- `GET /oportunidades` — filtros `responsableId`, `empresaId` (para la ficha de cliente), `etapaClave`, `cerrada`. Un agente solo ve las que tiene asignadas.
- `PATCH /:id/etapa` — cambiar de etapa; perder exige `motivo_perdida_id` (catálogo `catalogo_motivo_perdida`) y `motivo_perdida_detalle` si el motivo es "otro".
- `PATCH /:id/reabrir` — una oportunidad perdida se puede reabrir conservando su historial (`historial_etapa_oportunidad`).
- `create()` valida que el `contactoId`/`prospectoId` que le pasas de verdad pertenezcan a la `empresaId` dada — no se puede cruzar contactos de otra empresa.
- Cambios de etapa concurrentes sobre la misma oportunidad abierta usan CAS (compare-and-swap): el segundo PATCH que llega tarde recibe `409` en vez de pisar en silencio al primero.

## Comercial — Cotizaciones (`src/comercial/cotizaciones.controller.ts`)

- Estados con máquina de transición explícita: `borrador → enviada → {aceptada, rechazada, vencida}`; `aceptada`/`rechazada`/`vencida` son terminales salvo por versionado.
- `POST /:id/version` — nunca se edita una cotización enviada; se crea una nueva versión y la anterior queda `obsoleta`. No se puede versionar algo ya `obsoleta`.
- Importes en `DECIMAL`, nunca `float` (regla explícita del plan).
- No se puede cotizar contra una oportunidad ya cerrada ni contra una empresa desactivada.

## Documentos (`src/documentos/`)

- Dos drivers de storage intercambiables: `gcs-storage.driver.ts` (Google Cloud Storage privado, producción) y `local-storage.driver.ts` (para desarrollo sin credenciales de GCS).
- Tamaño máximo configurable (`STORAGE_MAX_FILE_SIZE_MB`, 25 MB por default, como pide el plan). Tipos permitidos: PDF, DOCX, XLSX, PNG, JPG.
- La extensión del archivo guardado sale del mimetype ya validado, no del nombre que manda el cliente (evita que alguien suba un `.exe` renombrado a `.pdf`).
- `GET /:id/descarga` — URL firmada de corta duración, el archivo lo sirve GCS directamente una vez emitida (el backend no hace de proxy del binario).
- `POST /:id/version`, `PATCH /:id/estado`, `PATCH /:id/revisar` — versionado y flujo de revisión; cada acción queda en `auditoria`.
- `FileInterceptor` fuerza `defParamCharset: "utf8"` (22-sep-2026) — multer decodifica el nombre del archivo subido como `latin1` por default, así que un archivo con acentos o "ñ" en el nombre (`Cotización firmada.pdf`) se guardaba ya con `nombre_original` corrupto sin esto.

## Reportes (`src/reportes/`)

- Solo `administrador`/`supervisor` (un `agente` ya ve lo suyo filtrado en `/oportunidades`, `/tareas`, `/cotizaciones` — estos reportes cruzan datos de *todos* los agentes).
- `GET /actividades`, `/tareas`, `/pipeline/conversion-etapas`, `/pipeline/resumen`, `/forecast`, `/desempeno-por-agente`, `/export/:reporte` (CSV).
- `GET /desempeno-por-agente` (22-sep-2026): junta actividades + tareas cerradas/vencidas + oportunidades ganadas/ingresos, ya agrupadas por agente, en una sola llamada — antes armar esa tabla exigía llamar `/tareas` y `/pipeline/resumen` una vez por agente (ninguno de los dos acepta una lista de `responsableId`) y unir todo a mano en el frontend. Incluye a todos los agentes activos aunque no tengan ninguna fila en el rango (aparecen en ceros, no desaparecen de la tabla). `metricas_comerciales_diarias` queda fuera: es un agregado global del día, sin desglose por agente.
- Los reportes se calculan **en vivo** en cada consulta. Aparte, la tabla `metricas_comerciales_diarias` ya existe y se llena con un job diario (ver README).
- La conversión por etapa identifica la etapa de entrada por su clave (`"calificada"`), no por un número de orden que podría cambiar si se reordena el catálogo.

## Health (`src/health/`)

- `GET /health` — hace `SELECT 1` contra MySQL de verdad y responde `503` si no hay conexión, en vez de un "ok" fijo aunque la base esté caída.

## Lo que todavía no existe como módulo propio

Ver README, sección "Qué falta" para lo pendiente real (cobertura de pruebas y reconectar n8n a los endpoints reales).
