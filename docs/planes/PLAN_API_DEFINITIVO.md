# Plan definitivo de implementación de la API

## Arquitectura

- Backend modular único en Node.js y TypeScript.
- Despliegue en Cloud Run dentro de VPC.
- MySQL privado.
- El backend es el único componente que ejecuta SQL.
- Frontend CRM: sesión de usuario y roles.
- n8n: `X-API-Key` con `CRM_CALLBACK_API_KEY`.
- CRM hacia n8n: `WEBHOOK_ENTRADA_API_KEY`.
- ORM: Drizzle (decisión del equipo CRM al migrar a NestJS). Pendiente
  definir si `schema.ts` + `drizzle-kit` reemplaza a las migraciones SQL
  manuales como fuente de verdad, o si el SQL manual se mantiene y Drizzle
  solo aporta queries tipadas. Hasta resolverlo, las tablas nuevas se
  siguen creando en SQL plano en `src/database/migrations/`.

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

Mantener los 17 endpoints de automatización (todos con auth `X-API-Key` / `CRM_CALLBACK_API_KEY`):

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
13. Registro de supresión (alta de baja / `no_contactar`; se invoca al procesar una respuesta clasificada como negativa en B2, no requiere endpoint aparte).
14. Consulta de prospecto para scoring.
15. Ventanas vencidas.
16. Respuesta recibida.
17. Respuesta clasificada (también recibe el caso ambiguo y lo inserta en `cola_clasificacion`; la pantalla CRM `/cola-clasificacion` solo lee y resuelve, nunca recibe escritura directa de n8n).

**✅ Completado (10-sep-2026).** Los 17 endpoints están construidos, probados contra MySQL real (positivos, negativos, idempotencia) y en `main`. Historial de commits: `babdfab` (módulo base) hasta `a689a40` (Respuesta recibida/clasificada).

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

- `id` BIGINT UNSIGNED PK.
- `evento_id` CHAR(36) UNIQUE — UUID, clave de idempotencia hacia los webhooks de n8n (B3).
- `tipo_evento` VARCHAR(60) — p. ej. `reingreso_validacion`, `reingreso_clasificacion`, `reactivacion`.
- `entidad` VARCHAR(60), `entidad_id` BIGINT UNSIGNED — referencia genérica (prospecto, tarea, etc.).
- `payload` JSON.
- `estado` ENUM(`pendiente`, `enviado`, `fallido`, `descartado`) DEFAULT `pendiente`.
- `intentos` TINYINT UNSIGNED DEFAULT 0, `proximo_intento_en` DATETIME NULL.
- `ultimo_error` TEXT NULL.
- `creado_en`, `actualizado_en` DATETIME.

### `procesos_fallidos`

- `id` BIGINT UNSIGNED PK.
- `execution_id` VARCHAR(100) NULL — id de ejecución de n8n.
- `evento_id` CHAR(36) NULL — FK opcional a `eventos_pendientes` cuando aplica.
- `workflow` VARCHAR(120) NULL, `nodo` VARCHAR(120) NULL, `endpoint` VARCHAR(160) NULL.
- `codigo_http` SMALLINT UNSIGNED NULL.
- `mensaje` TEXT NOT NULL.
- `estado` ENUM(`abierto`, `en_revision`, `resuelto`) DEFAULT `abierto`.
- `creado_en`, `actualizado_en` DATETIME.

## Criterio de terminado

La API permite al CRM operar completamente y a n8n ejecutar automatizaciones sin acceso directo a MySQL, con trazabilidad, idempotencia y recuperación ante fallos.
