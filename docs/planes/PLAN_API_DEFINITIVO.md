# Plan definitivo de implementación de la API

## Arquitectura

- Backend modular único en Node.js y TypeScript.
- Despliegue en Cloud Run dentro de VPC.
- MySQL privado.
- El backend es el único componente que ejecuta SQL.
- Frontend CRM: sesión de usuario y roles.
- n8n: `X-API-Key` con `CRM_CALLBACK_API_KEY`.
- CRM hacia n8n: `WEBHOOK_ENTRADA_API_KEY`.
- ORM: Drizzle (decisión del equipo CRM al migrar a NestJS). **Confirmado
  18-sep-2026: Drizzle se queda, definitivo, no se evalúan alternativas.**
  **Resuelto (18-sep-2026, sesión posterior):** la fuente de verdad del
  esquema sigue siendo el SQL manual versionado en
  `src/database/migrations/`; Drizzle solo aporta queries tipadas sobre un
  `schema.ts` actualizado a mano en cada migración nueva. No se adopta
  `drizzle-kit generate`/`push`.

## Módulos

- `auth`
- `crm`
- `automatizacion`
- `comercial`
- `documentos`
- `metricas`
- `auditoria`
- `workers`

## Endpoints de automatización n8n

Mantener los 19 endpoints de automatización (todos con auth `X-API-Key` / `CRM_CALLBACK_API_KEY`):

1. Parámetros.
2. Catálogos.
3. Registro de prospecto.
4. Validaciones.
5. Tareas.
6. Scoring.
7. Incidencias.
8. Verificación de envío.
9. Estado de prospecto.
10. Campaña activa.
11. Registro de envío.
12. Consulta de supresión (verificar antes de enviar).
13. Registro de supresión (alta de baja / `no_contactar`). Desde el 24-sep-2026, cuando una respuesta se clasifica `baja` (por n8n en "Respuesta clasificada" o a mano en la cola de clasificación), la API la registra en la misma transacción. El endpoint queda para supresiones que no vienen de una respuesta, como los eventos de SendGrid (PT3). Desde el 1-oct-2026 acepta `evento`:
    - `unsubscribe`, `group_unsubscribe` o `spamreport` = baja de la persona: todos sus medios suprimidos, sus prospectos en `baja` y sus tareas de seguimiento canceladas;
    - `bounce` o sin evento = solo ese medio.
14. Consulta de prospecto para scoring.
15. Ventanas vencidas. Desde el 30-sep-2026 cada fila trae `correo`, `contacto_nombre`, `empresa_nombre`, `giro`, `campana_id` y `campana_activa`; las ventanas a las que no se debe escribir (prospecto cerrado, campaña inactiva, sin correo, suprimido, WhatsApp) no se devuelven, quedan canceladas y salen en `omitidas` con su motivo. Contrato completo en PLAN_N8N_DEFINITIVO.md B2, "Flujo de recordatorios".
16. Respuesta recibida.
17. Respuesta clasificada. El caso ambiguo deja una `tarea` con `tipo=clasificacion` ligada a la respuesta (no existe una tabla `cola_clasificacion`), o reusa la que ya tenga abierta. La pantalla CRM `/cola-clasificacion` solo lee y resuelve; nunca recibe escritura directa de n8n. Desde el 30-sep-2026:
    - comparte con la clasificación manual una sola función (`TareasService.aplicarClasificacionDeRespuesta`);
    - cierra las tareas de clasificación abiertas de esa respuesta;
    - "interesado" deja la tarea "Contactar prospecto interesado";
    - responde 409 `code: RESPUESTA_YA_CLASIFICADA` si la respuesta ya estaba decidida.
18. Registrar error de workflow (n8n Error Workflow, B4): `POST /api/v1/automatizacion/errores-workflow`. Registra una incidencia y, si el fallo es crítico, también una fila en `procesos_fallidos`, en una sola llamada transaccional.
19. Sugerencia de clasificación (30-sep-2026, IA en modo sugerencia): `POST /api/v1/automatizacion/respuestas/sugerencia`. Solo guarda lo que propone la IA (clasificación, confianza 0-100 y motivo) en columnas aparte de `respuestas` (migración 023); la cola lo muestra y una persona confirma. Ver PLAN_N8N_DEFINITIVO.md B2.

**"La baja manda" (1-oct-2026).** Toda baja (respuesta clasificada `baja` o evento de SendGrid) pasa por `darDeBajaProspecto` (`src/shared/baja-prospecto.ts`), que pone el prospecto en `baja` y cancela sus tareas de seguimiento. Una clasificación posterior queda registrada en la respuesta, pero no saca al prospecto de baja ni crea tareas.

**✅ Completado (10-sep-2026), extendido con B4 (14-sep-2026).** Los 18 endpoints están construidos, probados contra MySQL real (positivos, negativos, idempotencia) y en `main`. El 19 (Sugerencia de clasificación) se agregó el 30-sep-2026: hoy son 19. Historial de commits: `babdfab` (módulo base) hasta `a689a40` (Respuesta recibida/clasificada); B4 se agregó después, ver commit de "Registrar error de workflow".

Todos los endpoints que n8n necesita para continuar el flujo son críticos. "Parámetros" y "Catálogos" están separados porque `PLAN_N8N_DEFINITIVO.md` (B1) los sustituye como dos pasos independientes.

## Endpoints CRM

Crear grupos REST para:

- `/auth`
- `/empresas`
- `/contactos`
- `/prospectos`
- `/actividades`
- `/tareas`
- `/cola-clasificacion` (lectura y resolución manual; auth de sesión, no de n8n)
- `/oportunidades`
- `/cotizaciones`
- `/documentos`
- `/metricas`
- `/catalogos` (lectura para la UI del CRM; distinto del endpoint de automatización "Catálogos", que usa `X-API-Key`)
- `/usuarios`
- `/auditoria`

CORS: el frontend CRM (React) vive en un origen distinto al backend; configurar `Access-Control-Allow-Origin` restringido a ese origen y cookies de sesión con `SameSite=Lax` o `None` + `Secure` según el despliegue final.

## Reglas técnicas obligatorias

- Migraciones versionadas desde el primer commit.
- Transacciones para acciones compuestas.
- Idempotencia con `execution_id`.
- `UNIQUE(execution_id)` para resultados de scoring.
- Reintentos idempotentes devuelven `200` y `ya_existia: true`.
- Conflictos humanos del CRM devuelven `409` con explicación.
- Errores críticos de n8n crean `procesos_fallidos`.
- Máximo de tres reintentos: 5 s, 30 s y 120 s.
- Auditoría para cambios comerciales, documentos, permisos, supresiones y reintentos manuales.

## Jobs internos

- Despachador de `eventos_pendientes`.
- Job diario de métricas comerciales.
- Limpieza de borradores vencidos.
- Revisión de documentos pendientes.
- Alertas de tareas SLA vencidas.
- Revisión de procesos fallidos.

## Esquema de tablas de soporte

### `eventos_pendientes` (outbox)

Nombres reales de columnas (corregido 22-sep-2026 tras auditoría contra
`002_tareas_outbox.sql`; la versión anterior de esta sección documentaba
nombres que nunca existieron en la tabla):

- `id` BIGINT UNSIGNED PK.
- `evento_uuid` CHAR(36) UNIQUE NOT NULL — UUID generado en `OutboxService.enqueue()`
  (`randomUUID()`), clave de idempotencia hacia los webhooks de n8n (B3);
  se manda en el payload de cada entrega para que n8n pueda deduplicar un
  reintento que reenvía un evento ya entregado. Agregada en
  `020_eventos_pendientes_uuid.sql` — llamada `evento_uuid`, no `evento_id`,
  para no chocar con `procesos_fallidos.evento_id` (FK BIGINT, significado
  distinto).
- `tipo` VARCHAR(100) — p. ej. `tarea_cerrada`, `prospecto_clasificado`.
- `entidad_tipo` VARCHAR(50), `entidad_id` BIGINT UNSIGNED — referencia genérica (prospecto, tarea, etc.).
- `payload` JSON.
- `estado` ENUM(`pendiente`, `procesando`, `enviado`, `fallido`) DEFAULT `pendiente`
  (`procesando` es el claim atómico del despachador vía `SELECT ... FOR UPDATE SKIP LOCKED`;
  no existe `descartado`).
- `intentos` INT UNSIGNED DEFAULT 0, `proximo_intento_en` DATETIME NULL.
- `ultimo_error` TEXT NULL.
- `creado_en`, `actualizado_en` DATETIME.

### `procesos_fallidos`

- `id` BIGINT UNSIGNED PK.
- `evento_id` BIGINT UNSIGNED NULL — FK opcional a `eventos_pendientes` cuando el fallo viene del despachador de outbox interno.
- `execution_id` VARCHAR(100) NULL, UNIQUE — id de ejecución de n8n; NULL para las filas que crea internamente el despachador de outbox (MySQL permite múltiples NULL en un índice UNIQUE). Es la clave de idempotencia para las filas que crea el Error Workflow (B4).
- `workflow` VARCHAR(120) NULL, `nodo` VARCHAR(120) NULL, `endpoint` VARCHAR(160) NULL.
- `codigo_http` SMALLINT UNSIGNED NULL.
- `tipo` VARCHAR(100) NOT NULL — tipo del evento/reporte de origen.
- `payload` JSON NOT NULL — contexto crudo del fallo (para el despachador de outbox, el payload del evento; para B4, `detalle` fusionado con workflow/nodo/endpoint/codigo_http).
- `mensaje` TEXT NOT NULL.
- `estado` ENUM(`abierto`, `en_revision`, `resuelto`) DEFAULT `abierto`.
- `creado_en`, `actualizado_en` DATETIME.

## Criterio de terminado

La API permite al CRM operar completamente y a n8n ejecutar automatizaciones sin acceso directo a MySQL, con trazabilidad, idempotencia y recuperación ante fallos.
