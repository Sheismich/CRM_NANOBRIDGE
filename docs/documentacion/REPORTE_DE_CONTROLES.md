# Reporte de controles de datos · CRM NANOBRIDGE

**Entregable:** reporte de controles de la base v1 (OB-02), proyecto naranja · outbound.
**Para:** revisión G4 · CDR (semana 10, 2-6 nov 2026). **Dueño:** T1 · **Revisión:** T2 y Dirección General.
**Versión:** 1.0 · 28 de octubre de 2026 · base en la migración `037_borrador_empresa_existente.sql`.

Este reporte lista los controles que protegen la base de datos: dónde vive cada uno y con qué se comprueba que funciona.
Complementa al [diccionario de datos](DICCIONARIO_DE_DATOS.md) (qué es cada dato y sus reglas) y a la
[auditoría de calidad](auditorias/calidad-2026-10-28.md) (cómo están los datos hoy).

## Resumen · KPI T1.3

**T1.3 · Controles de gobierno operativos** = controles aprobados activos y probados / controles planificados para el corte.

| Grupo | Planificados | Activos y probados |
|---|---|---|
| A. Integridad en la base | 6 | 6 |
| B. Validación de entrada | 6 | 6 |
| C. Duplicados | 4 | 4 |
| D. Protección de las personas contactadas | 7 | 7 |
| E. Acceso y trazabilidad | 8 | 8 |
| F. Operación | 6 | 6 |
| **Total** | **37** | **37 (100 %)** |

Cómo se comprueba cada control:
- **Prueba automática:** archivo de `test/` que corre en cada cambio. Hoy son 94 archivos y 736 pruebas de la API, más 30 del front.
- **Verificación en la base:** la regla la impone MySQL y se leyó de `information_schema` al generar el diccionario.
- **Prueba manual documentada:** se ejecutó una vez, con fecha, y quedó en el RUNBOOK.

Además hay controles **propuestos que no entran en este corte** (§G). Se listan para que Dirección decida si se agregan.

## A. Integridad en la base

| ID | Control | Dónde | Comprobación |
|---|---|---|---|
| A-01 | **Relaciones obligatorias:** 61 llaves foráneas; no se puede guardar un registro que apunte a otro que no existe | Migraciones (`src/database/migrations/`) | Verificación en la base |
| A-02 | **Campos obligatorios:** 207 campos `NOT NULL` | Migraciones | Verificación en la base |
| A-03 | **Valores cerrados:** 40 campos con lista fija de valores (`ENUM`): tamaño, estados, motivos… | Migraciones | Verificación en la base; las listas de motivos se comparan contra el código en `410-documentos-revision-expediente` y `405-cotizaciones-tablero` |
| A-04 | **No repetir:** 18 reglas de unicidad (medio por tipo y valor, correo de usuario, `execution_id` de n8n, plantilla por giro y número…) | Migraciones | Verificación en la base; `255-identidad-personas`, `535-automatizacion-scoring-incidencias` |
| A-05 | **Medio con un solo dueño:** cada medio es de un contacto o de una empresa, nunca de los dos (`chk_medio_un_dueno`) | Migración 001 | Verificación en la base |
| A-06 | **Dinero exacto:** importes en `DECIMAL` y cálculo en centavos, sin redondeos de punto flotante | `src/comercial/dinero.ts` | `30-cotizaciones-rounding` |

## B. Validación de entrada

| ID | Control | Dónde | Comprobación |
|---|---|---|---|
| B-01 | **Prospecto válido** (alta manual y CSV): nombres, correo o teléfono obligatorio, canal con su medio, catálogos sin acentos ni mayúsculas | `src/crm/dto/prospecto.schema.ts` | `210-prospectos-csv-validacion`, `315-importacion-csv-limites` |
| B-02 | **Normalización** de correo (minúsculas, sin espacios) y teléfono (solo dígitos, mínimo 7) igual en CRM, CSV y n8n | `src/shared/normalize.ts` | `255-identidad-personas`, `70-empresas-contactos` |
| B-03 | **Enlaces seguros:** sitio web, redes y fuente solo `http`/`https` (no `javascript:`) | `src/shared/http-url.ts` | `210-prospectos-csv-validacion`, `500-plantillas-correo` |
| B-04 | **Texto íntegro:** se rechaza lo que no es UTF-8 y los acentos se guardan como se leen | `src/shared/configurar-app.ts`, `texto.ts` | `356-codificacion`, `355-acentos` |
| B-05 | **Documentos:** solo PDF, DOCX, XLSX, PNG y JPG, se revisa el contenido real del archivo, máximo 25 MB | `src/documentos/documentos.service.ts` | `320-documentos-contenido`, `150-documentos-flujo` |
| B-06 | **Errores claros:** un dato mal enviado responde 4xx con el motivo, nunca 500 | `src/shared/http-exception.filter.ts` | `280-errores-cliente` |

## C. Duplicados

| ID | Control | Dónde | Comprobación |
|---|---|---|---|
| C-01 | **Identidad de la persona: «el correo manda»** (sin correo, el teléfono); igual en CRM, CSV y n8n | `src/shared/identidad.ts` | `255-identidad-personas` |
| C-02 | **Desactivados cuentan:** un contacto o empresa desactivados siguen apartando su correo y teléfono | `src/shared/identidad.ts` | `345-identidad-inactivos` |
| C-03 | **Importación con revisión:** cada fila se compara contra la base y contra el mismo archivo; las coincidencias quedan como «duplicado» con el contacto y el motivo, y nada entra al maestro sin confirmar. Las no confirmadas expiran a los 30 días | `src/crm/prospectos.service.ts` (área de carga `borradores_captura`) | `315-importacion-csv-limites`, `200-prospectos-lotes` |
| C-04 | **Reintentos de n8n sin duplicar:** prospectos, envíos, respuestas, scoring, tareas e incidencias llevan `execution_id` único | `src/automatizacion/automatizacion.service.ts` | `535-automatizacion-scoring-incidencias`, `60-error-workflow-promotion`, `180-clasificacion-respuestas` |

## D. Protección de las personas contactadas

| ID | Control | Dónde | Comprobación |
|---|---|---|---|
| D-01 | **La lista de supresión manda:** a un correo o teléfono suprimido no se le escribe, aunque se vuelva a capturar | `src/shared/supresion.ts` | `190-supresion`, `265-crm-respeta-supresion` |
| D-02 | **Baja por evento:** el link de baja, una queja de spam o un rebote dan de baja a la persona y cancelan sus seguimientos | `src/shared/baja-prospecto.ts` | `245-baja-por-evento`, `350-tareas-baja-carrera` |
| D-03 | **Máximo 3 correos por persona** cada 6 meses, con 5 días hábiles entre uno y otro | `src/shared/ciclo-contacto.ts` | `140-envios-por-persona`, `360-ventana-por-persona`, `215-dia-habil-mx` |
| D-04 | **Solo se escribe a validados** | `src/automatizacion/automatizacion.service.ts` | `475-envio-solo-validados` |
| D-05 | **Tope diario de correos** (20 al encender, para calentar el dominio) | `TOPE_DIARIO_CORREOS` | `365-tope-diario` |
| D-06 | **Listo para automatización:** sin giro, tamaño o correo activo, o en baja, no entra a la fila | `src/shared/listo-para-automatizacion.ts` | `485-fila-automatizacion` |
| D-07 | **IA sin datos de contacto:** a Gemini no le llegan correos, teléfonos ni nombres de archivo | `src/resumen-ficha/`, consulta de scoring | `515-resumen-ficha`, `530-historial-documentos`, `535-automatizacion-scoring-incidencias` |

## E. Acceso y trazabilidad

| ID | Control | Dónde | Comprobación |
|---|---|---|---|
| E-01 | **Todo pide sesión o la llave de n8n** (salvo `/health`) | Guardias de cada controlador | `00-auth`, `10-guards`; revisión en vivo del 26-oct: 74 rutas dan 401 sin sesión |
| E-02 | **Permisos por rol:** administrador, supervisor y agente | `src/auth/guards/roles.guard.ts` | `10-guards`, `445-ultimo-acceso-y-auditoria-admin` |
| E-03 | **Un agente solo ve lo suyo** (sus empresas y lo que cuelga de ellas) | Cada servicio | `80-oportunidades`, `140-cotizaciones-flujo`, `310-oportunidades-de-agente`, `515-resumen-ficha`; en total 52 archivos de prueba revisan lo que ve un agente |
| E-04 | **Bitácora de cambios** con el antes y el después | Tabla `auditoria` | `455-registro-cambios`, `130-outbox-auditoria` |
| E-05 | **Nunca sin administrador:** no se puede desactivar ni degradar al último | `src/usuarios/usuarios.service.ts` | `20-usuarios-last-admin` |
| E-06 | **Sesiones seguras:** token guardado como hash, 12 h, se cierran al desactivar; freno de intentos por IP y por cuenta | `src/auth/` | `275-usuarios-sesiones`, `270-login-por-cuenta`, `40-auth-rate-limit`, `42-auth-login-concurrent-rate-limit` |
| E-07 | **Peticiones de otros sitios** rechazadas (CSRF) | `src/shared/origen-csrf.ts` | `295-origen-csrf` |
| E-08 | **Exportaciones a CSV sin fórmulas** que Excel ejecute | `src/shared/csv.ts` | `540-csv-formulas` |

## F. Operación

| ID | Control | Dónde | Comprobación |
|---|---|---|---|
| F-01 | **Cambios a la estructura solo por migraciones** numeradas, aplicadas antes de desplegar y registradas | `src/database/migrations/`, `schema_migrations` | Verificación en la base (37 aplicadas); RUNBOOK §6 |
| F-02 | **Respaldo diario y recuperación a un minuto exacto** (7 días) | Cloud SQL | Prueba manual documentada: restauración probada el 27-oct-2026 (RUNBOOK §9) |
| F-03 | **Aviso si la API se cae** (revisión cada 5 minutos, correo a T1 y T2) | Cloud Monitoring | Prueba manual documentada: alerta de prueba disparada el 28-oct-2026 (RUNBOOK §11) |
| F-04 | **Auditoría periódica de calidad de datos** | `docs/documentacion/auditar-datos.mjs` | Primera corrida el 28-oct-2026 ([reporte](auditorias/calidad-2026-10-28.md)) |
| F-05 | **Avisos a n8n que no se pierden:** bandeja de salida con reintentos (5 s, 30 s, 120 s) y procesos fallidos para revisar | `src/outbox/` | `50-outbox-dispatcher-retry`, `285-outbox-no-se-atora`, `340-outbox-carreras` |
| F-06 | **Diccionario al día:** se regenera de la base real después de cada migración | `docs/documentacion/generar-diccionario.mjs` | Generado el 28-oct-2026: 393 campos, 0 sin descripción |

## G. Controles propuestos (fuera de este corte)

Salen de los puntos señalados del diccionario (§8) y de la auditoría. No están en el denominador de T1.3; si Dirección
los aprueba, entran al siguiente corte.

| ID | Propuesta | Por qué | Esfuerzo |
|---|---|---|---|
| G-01 | Avisar en la importación cuando el nombre de una empresa se parece a una que ya existe | Hoy las empresas no se deduplican por nombre | Medio |
| G-02 | Catálogo de giros (o normalizarlos al capturar) | El giro es texto libre; las plantillas por giro dependen de que se escriba igual | Bajo |
| G-03 | Teléfonos en formato internacional (E.164) | «442…» y «52442…» cuentan como distintos | Medio |
| G-04 | Regla de asignación de las empresas que crea la automatización | Hoy llegan sin responsable (19 en la auditoría) | Decisión de Dirección |

## Cómo comprobarlo

```bash
npm test                          # API: 736 pruebas (necesita la base MySQL de pruebas; ver «Pruebas automatizadas» en el README)
cd frontend && npm test           # front: 30 pruebas
node docs/documentacion/auditar-datos.mjs      # auditoría de calidad (ver instrucciones en el archivo)
```
