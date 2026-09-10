# Nanobridge CRM API

Backend modular único para el CRM y la automatización outbound. El CRM y n8n usan HTTP; solo este servicio ejecuta SQL en MySQL.

Implementado con **NestJS** (módulos, controladores, servicios, guards) sobre Express (la plataforma HTTP por defecto de Nest), con **Drizzle ORM** como capa de acceso a datos.

## Inicio local

1. Copia `.env.example` como `.env` y configura una instancia local de MySQL.
2. Instala dependencias con `npm install`.
3. Ejecuta `npm run migrate`.
4. Ejecuta `npm run start:dev`.

El health check queda disponible en `GET /health`.

## Estructura del proyecto

```
src/
  main.ts                              bootstrap: cookie-parser, límite de body, filtro global de errores
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
    decorators/current-user.decorator.ts   @CurrentUser() para leer el usuario ya autenticado
    dto/credentials.schema.ts          esquemas Zod de entrada
  crm/
    crm.module.ts, empresas.controller.ts, empresas.service.ts   GET/POST /empresas, GET /empresas/:id
    dto/empresa.schema.ts              esquemas Zod de entrada
  tareas/
    tareas.module.ts, tareas.controller.ts, tareas.service.ts   GET/POST /tareas, GET /tareas/:id, PATCH /tareas/:id/cerrar
    cola-clasificacion.controller.ts   GET /cola-clasificacion, POST /cola-clasificacion/:id/clasificar
    dto/tarea.schema.ts                esquemas Zod de entrada
  outbox/
    outbox.module.ts, outbox.service.ts            enqueue(tx, evento) — inserta en eventos_pendientes dentro de la misma transacción
    outbox-dispatcher.service.ts                   despachador @Interval(): entrega a n8n, reintentos 5s/30s/120s, procesos_fallidos al agotarlos
    eventos-pendientes.controller.ts               GET/POST /eventos-pendientes (solo administrador)
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

- **Bandeja de tareas** (`GET/POST /api/v1/tareas`, `GET /:id`, `PATCH /:id/cerrar`): filtra por estado, prioridad, tipo y responsable. El agente solo ve/gestiona lo asignado a sí mismo (`responsable_id`); administrador y supervisor ven y filtran libremente, igual que el criterio ya usado en `empresas`.
- **Cola de clasificación** (`GET /api/v1/cola-clasificacion`, `POST /:id/clasificar`): las tareas con `tipo=clasificacion` pendientes, ligadas a un `prospecto_id`. Clasificar (`interesado` / `no_interesado` / `invalido` / `reagendar`) cierra la tarea y encola un evento saliente.
- **Outbox** (`OutboxService.enqueue`): cerrar una tarea o resolver una clasificación inserta la fila en `eventos_pendientes` **dentro de la misma transacción** que el cambio de estado — si la transacción falla, el evento tampoco se crea, así el patrón es real y no solo un `try { await fetch() }` suelto en el controlador.
- **Despachador** (`OutboxDispatcherService`, `@Interval` de `@nestjs/schedule`, `OUTBOX_DISPATCH_INTERVAL_MS`): entrega los eventos pendientes a `N8N_WEBHOOK_URL` con el header `X-API-Key: WEBHOOK_ENTRADA_API_KEY` (mismo esquema que ya definía `PLAN_API_DEFINITIVO.md` para CRM → n8n). Reintentos idempotentes: 3 intentos con backoff 5 s / 30 s / 120 s (`MATRICES_Y_BACKLOG_DEFINITIVO.md`); al agotarlos, el evento queda `fallido` y se crea una fila en `procesos_fallidos`.
- **Pantalla de eventos pendientes** (`GET /api/v1/eventos-pendientes`, `POST /:id/reintentar`, `POST /despachar`, solo `administrador`): "los eventos fallidos son visibles y reintentables desde la pantalla de eventos pendientes" tal cual pide el plan. `/despachar` fuerza una corrida del despachador sin esperar el intervalo.

Probado de extremo a extremo con un receptor HTTP de prueba haciendo de n8n: cierre de tarea → evento entregado y marcado `enviado`; clasificación de prospecto → mismo flujo con `entidad_tipo=prospecto`; receptor caído → 3 reintentos con el backoff exacto (5 s/30 s/120 s), evento marcado `fallido` y fila creada en `procesos_fallidos`; `POST /reintentar` con el receptor de vuelta → el evento se reenvía y queda `enviado`. También roles: un agente que cierra sesión ve la bandeja vacía si las tareas son de otro responsable, recibe 404 al pedir una tarea ajena por id, y 403 en `/eventos-pendientes`.

## Probado de extremo a extremo

Igual que las versiones anteriores, no me quedé solo en que compilara: instalé MySQL real en el entorno de build, corrí `npm run migrate`, y con el build compilado (`npm run build` + `node dist/main.js`) probé en caliente: `GET /health`, un 404 en una ruta cualquiera y en una ruta bajo `/api/v1`, bootstrap de la cuenta admin, `GET /api/v1/auth/me`, crear una empresa con un contacto (dos medios de contacto, en una transacción), listar empresas, consultarla por id con el join a contactos/medios, una empresa inexistente (404), bootstrap duplicado (409), login y logout. Todo respondió exactamente igual que en las versiones en Express y en Next.js.

## Qué falta (siguiente avance sugerido)

Según `MATRICES_Y_BACKLOG_DEFINITIVO.md`, después de tareas y outbox sigue: endpoints de automatización para n8n (los 17 del `PLAN_API_DEFINITIVO.md`), sustituir mocks por HTTP real, historial de interacciones, oportunidades y pipeline, cotizaciones, documentos, y métricas/dashboards. También falta un módulo `usuarios` (alta y gestión de cuentas vía API — por ahora el único usuario se crea con `/auth/bootstrap`) y un CRUD independiente de `contactos` (hoy solo se crean dentro de `POST /empresas`).
