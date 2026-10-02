# Nanobridge CRM API

Backend modular único para el CRM y la automatización outbound. El CRM y n8n usan HTTP; solo este servicio ejecuta SQL en MySQL.

Implementado con **NestJS** (módulos, controladores, servicios, guards) sobre Express (la plataforma HTTP por defecto de Nest), con **Drizzle ORM** como capa de acceso a datos.

## Inicio local

1. Copia `.env.example` como `.env` y configura una instancia local de MySQL.
2. Instala dependencias con `npm install`.
3. Ejecuta `npm run migrate`.
4. Ejecuta `npm run start:dev`.

El health check queda disponible en `GET /health`.

## Despliegue (Cloud Run + Cloud SQL)

**✅ Desplegado (17-sep-2026)**, proyecto GCP `crm-prospeccion-outbound`, región `us-central1`:

- Cloud Run (`nanobridge-api`) sirve la imagen construida desde `Dockerfile` (multi-stage sobre `node:22-bookworm-slim` fijado por digest, corre sin root — `argon2` necesita compilar un binario nativo, requiere `python3 make g++` en la etapa de build).
- Cloud SQL (`nanobridge-db`, MySQL 8.0) conectado vía el socket nativo de Cloud Run (`--add-cloudsql-instances`), sin exponer IP privada a la app.
- Documentos usan `STORAGE_DRIVER=gcs` en producción (no `local`: el filesystem de Cloud Run es efímero y no persiste entre reinicios ni se comparte entre instancias).
- Secretos (`CRM_CALLBACK_API_KEY`, `WEBHOOK_ENTRADA_API_KEY`, `REPLY_TO_SIGNING_SECRET`, `DATABASE_URL`) viven en Secret Manager, nunca en el código ni en variables de entorno planas.
- El servicio es públicamente alcanzable (requirió una excepción a la política organizacional `iam.allowedPolicyMemberDomains`, aprobada por el Owner del proyecto) — la seguridad real la sigue haciendo la propia API (`ApiKeyGuard`/`SessionAuthGuard`), no el borde de Cloud Run.
- CSRF: una petición que cambia datos desde otro origen responde 403 `ORIGEN_NO_PERMITIDO` (`src/shared/origen-csrf.ts`). Si el front se publica en un dominio distinto al de la API (sin rewrite `/api/**`), ese origen va en `CORS_ORIGINS`.

Redesplegar tras un cambio de código:
```bash
gcloud builds submit --tag us-central1-docker.pkg.dev/crm-prospeccion-outbound/nanobridge-repo/nanobridge-api:v1
gcloud run deploy nanobridge-api --image=us-central1-docker.pkg.dev/crm-prospeccion-outbound/nanobridge-repo/nanobridge-api:v1 --region=us-central1
```

Explicación completa (qué es cada recurso, Docker local vs. producción,
migraciones contra Cloud SQL, secretos, pendientes de hardening): ver
[`docs/RUNBOOK_DEPLOY.md`](docs/RUNBOOK_DEPLOY.md).

## Pruebas automatizadas

`npm test` corre la suite con Vitest. Por default requiere **Docker Desktop
corriendo**: cada corrida levanta un contenedor MySQL 8 desechable real
(nunca se mockea la base, mismo criterio que toda la verificación manual de
este proyecto), le aplica las migraciones reales, prueba contra él por HTTP
con `supertest`, y al final lo apaga solo — no toca tu `.env` ni tu MySQL
local. Si Docker no está disponible (ej. Windows sin WSL2) o se prefiere un
MySQL ya levantado, `TEST_DATABASE_URL` apunta a uno propio en vez de crear
un contenedor -- esa base se **borra y se recrea** al inicio de cada
corrida, así que solo se acepta si su nombre contiene `test` (ver
`test/setup/global-setup.ts`), ej.:
`TEST_DATABASE_URL="mysql://root@127.0.0.1:3306/nanobridge_test" npm test`.

Cobertura (22-sep-2026, 115 pruebas en 21 archivos): `SessionAuthGuard`/
`RolesGuard`/`ApiKeyGuard` (401/403), `POST /auth/bootstrap` de un solo uso,
la regla "no dejar el sistema sin al menos un administrador activo"
(`usuarios.service.ts`) incluyendo el arreglo de interbloqueo por orden fijo
de locks, `RateLimitGuard` en `/auth/login`/`/auth/bootstrap` (incluida una
prueba con peticiones concurrentes reales, no solo secuenciales), el
backoff de reintentos del despachador outbox (5s/30s/120s), la "promoción"
de idempotencia en `registrarErrorWorkflow`, empresas/contactos y
`/contactos` (scoping por dueño para agentes, cascada al desactivar una
empresa, preservación de `no_contactar`, 409 por correo duplicado),
oportunidades (scoping por responsable, cierre/reapertura, el guard CAS
contra dos cambios de etapa concurrentes), cotizaciones (redondeo de
montos, la máquina de estados completa incluidos los saltos inválidos,
versionado con CAS contra dos versiones concurrentes, scoping por
responsable y las reglas de negocio al crear), documentos (validación de
archivo -- tipo/tamaño/vacío/nombre largo, los 5 tipos permitidos, que la
extensión de storage sale del mimetype y no del nombre del archivo,
estados, versionado con CAS, revisión, baja lógica, descarga por URL
firmada del driver local incluido un token alterado/vencido/con el archivo
ya borrado, y scoping por agente), tareas y cola de clasificación (cierre
con CAS, el endpoint de automatización para n8n con idempotencia por
`execution_id`, y las reglas propias de clasificar -- tipo y prospecto
asociado obligatorios), el job diario de métricas comerciales, `/catalogos`
de sesión (paridad exacta de contenido contra el endpoint de
automatización), `catalogo_tipo_documento` (subida real contra el driver
local de storage, 404 por tipo inexistente, herencia del tipo al
versionar), los dos jobs de alerta (documentos pendientes de revisión,
tareas con SLA vencido -- idempotencia diaria y el caso de archivar/
reactivar un documento), la auditoría de reintentos manuales
(`eventos_pendientes` y `procesos_fallidos`) y `/reportes/desempeno-por-agente`
(agrupado por agente en una sola consulta por métrica, agentes sin
actividad en el rango incluidos en ceros, filtro por `responsableId` y por
rango de fechas, exportación CSV). Es una base incremental, no cobertura
completa — ver "Qué falta" más abajo.

## Estructura del proyecto

```
src/
  main.ts                              arranque; el armado (CSRF, body, cookies, CORS, filtro) está en shared/configurar-app.ts
  app.module.ts                        módulo raíz
  health/health.controller.ts          GET /health
  config/env.ts                        variables de entorno validadas con Zod
  database/
    pool.ts                            pool de mysql2 (igual que en las versiones anteriores)
    schema.ts                          espejo tipado de la migración SQL, para Drizzle
    drizzle.constants.ts               token de inyección DRIZZLE + tipo DrizzleDb
    database.module.ts                 expone la instancia de Drizzle como provider @Global()
    migrate.ts, migrations/*.sql       migraciones (sin cambios; siguen siendo la fuente de verdad)
  shared/
    http-error.ts                      clase HttpError (igual concepto que en Express/Next)
    http-exception.filter.ts           filtro global: reemplaza errorHandler/notFound de Express
  auth/
    auth.module.ts, auth.controller.ts, auth.service.ts   POST /bootstrap, /login, /logout, GET /me
    session.service.ts                 crear/borrar sesión, fijar/borrar cookie
    passwords.ts                       hash/verify con Argon2id (sin cambios)
    guards/session-auth.guard.ts       reemplaza al middleware requireUser
    guards/roles.guard.ts + decorators/roles.decorator.ts   reemplaza a requireRole
    guards/rate-limit.guard.ts         límite de intentos por IP en /login y /bootstrap
    decorators/current-user.decorator.ts   @CurrentUser() para leer el usuario ya autenticado
    dto/credentials.schema.ts          esquemas Zod de entrada
  crm/
    crm.module.ts, empresas.controller.ts, empresas.service.ts   GET/POST /empresas, GET /empresas/:id
    contactos.controller.ts, contactos.service.ts   GET/POST /contactos, GET/PATCH/DELETE /contactos/:id (vista plana; delega las escrituras a EmpresasService)
    prospectos.controller.ts, prospectos.service.ts   alta manual e importación CSV vía borradores_captura (ver sección propia abajo)
    dto/empresa.schema.ts, dto/contacto.schema.ts, dto/prospecto.schema.ts   esquemas Zod de entrada
  tareas/
    tareas.module.ts, tareas.controller.ts, tareas.service.ts   GET/POST /tareas, GET /tareas/:id, PATCH /tareas/:id/cerrar
    cola-clasificacion.controller.ts   GET /cola-clasificacion, POST /cola-clasificacion/:id/clasificar
    dto/tarea.schema.ts                esquemas Zod de entrada
  outbox/
    outbox.module.ts, outbox.service.ts            enqueue(tx, evento) — inserta en eventos_pendientes dentro de la misma transacción
    outbox-dispatcher.service.ts                   despachador @Interval(): entrega a n8n, reintentos 5s/30s/120s, procesos_fallidos al agotarlos
    eventos-pendientes.controller.ts               GET/POST /eventos-pendientes (solo administrador)
    procesos-fallidos.controller.ts                GET /procesos-fallidos, PATCH /:id/estado (solo administrador)
```

## Capa de datos: Drizzle sobre el mismo pool de mysql2

Igual que en la versión anterior del proyecto: `src/database/schema.ts` describe con tipos las 8 tablas existentes (mirror de `001_initial_schema.sql`), y `src/database/database.module.ts` expone la instancia de Drizzle como un provider inyectable (`@Inject(DRIZZLE)`) disponible en cualquier módulo gracias a `@Global()`. **Las migraciones siguen siendo los archivos `.sql` de `src/database/migrations/`, aplicados con `npm run migrate`** — Drizzle no las genera ni las aplica, solo da tipos para consultarlas. Si agregas o cambias una migración, actualiza `schema.ts` a mano.

`drizzle.config.ts` solo sirve para `npm run db:studio` (explorar la base visualmente en desarrollo).

Las respuestas JSON siguen usando las mismas claves `snake_case` de siempre (`nombre_legal`, `propietario_id`, `medio_tipo`, etc.) aunque las columnas de `schema.ts` estén en camelCase — el contrato HTTP que ya consumen n8n y el CRM no cambió.

## Piezas idiomáticas de NestJS que reemplazan lo que había en Express/Next.js

- **Guards en vez de middleware**: `SessionAuthGuard` reemplaza al middleware `requireUser` (Express) / a la función `requireUser(request)` (Next.js). `RolesGuard` + el decorador `@Roles(...)` reemplazan a `requireRole(...)`. Se aplican con `@UseGuards(...)` a nivel de controlador o de método, el patrón estándar de Nest para autenticación y permisos.
- **Controladores + servicios en vez de un Router**: cada módulo (`auth`, `crm`) separa el controlador (qué ruta HTTP, qué status code, leer `@Body()`/`@Param()`/`@Query()`) del servicio (la lógica de negocio y las queries a Drizzle) — inyección de dependencias vía constructor, sin instanciar nada a mano.
- **Filtro global de excepciones** (`HttpExceptionFilter`) en vez del `errorHandler`/`notFound` de Express: captura `HttpError` (mismo `{error, message}` que antes), el 404 automático que lanza Nest para cualquier ruta no registrada (mismo cuerpo `{"error":"not_found","message":"Ruta no encontrada"}`), y cualquier otro error como 500 genérico — incluida una validación de Zod fallida, igual que en las versiones anteriores.
- **`cookie-parser` y `express.json({ limit: "1mb" })` vuelven** como en la versión original en Express puro, porque Nest corre sobre Express por debajo. Esto también cierra un pendiente que había quedado abierto en la versión de Next.js: ahí no se podía replicar el límite de 1 MB del body porque los Route Handlers no exponen el servidor HTTP subyacente; aquí sí, porque Nest te da acceso directo a la instancia de Express (`app.use(express.json({ limit: "1mb" }))` en `src/main.ts`).
- **`@CurrentUser()`** es un decorador de parámetro que lee `request.currentUser` (dejado ahí por `SessionAuthGuard`) y lo entrega directo como argumento del método del controlador, en vez de leer `request.currentUser` a mano en cada handler.

## Tareas, cola de clasificación y outbox (avance sobre el plan)

Siguiente prioridad del backlog (`MATRICES_Y_BACKLOG_DEFINITIVO.md`, "Prioridad siguiente": 1. Tareas y cola de clasificación) y el patrón outbox que ese módulo exige (`PLAN_CRM_DEFINITIVO.md` #5: "El patrón outbox es obligatorio: ninguna pantalla llama a n8n directamente"). Migración `002_tareas_outbox.sql` (tablas `tareas`, `eventos_pendientes`, `procesos_fallidos`) + su espejo en `schema.ts`.

- **Bandeja de tareas** (`GET/POST /api/v1/tareas`, `GET /:id`, `PATCH /:id/cerrar`): filtra por estado, prioridad, tipo y responsable. El agente solo ve/gestiona lo asignado a sí mismo (`responsable_id`); administrador y supervisor ven y filtran libremente, igual que el criterio ya usado en `empresas`. Al crear (2-oct-2026): un agente siempre se crea la tarea a sí mismo y solo sobre sus empresas (lo ajeno, 404); el contacto y el prospecto tienen que ser de esa empresa, y si solo llega el prospecto la tarea toma su contacto y su empresa; un seguimiento a una persona dada de baja responde 409 `PERSONA_EN_BAJA`. Un agente solo cierra una tarea que sigue siendo suya.
- **Cola de clasificación** (`GET /api/v1/cola-clasificacion`, `POST /:id/clasificar`): las tareas con `tipo=clasificacion` pendientes, ligadas a un `prospecto_id` y, si nacieron de una respuesta "ambigua", a su `respuesta_id`. Clasificar cierra la tarea y **aplica la decisión en la misma transacción**: la respuesta queda con esa clasificación y el prospecto cambia de estado.
  - `interesado`: el prospecto pasa a `interesado` y se crea la tarea "Contactar prospecto interesado" (seguimiento, prioridad alta, **sin asignar** para que un supervisor la reparta, fecha límite al fin del siguiente día hábil en hora de México). Lo mismo cuando clasifica n8n. La oportunidad la crea el asesor al tomarla.
  - `no_interesado`: el prospecto pasa a ese estado.
  - `baja`: el prospecto pasa a `baja` y **todos** los medios del contacto (correo, teléfono y WhatsApp) entran a `lista_supresion`, sin depender de n8n. Solo ese contacto, no los demás de la empresa. Si no tiene ninguno, se crea una incidencia `baja_sin_medios`.
  - `invalido`: el prospecto pasa a `descartado`.
  - `reagendar`: exige `fechaSeguimiento` (futura) y crea una tarea de seguimiento para esa fecha, asignada a quien clasificó; el estado del prospecto no cambia.
  - El evento `prospecto_clasificado` sigue saliendo hacia n8n, solo como aviso, y solo en la clasificación manual. Cuando clasifica n8n no se encola: n8n ya lo sabe.
  - **Nadie pisa una decisión ya tomada.** Si la respuesta ya tiene clasificación (por la IA o por otra persona) o la tarea ya se cerró, responde 409 con `code: "RESPUESTA_YA_CLASIFICADA"`, para que la pantalla muestre un mensaje claro sin comparar el texto. La única excepción es una respuesta "ambigua": resolverla es justo el trabajo de la cola. Cuando n8n clasifica directo, se cierran solas las tareas de clasificación abiertas de esa respuesta.
  - **Sugerencia de la IA** (modo sugerencia, 30-sep-2026): `respuesta.clasificacion_sugerida` muestra lo que propuso la IA (`POST /automatizacion/respuestas/sugerencia`, migración `023_sugerencia_clasificacion.sql`) o, si no hay propuesta, lo que decidió n8n. Además vienen `confianza_sugerida` (0-100) y `motivo_sugerencia`.
  - **Quién clasifica:** administradores y supervisores (decisión del 24-sep-2026). Un agente recibe 403 tanto al ver la cola (`GET`) como al clasificar. Las tareas de clasificación solo se resuelven clasificándolas: `PATCH /tareas/:id/cerrar` las rechaza con 409, porque cerrarlas por ahí no aplicaría la decisión.
- **Outbox** (`OutboxService.enqueue`): cerrar una tarea o resolver una clasificación manual inserta la fila en `eventos_pendientes` **dentro de la misma transacción** que el cambio de estado — si la transacción falla, el evento tampoco se crea, así el patrón es real y no solo un `try { await fetch() }` suelto en el controlador.
- **Despachador** (`OutboxDispatcherService`, `@Interval` de `@nestjs/schedule`, `OUTBOX_DISPATCH_INTERVAL_MS`): entrega los eventos pendientes a `N8N_WEBHOOK_URL` con el header `X-API-Key: WEBHOOK_ENTRADA_API_KEY` (mismo esquema que ya definía `PLAN_API_DEFINITIVO.md` para CRM → n8n). Reintentos idempotentes: 3 intentos con backoff 5 s / 30 s / 120 s (`MATRICES_Y_BACKLOG_DEFINITIVO.md`); al agotarlos, el evento queda `fallido` y se crea una fila en `procesos_fallidos`.
- **Pantalla de eventos pendientes** (`GET /api/v1/eventos-pendientes`, `POST /:id/reintentar`, `POST /despachar`, solo `administrador`): "los eventos fallidos son visibles y reintentables desde la pantalla de eventos pendientes" tal cual pide el plan. `/despachar` fuerza una corrida del despachador sin esperar el intervalo.

Probado de extremo a extremo con un receptor HTTP de prueba haciendo de n8n: cierre de tarea → evento entregado y marcado `enviado`; clasificación de prospecto → mismo flujo con `entidad_tipo=prospecto`; receptor caído → 3 reintentos con el backoff exacto (5 s/30 s/120 s), evento marcado `fallido` y fila creada en `procesos_fallidos`; `POST /reintentar` con el receptor de vuelta → el evento se reenvía y queda `enviado`. También roles: un agente que cierra sesión ve la bandeja vacía si las tareas son de otro responsable, recibe 404 al pedir una tarea ajena por id, y 403 en `/eventos-pendientes`.

## Campañas (1-oct-2026)

`/api/v1/campanas`:

| Endpoint | Quién | Qué hace |
|---|---|---|
| `GET /` y `GET /:id` | todos | Lista o detalle, con `prospectos` (cuántos), `activa_hoy` y `motivo` |
| `POST /` | admin, supervisor | Crea en `borrador`. Solo canal correo (WhatsApp → 400); fechas al revés → 400 |
| `PATCH /:id` | admin, supervisor | Nombre y fechas (`null` quita la fecha). Una finalizada → 409 `CAMPANA_FINALIZADA`. Fecha de fin pasada en una activa o pausada → 409 `CAMPANA_VENCIDA` (para terminarla, `finalizar`) |
| `POST /:id/activar` | admin, supervisor | Borrador o pausada → activa. Fecha de fin pasada → 409 `CAMPANA_VENCIDA` |
| `POST /:id/pausar` | admin, supervisor | Activa → pausada |
| `POST /:id/finalizar` | admin, supervisor | Es definitivo |

- Las transiciones están en un solo mapa; las inválidas responden 409 `TRANSICION_CAMPANA_INVALIDA`.
- Cada acción queda en la auditoría, con una guarda contra dos clics simultáneos.
- **Regla "¿manda hoy?"** (`shared/campana-vigente.ts`, la misma que usan PT1 y PT4, con fechas de México):
  - **activa:** ya empezó y no ha terminado;
  - **en espera:** pausada o aún sin empezar; sus recordatorios esperan y PT1 no cierra a sus prospectos;
  - **inactiva:** finalizada, en borrador o con la fecha de fin pasada.

## Contactos y lista de supresión (2-oct-2026)

- **Todas las altas de medios** (empresas, contactos, CSV, alta manual y n8n) consultan `lista_supresion`. Si el valor está suprimido, o la persona está en baja, el medio nace en `no_contactar`. Un teléfono suprimido como WhatsApp también bloquea el mismo número como teléfono.
- **Editar un contacto:** cambiar o borrar un medio en `no_contactar` responde 409 con `code: "MEDIO_SUPRIMIDO"`. Un valor nuevo que esté suprimido se guarda bloqueado. Una persona dada de baja sigue siendo editable: la regla es "al menos un medio no obsoleto".
- **La baja es de la persona y no se deshace:**
  - una baja (por respuesta o por SendGrid) pasa a `baja` a todos sus prospectos y cancela sus seguimientos;
  - un prospecto nuevo suyo nace en `baja`;
  - ninguna clasificación, validación o cambio de estado lo saca de ahí.

## Dueño de las empresas: asignar = dar dueño (2-oct-2026)

Un agente solo ve las empresas de las que es dueño (`propietario_id`). Cuando un **admin o supervisor** le da trabajo a un **agente** (asignar una tarea, crear una tarea ya asignada o crear una oportunidad para él), la empresa pasa a ese agente si hoy no tiene como dueño a otro agente activo: sin dueño (las que crea n8n), a nombre de un admin o supervisor, o de un agente desactivado. Si ya es de otro agente activo, no cambia: la asignación sigue y decide el supervisor. Queda en la auditoría como `tomar_empresa` (entidad `empresa`, con `tarea_id` u `oportunidad_id`). Un agente que se crea su propia tarea no toma empresas ajenas, y solo crea tareas y oportunidades en sus empresas (lo ajeno, 404). Al confirmar una fila del CSV, la empresa nueva queda de quien la importó, no de quien confirma. Código: `src/shared/empresa-de-agente.ts`.

## Probado de extremo a extremo

Igual que las versiones anteriores, no me quedé solo en que compilara: instalé MySQL real en el entorno de build, corrí `npm run migrate`, y con el build compilado (`npm run build` + `node dist/main.js`) probé en caliente: `GET /health`, un 404 en una ruta cualquiera y en una ruta bajo `/api/v1`, bootstrap de la cuenta admin, `GET /api/v1/auth/me`, crear una empresa con un contacto (dos medios de contacto, en una transacción), listar empresas, consultarla por id con el join a contactos/medios, una empresa inexistente (404), bootstrap duplicado (409), login y logout. Todo respondió exactamente igual que en las versiones en Express y en Next.js.

## Prospectos: alta manual e importación CSV (avance sobre el plan)

`PLAN_CRM_DEFINITIVO.md` #3 y `PLAN_API_DEFINITIVO.md` (grupo `/prospectos`). Migración `015_prospectos_importacion.sql` (tabla `borradores_captura`) + su espejo en `schema.ts`.

- **Diferencia con `/api/v1/automatizacion/prospectos`**: ese endpoint es para n8n (`X-API-Key`, un registro confiable por evento de automatización). Este módulo es para un usuario de sesión dando de alta prospectos a mano o por lote — nunca escribe directo en `empresas`/`contactos`/`prospectos`, siempre pasa primero por un borrador.
- **Alta manual** (`POST /api/v1/prospectos`): una fila = un lote de 1. Reusa el mismo camino de validación y deduplicación que la importación CSV en vez de tener su propia copia.
- **Importación CSV** (`POST /api/v1/prospectos/importaciones`, multipart, campo `archivo`): parsea el CSV (parser RFC 4180 propio en `shared/csv.ts`, sin dependencia nueva), valida cada fila (correo, teléfono, giro, tamaño, canal) y deduplica — primero contra otras filas del mismo archivo, luego contra `medios_contacto` en BD, con la regla **"el correo manda"** (`shared/identidad.ts`, 2-oct-2026): con correo solo identifica el correo (mismo conmutador + otro correo = otra persona); sin correo, el teléfono (como teléfono o WhatsApp). Al confirmar se revisa la identidad otra vez, y los medios que estén en `lista_supresion` nacen en `no_contactar` (la respuesta los lista en `medios_suprimidos`). Cada fila queda en `borradores_captura` como `pendiente_revision`, `duplicado` (con `match_contacto_id` si coincidió con un contacto real) o `rechazado` (con el detalle en `errores`) — ninguna fila se descarta en silencio, incluidas las que no traen ni nombre de empresa ni de contacto.
- **Lotes** (`GET /api/v1/prospectos/importaciones`, agregado 28-sep-2026): las importaciones hechas, más reciente primero, con el conteo de filas por estado. Sin él, el `lote_id` que devuelve la importación era la única forma de volver a un lote. No incluye las altas manuales (también son lotes de una fila, con fuente `manual`). Un agente solo ve sus propios lotes.
- **Reglas del 2-oct-2026 (C4):** el encabezado del CSV solo acepta las columnas de la plantilla (máximo 40; una desconocida o repetida responde 400 con la lista de las válidas; las columnas sin nombre se ignoran). Una fila vencida ya no se confirma (409 `IMPORTACION_VENCIDA`). Si una fila duplica a un contacto de **otro agente**, ese agente no ve su `match_contacto_id` (llega `null`, con el aviso en `errores`) y no puede "usar contacto existente" (409 `CONTACTO_DE_OTRO_AGENTE`): lo confirma un supervisor. La búsqueda `q` escapa `%` y `_`.
- **Revisión** (`GET /api/v1/prospectos/importaciones/:loteId`): lista las filas del lote con su estado.
- **Confirmación** (`POST .../filas/:id/confirmar`, `POST .../confirmar-todos`, `POST .../filas/:id/rechazar`): promueve un borrador a empresa+contacto+prospecto real (o rechaza). Confirmar una fila `duplicado` exige `usarContactoExistente:true` explícito — "la razón social nunca fusiona prospectos automáticamente" (PLAN_CRM_DEFINITIVO.md) aplicado aquí a nivel de contacto. `confirmar-todos` solo toca las `pendiente_revision` de un lote; las `duplicado` siempre se deciden una por una.
- **Limpieza de borradores vencidos** (Jobs internos, `PLAN_API_DEFINITIVO.md`): diario, ahora disparado por n8n (PT5, `POST /automatizacion/jobs/limpiar-borradores`; antes `@Interval`, que en Cloud Run no corría) marca como `expirado` cualquier borrador `pendiente_revision`/`duplicado` con más de 30 días sin decisión.
- Un agente solo ve y opera sobre los lotes que él mismo importó; administrador/supervisor ven cualquiera (mismo criterio de scoping que `EmpresasService`).

Probado con datos reales: se mapeó la base de 30 prospectos industriales de STEELSAFE NANO® (`Prospeccion_industrial_STEELSAFE_NANO.xlsx`) a un CSV con este contrato de columnas y se corrió contra `parseCsv`/`filaCsvSchema` directamente (sin mockear nada) — 29/30 filas pasan validación limpia; la única rechazada no tiene ni correo ni teléfono publicado (solo un formulario web), que es exactamente el criterio de "requiere verificación humana" que ya señala la propia base. El mapeo también detectó dos celdas de correo con más de una dirección separada por "|" en el Excel original, resueltas tomando la primera.

## Qué falta (siguiente avance sugerido)

Esta sección estaba desactualizada: automatización (los 19 endpoints para n8n, incluyendo B4 Error Workflow), oportunidades/pipeline, cotizaciones, documentos, reportes/dashboards, `usuarios` y `auditoria` ya están implementados (ver secciones arriba), aunque no siempre quedaron documentados aquí cuando se construyeron. Lo que de verdad falta hoy (confirmado por la auditoría global del 14-sep-2026):

- CRUD independiente de `/contactos` ✅ ya existe (18-sep-2026): `GET/POST /api/v1/contactos` y `GET/PATCH/DELETE /api/v1/contactos/:id`, para buscar/abrir un contacto sin conocer antes su empresa (filtros `empresaId` y `q` por nombre, paginado). Las rutas anidadas `/empresas/:id/contactos/*` se mantienen y comparten la misma lógica: las escrituras de `/contactos` delegan en `EmpresasService`, así que validaciones, 409 por medio duplicado, `no_contactar` y auditoría son las mismas. Único cambio de contrato: aquí cada contacto trae sus medios anidados en `medios: [...]` (una fila por contacto), no una fila por medio como devuelve `/empresas/:id`. `POST` recibe `empresaId` en el cuerpo. Un agente solo ve/edita contactos de sus empresas (lo ajeno responde 404).
- `GET /api/v1/catalogos` (sesión, CRM) ✅ ya existe (17-sep-2026) — expone los mismos catálogos ENUM que `/automatizacion/catalogos` (tamaño de empresa, tipo/estado de medio de contacto, prioridad de prospecto, tipo/prioridad de tarea, etc.) sin requerir `X-API-Key`. El de etapa del embudo/motivo de pérdida sigue aparte, en `/api/v1/oportunidades/catalogos` (propio de ese módulo).
- `catalogo_tipo_documento` ✅ ya existe (17-sep-2026, migración `018_catalogo_tipo_documento.sql`) — seis tipos semilla (contrato, identificación oficial, comprobante de domicilio, acta constitutiva, cotización firmada, otro). `documentos.tipo_documento_id` es opcional (no rompe documentos ya subidos); `GET /api/v1/documentos/catalogos` lo expone con `id` (a diferencia de `/oportunidades/catalogos`, aquí el cliente sí necesita el id numérico, no solo la clave, porque así es como `subirDocumentoSchema` lo recibe de vuelta). `metricas_comerciales_diarias` ya existe y tiene su job diario (ver arriba).
- Jobs internos de `PLAN_API_DEFINITIVO.md` ✅ los 6 ya existen (17-sep-2026): despachador de `eventos_pendientes`, limpieza de borradores vencidos, job diario de métricas, revisión de procesos fallidos (pantalla `/procesos-fallidos`, no un `@Interval` — es triage humano, no automatizable), y los dos últimos, `DocumentosService.alertarDocumentosPendientes()` (documentos vigentes sin revisar tras 7 días) y `TareasService.alertarTareasSlaVencidas()` (tareas abiertas con `fecha_limite` vencida) — migración `019_alertas_sla.sql`. Ninguno de los dos llama a n8n directo: encolan en `eventos_pendientes` (mismo patrón outbox que cerrar/clasificar tareas) y el despachador existente los entrega; n8n decide el canal real de aviso. Sin endpoint de disparo manual (housekeeping, mismo criterio que la limpieza de borradores).
- Cobertura de pruebas de cotizaciones (versionado/transiciones), documentos (versionado, cambio de estado, revisión, borrado) y tareas/cola de clasificación ✅ cerrada (22-sep-2026, ver "Pruebas automatizadas" arriba) -- lo único de esos tres módulos que sigue sin probar automatizado es el driver GCS (`gcs-storage.driver.ts`, no probado en ningún entorno por falta de bucket real, ver el comentario en ese archivo). Lo que sigue sin cobertura automatizada: la superficie completa de `/api/v1/automatizacion/*` (los 19 endpoints que consume n8n -- solo `errores-workflow` y, de paso, `prospectos`/`tareas` como semilla de otras pruebas, tienen prueba propia hoy).
- Redes sociales en empresas/contactos ✅ ya existen (22-sep-2026, migración `021_redes_sociales.sql`): `facebook_url`/`instagram_url` además de `linkedin_url`/`sitio_web` -- ver `docs/planes/PLAN_FRONTEND.md` §2. De paso se corrigió que esos cuatro campos de URL (antes solo `linkedinUrl`/`sitioWeb`, ahora también `facebookUrl`/`instagramUrl`) aceptaban cualquier esquema (`javascript:`, `data:`) en vez de solo `http`/`https` -- ver `src/shared/http-url.ts`.
- `GET /api/v1/reportes/prospeccion` ✅ ya existe (1-oct-2026): correos enviados, personas contactadas, respuestas por clasificación y tasa de respuesta, en total y por campaña (filtros: periodo y `campanaId`). Las respuestas automáticas no cuentan para la tasa. También se exporta (`/reportes/export/prospeccion`). De paso, `GET /tareas?sinAsignar=true` lista las tareas sin responsable para que un supervisor las reparta. Ver `docs/planes/PLAN_FRONTEND.md`.
- `GET /api/v1/reportes/desempeno-por-agente` ✅ ya existe (22-sep-2026): junta actividades + tareas cerradas/vencidas + oportunidades ganadas/ingresos por agente en una sola llamada -- antes armar esa tabla exigía llamar `/tareas` y `/pipeline/resumen` una vez por agente. Ver la sección de Reportes más abajo.
- Sustitución de los nodos MOCK de n8n por los endpoints reales de `/api/v1/automatizacion` ✅ hecha en el workflow "PT1. ingesta y scoring" (verificada 21–23-sep-2026 contra la API en producción, `https://nanobridge-api-165032456965.us-central1.run.app`; detalle nodo por nodo en B1 de `PLAN_N8N_DEFINITIVO.md`). Lo que sigue en MOCK es el envío de correo ("MOCK · envio de campana (7)"), hasta conectar SendGrid (ver "Envío real con SendGrid" en ese plan); por eso el workflow sigue en `active: false`. Del lado de n8n también falta el webhook único de reingreso (B3), y hasta que exista no se configura `N8N_WEBHOOK_URL` en Cloud Run.
