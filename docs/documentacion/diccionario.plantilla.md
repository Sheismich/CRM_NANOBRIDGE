# Diccionario de datos y reglas · CRM NANOBRIDGE

**Entregable:** OB-01 (diccionario y reglas) y apoyo de OB-02 (base maestra controlada), proyecto naranja · outbound.
**Para:** revisión G4 · CDR (semana 10, 2-6 nov 2026).
**Dueño:** T1 (datos y estandarización) · **Revisión:** T2 y Dirección General.
**Versión:** 1.0 · generado el {{FECHA}} desde la base real, con migraciones hasta `{{MIGRACION}}` ({{MIGRACIONES}} en total). Cubre {{TOTALES}}.

> Este documento se genera con `generar-diccionario.mjs` (misma carpeta) a partir de la estructura real de la
> base y de las reglas del código. No editar las tablas a mano: cambiar el script y volver a generarlo (ver al final).

## 1. Cómo leer este diccionario

- **Formato:** tipo de dato y tamaño máximo. Las fechas con hora están en **UTC** (México es UTC−6); la pantalla las muestra en hora de México.
- **Obligatorio:** «sí» = la base no acepta el registro sin ese dato; «auto» = lo pone la base.
- **Fuente:** quién escribe en la tabla: el CRM (personas con sesión), la importación CSV, n8n (la automatización, con su llave) o la API sola (trabajos programados).
- **Actualización:** cómo cambia un registro después de creado.
- **→ `tabla.campo`:** el campo apunta a otro registro (llave foránea); la base no deja guardar uno que no exista.
- **⚠:** punto señalado: un dato sin regla cerrada o una decisión pendiente (ver §8).

## 2. Mapa de tablas

{{INDICE}}

**Relación principal:** `empresas` 1—N `contactos` 1—N `medios_contacto` · `contactos` 1—N `prospectos` 1—N `envios` 1—N `respuestas`
· `empresas` 1—N `oportunidades` 1—N `cotizaciones` (versiones) 1—N `cotizacion_partidas` · `empresas` 1—N `documentos` (versiones)
· `tareas` y `actividades` cuelgan de la empresa, el contacto o el prospecto.

## 3. Identidad de una persona y reglas de duplicados

Una misma persona no debe existir dos veces. La regla es la misma para el alta manual, la importación CSV y n8n
(`src/shared/identidad.ts`, decisión del 2-oct-2026: **«el correo manda»**):

1. **Con correo, solo el correo identifica.** Mismo correo = misma persona. Mismo teléfono con otro correo = **otra** persona
   (dos personas que comparten el conmutador de su empresa).
2. **Sin correo, identifica el teléfono**, guardado como teléfono o como WhatsApp.
3. **La base lo garantiza:** `medios_contacto` no deja repetir un medio (`tipo + valor_normalizado` único en toda la base).
   Por eso un teléfono compartido queda guardado con un solo contacto; la persona nueva se crea en la misma empresa sin ese teléfono.
4. **Importación CSV:** cada fila se compara contra la base **y** contra las filas anteriores del mismo archivo. Si coincide,
   la fila queda como `duplicado`, con el contacto con el que chocó (`match_contacto_id`) y por qué (`match_motivo`). Una persona decide
   si la usa (se le crea un prospecto nuevo al contacto existente) o la rechaza. Nada entra al maestro sin confirmar.
5. **Contactos y empresas desactivados cuentan** como la misma persona: desactivar no libera su correo ni su teléfono.
6. **n8n no duplica por reintentos:** todo lo que crea lleva `execution_id` único (prospectos, envíos, respuestas, scoring,
   tareas, incidencias). Si n8n repite una llamada, la API regresa el registro que ya existía.
7. **Empresas: no hay deduplicación por nombre** ⚠ (ver §8).

## 4. Normalización

| Dato | Cómo se guarda para comparar | Dónde |
|---|---|---|
| Correo | sin espacios al inicio y al final, en minúsculas | `normalizeEmail`, `src/shared/normalize.ts` |
| Teléfono / WhatsApp | solo dígitos (sin espacios, guiones, paréntesis ni «+»); debe tener al menos 7 | `normalizePhone`, `tieneDigitosSuficientes` |
| Catálogos del CSV (tamaño, canal, confianza, prioridad) | sin mayúsculas ni acentos: «Pequeña» = `pequena`, «Teléfono» = `telefono` | `prospecto.schema.ts` |
| Supresión | igual que el medio (correo o teléfono normalizado) | `normalizarValorSupresion` |
| Textos de las pantallas | se recortan los espacios; los textos que no son UTF-8 se rechazan (400) | API |

Se guarda siempre el valor original (`valor`, para mostrarlo) y el normalizado (`valor_normalizado`, para comparar).

## 5. Validación de entrada (alta manual e importación CSV)

Un prospecto se valida igual por las dos vías (`src/crm/dto/prospecto.schema.ts`):

| Campo | Regla |
|---|---|
| Nombre de la empresa | obligatorio, 2-255 caracteres (o elegir una empresa que ya existe) |
| Nombre del contacto | obligatorio, 2-160 caracteres |
| Correo o teléfono | **al menos uno** («para poder deduplicar»); correo con formato válido (máx. 254); teléfono 7-40 caracteres y al menos 7 dígitos |
| Canal inicial | obligatorio: correo, teléfono o WhatsApp, y **tiene que venir su medio en la misma fila** |
| Tamaño | micro, pequeña, mediana o grande |
| País | clave de 2 letras; por omisión MX |
| Sitio web y fuente | solo direcciones http o https |
| Score | 0 a 100 |
| Giro, región, estado, ciudad | opcionales, máx. 120 caracteres |
| Observaciones | máx. 2,000 caracteres |

En el CSV, cada error sale en español junto a su fila para corregirlo. Las filas no confirmadas expiran a los 30 días.

**Para que la automatización le escriba** (`listo-para-automatizacion.ts`), además: la empresa necesita **giro y tamaño**, el contacto
un **correo activo** que no esté en supresión, la persona no debe estar en baja, contacto y empresa activos, y menos de 3 correos en
su ciclo de 6 meses.

## 6. Estados del prospecto

`prospectos.estado` es texto en la base ⚠; los valores válidos los fija el código:

| Estado | Significa | Quién lo pone |
|---|---|---|
| `capturado` | Recién creado (alta manual, CSV o n8n) | CRM / n8n |
| `en_fila` | Mandado a la fila de automatización; n8n lo toma de 6 a 10 por día | CRM («Mandar a automatización») |
| `validado` | Pasó las validaciones de n8n; listo para campaña («En campaña» si ya recibió correo) | n8n |
| `excluido` | No pasó validaciones (sin giro, sin correo…); se puede corregir y volver a mandar | n8n |
| `descartado` | Descartado por la automatización | n8n |
| `inactivo` | Terminó sus 3 correos sin respuesta | n8n |
| `interesado` · `no_interesado` | Respondió y se clasificó así | n8n / CRM |
| `en_revision` | Respuesta ambigua: la clasifica una persona | n8n |
| `baja` | Pidió no recibir más correos; sus medios pasan a no_contactar y a supresión | n8n / CRM |

Estados cerrados (no reciben más correos): `baja`, `interesado`, `no_interesado`, `descartado`, `excluido`, `inactivo`.

## 7. Reglas de actualización y trazabilidad

- **Carga separada del maestro:** todo lo que entra por CSV o alta manual pasa primero por `borradores_captura` y una persona lo confirma.
- **No se borra lo importante:** empresas, contactos, usuarios y documentos se **desactivan**; medios y supresión no se eliminan.
- **Historial inmutable:** cotizaciones y documentos crean una versión nueva en lugar de cambiar la anterior; `historial_etapa_oportunidad`,
  `resultados_scoring`, `actividades` y `auditoria` solo reciben registros nuevos.
- **Bitácora de cambios:** `auditoria` guarda quién cambió qué, con el antes y el después. Se consulta en Administración → Registro de cambios.
- **Quién puede ver qué:** un agente solo ve las empresas de las que es propietario y lo que cuelga de ellas; supervisor y administrador ven todo.
- **Cambios a la estructura:** solo por migraciones numeradas (`src/database/migrations/`), que se aplican antes de desplegar (RUNBOOK §6),
  y quedan en `schema_migrations`.

## 8. Puntos señalados

| # | Punto | Impacto | Propuesta |
|---|---|---|---|
| 1 | **Empresas sin deduplicación por nombre.** Si la misma empresa llega en dos filas de CSV con personas distintas (y sin teléfono en común), queda dos veces. | Dos fichas para un mismo cliente; afecta T1.2 (duplicados). | Avisar en la revisión del CSV cuando el nombre se parezca a una empresa existente, o revisarlo en la auditoría de datos. |
| 2 | **`prospectos.estado` es texto libre** en la base; los valores válidos solo están en el código. | Un valor mal escrito no lo detiene la base. | Aceptable mientras todo pase por la API; documentado en §6. |
| 3 | **`empresas.giro` es texto libre** (sin catálogo): «Manufactura» y «manufactura» cuentan como distintos. | Plantillas por giro y reportes por giro. | Catálogo de giros, o normalizar al capturar. |
| 4 | **Región, estado y ciudad** son texto libre. | Filtros y reportes por zona. | Catálogo de estados de México. |
| 5 | **Teléfonos sin formato internacional** (solo dígitos; «442…» y «52442…» son distintos). | Posible duplicado de la misma persona por teléfono. | Normalizar a E.164 (está en el backlog). |
| 6 | **Correos de Gmail con puntos o «+»** (`ana.ruiz@` y `anaruiz@`) cuentan como distintos. | Duplicados raros. | Está en el backlog; bajo impacto. |

## 9. Tablas y campos

{{TABLAS}}

## 10. Campos sin descripción

{{PENDIENTES}}

## 11. Cómo volver a generarlo

Después de cada migración nueva:

```bash
npm run migrate                         # contra una base local (no producción)
DICCIONARIO_DB_URL="mysql://root:<contraseña>@127.0.0.1:33306/<base>" node docs/documentacion/generar-diccionario.mjs
```

El script lee la estructura de esa base y los comentarios de `src/database/schema.ts`. Las descripciones de negocio y las reglas
de este documento están en `generar-diccionario.mjs` y en `diccionario.plantilla.md`: si un campo nuevo sale con ⚠, se agrega ahí.
