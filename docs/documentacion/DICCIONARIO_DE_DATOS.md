# Diccionario de datos y reglas · CRM NANOBRIDGE

**Entregable:** OB-01 (diccionario y reglas) y apoyo de OB-02 (base maestra controlada), proyecto naranja · outbound.
**Para:** revisión G4 · CDR (semana 10, 2-6 nov 2026).
**Dueño:** T1 (datos y estandarización) · **Revisión:** T2 y Dirección General.
**Versión:** 1.0 · generado el 28 de octubre de 2026 desde la base real, con migraciones hasta `037_borrador_empresa_existente.sql` (37 en total). Cubre 35 tablas y 393 campos.

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

- **Clientes y prospección:** `borradores_captura`, `contactos`, `empresas`, `medios_contacto`, `prospectos`
- **Campañas y correo:** `campanas`, `correos_respuesta`, `envios`, `lista_supresion`, `parametros_automatizacion`, `plantillas_correo`, `respuestas`
- **Automatización (n8n):** `eventos_pendientes`, `incidencias`, `procesos_fallidos`, `resultados_scoring`
- **Ventas:** `cotizacion_partidas`, `cotizaciones`, `historial_etapa_oportunidad`, `oportunidades`
- **Documentos:** `catalogo_tipo_documento`, `documentos`
- **Seguimiento:** `actividades`, `notificaciones`, `tareas`, `uso_ia`
- **Reportes:** `metricas_comerciales_diarias`
- **Catálogos:** `catalogo_etapa_embudo`, `catalogo_motivo_perdida`
- **Usuarios y seguridad:** `auditoria`, `login_fallos`, `roles`, `sesiones`, `usuarios`
- **Sistema:** `schema_migrations`

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
| 3 | **`empresas.giro` es texto libre** (sin catálogo). La base compara sin distinguir mayúsculas ni acentos, así que filtros y plantillas por giro tratan «Manufactura» y «manufactura» como el mismo; pero se guarda tal como se escribió y en pantalla (por ejemplo, las opciones del filtro de giro de Empresas) salen las dos formas. Un giro con otra palabra («Industria manufacturera») sí cuenta como otro. | Opciones repetidas en pantallas; plantillas por giro que no aplican si el giro se escribe distinto. | Catálogo de giros, o normalizar al capturar. La auditoría de datos reporta las formas distintas. |
| 4 | **Región, estado y ciudad** son texto libre. | Filtros y reportes por zona. | Catálogo de estados de México. |
| 5 | **Teléfonos sin formato internacional** (solo dígitos; «442…» y «52442…» son distintos). | Posible duplicado de la misma persona por teléfono. | Normalizar a E.164 (está en el backlog). |
| 6 | **Correos de Gmail con puntos o «+»** (`ana.ruiz@` y `anaruiz@`) cuentan como distintos. | Duplicados raros. | Está en el backlog; bajo impacto. |

## 9. Tablas y campos

### Clientes y prospección

#### `borradores_captura`

Área de carga (staging): cada fila de una importación CSV o de un alta manual antes de volverse empresa + contacto + prospecto. Separa la carga del maestro.

- **Fuente:** Importación CSV del CRM; CRM (pantallas, con sesión).
- **Actualización:** Una persona confirma o rechaza cada fila. Las no confirmadas expiran a los 30 días (trabajo programado).
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `lote_id` | texto (máx. 64) | sí | Identificador del archivo o lote importado. |
| `fuente` | texto (máx. 255) | sí | De dónde vino la fila (archivo CSV o alta manual). |
| `fila_numero` | entero | sí | Número de renglón en el archivo. |
| `fila_original` | JSON | sí | La fila tal como venía, para revisarla. |
| `empresa_id` | entero | no | Empresa que ya existía, elegida en el alta manual. NULL = crear una. → `empresas.id` |
| `empresa_nombre_legal` | texto (máx. 255) | no | Como venía en la fila; al confirmarla pasa a `empresas.nombre_legal`. |
| `empresa_giro` | texto (máx. 120) | no | Como venía en la fila; al confirmarla pasa a `empresas.giro`. |
| `empresa_tamano` | uno de: micro, pequena, mediana, grande | no | Como venía en la fila; al confirmarla pasa a `empresas.tamano`. |
| `empresa_region` | texto (máx. 120) | no | Como venía en la fila; al confirmarla pasa a `empresas.region`. |
| `empresa_estado` | texto (máx. 120) | no | Como venía en la fila; al confirmarla pasa a `empresas.estado`. |
| `empresa_ciudad` | texto (máx. 120) | no | Como venía en la fila; al confirmarla pasa a `empresas.ciudad`. |
| `empresa_pais` | texto fijo (2) | sí | Como venía en la fila; al confirmarla pasa a `empresas.pais`. Por omisión: `MX`. |
| `empresa_sitio_web` | texto (máx. 2048) | no | Como venía en la fila; al confirmarla pasa a `empresas.sitio_web`. |
| `contacto_nombre` | texto (máx. 160) | no | Como venía en la fila; al confirmarla pasa a `contactos.nombre`. |
| `contacto_puesto` | texto (máx. 160) | no | Como venía en la fila; al confirmarla pasa a `contactos.puesto`. |
| `correo` | texto (máx. 254) | no | Correo electrónico. |
| `correo_normalizado` | texto (máx. 254) | no | Correo normalizado, para detectar duplicados. |
| `telefono` | texto (máx. 40) | no | Como venía en la fila; al confirmarla pasa a medios_contacto (teléfono). |
| `telefono_normalizado` | texto (máx. 40) | no | Teléfono normalizado (solo dígitos), para detectar duplicados. |
| `canal_inicial` | uno de: correo, telefono, whatsapp | no | Por dónde se le contactará primero. Debe tener su medio en la misma fila. |
| `confianza` | uno de: alta, media, baja | no | Confianza (valores en Formato). |
| `prioridad` | uno de: alta, media, baja | no | Prioridad (valores en Formato). |
| `score` | número decimal (2 decimales) | no | Calificación 0-100. |
| `fuente_url` | texto (máx. 2048) | no | Como venía en la fila; al confirmarla pasa a prospectos.fuente_url. |
| `observaciones` | texto largo | no | Notas libres. |
| `estado` | uno de: pendiente_revision, duplicado, importado, rechazado, expirado | sí | pendiente_revision = lista para confirmar; duplicado = ya existe esa persona; importado; rechazado; expirado (30 días sin confirmar). Por omisión: `pendiente_revision`. |
| `match_contacto_id` | entero | no | Contacto existente con el que coincidió (si es duplicado). → `contactos.id` |
| `match_motivo` | uno de: correo, telefono | no | Por qué coincidió: mismo correo o, si no trae correo, mismo teléfono. |
| `errores` | JSON | no | Errores de validación de la fila (JSON), en español. |
| `prospecto_id` | entero | no | Prospecto relacionado. → `prospectos.id` |
| `campana_id` | entero | no | Campaña relacionada. → `campanas.id` |
| `creado_por` | entero | sí | Quién lo creó (vacío = la automatización). → `usuarios.id` |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `expira_en` | fecha y hora (UTC) | sí | Fecha en que la fila expira si nadie la confirma. |
| `procesado_en` | fecha y hora (UTC) | no | Cuándo se confirmó o rechazó la fila. |
| `procesado_por` | entero | no | → `usuarios.id` |

#### `contactos`

Persona dentro de una empresa. Todo contacto pertenece a una empresa.

- **Fuente:** CRM (pantallas, con sesión); Importación CSV del CRM; n8n (API /automatizacion, llave X-API-Key).
- **Actualización:** Se edita desde la ficha o Contactos. No se borra: se desactiva.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `empresa_id` | entero | sí | Empresa a la que pertenece. → `empresas.id` |
| `nombre` | texto (máx. 160) | sí | Nombre de la persona. Obligatorio, 2-160 caracteres. |
| `puesto` | texto (máx. 160) | no | Puesto de la persona. |
| `area` | texto (máx. 160) | no | Área o departamento. |
| `linkedin_url` | texto (máx. 2048) | no | Perfil de LinkedIn (solo http/https). |
| `facebook_url` | texto (máx. 2048) | no | Página de Facebook (solo http/https). |
| `instagram_url` | texto (máx. 2048) | no | Perfil de Instagram (solo http/https). |
| `activo` | sí/no (1/0) | sí | 1 = vigente; 0 = desactivado (se oculta, no se borra). Por omisión: `1`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |

#### `empresas`

Empresa (persona moral o negocio) con la que se trata. Es la ficha del cliente.

- **Fuente:** CRM (pantallas, con sesión); Importación CSV del CRM; n8n (API /automatizacion, llave X-API-Key).
- **Actualización:** Se edita desde la ficha. No se borra: se desactiva (activo = 0) y deja de aparecer.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `nombre_legal` | texto (máx. 255) | sí | Razón social o nombre con el que se registró. Obligatorio, 2-255 caracteres. |
| `nombre_comercial` | texto (máx. 255) | no | Nombre con el que se le conoce; si existe, se muestra en lugar del legal. |
| `giro` | texto (máx. 120) | no | Industria. Texto libre (sin catálogo) ⚠. Sin giro, la automatización no le escribe. |
| `tamano` | uno de: micro, pequena, mediana, grande | no | Tamaño de la empresa. Sin tamaño, la automatización no le escribe. |
| `region` | texto (máx. 120) | no | Región (ej. Bajío). Texto libre. |
| `estado` | texto (máx. 120) | no | Estado de la República. Texto libre. |
| `ciudad` | texto (máx. 120) | no | Ciudad. Texto libre. |
| `pais` | texto fijo (2) | sí | País, clave ISO de 2 letras. Por omisión MX. Por omisión: `MX`. |
| `sitio_web` | texto (máx. 2048) | no | Sitio web (solo http/https). |
| `linkedin_url` | texto (máx. 2048) | no | Perfil de LinkedIn (solo http/https). |
| `facebook_url` | texto (máx. 2048) | no | Página de Facebook (solo http/https). |
| `instagram_url` | texto (máx. 2048) | no | Perfil de Instagram (solo http/https). |
| `propietario_id` | entero | no | Vendedor dueño de la cuenta. Un agente solo ve sus empresas. Vacío = sin responsable. → `usuarios.id` |
| `activo` | sí/no (1/0) | sí | 1 = vigente; 0 = desactivado (se oculta, no se borra). Por omisión: `1`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |

#### `medios_contacto`

Correos, teléfonos, WhatsApp, LinkedIn o sitio web de un contacto o de una empresa (exactamente uno de los dos, ver chk_medio_un_dueno). Es la base de la deduplicación.

- **Fuente:** CRM (pantallas, con sesión); Importación CSV del CRM; n8n (API /automatizacion, llave X-API-Key).
- **Actualización:** Se agrega o se marca no_contactar / obsoleto; no se borra. Una baja o un rebote lo pasa a no_contactar.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `tipo + valor_normalizado`.
- **Regla en la base (`chk_medio_un_dueno`):** `((empresa_id is not null) <> (contacto_id is not null))`

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `empresa_id` | entero | no | Empresa a la que pertenece. → `empresas.id` |
| `contacto_id` | entero | no | Contacto al que pertenece. → `contactos.id` |
| `tipo` | uno de: correo, telefono, whatsapp, linkedin, sitio_web | sí | Qué es: correo, teléfono, WhatsApp, LinkedIn o sitio web. |
| `valor` | texto (máx. 512) | sí | Como se capturó (para mostrarlo). |
| `valor_normalizado` | texto (máx. 512) | sí | Versión para comparar: correo en minúsculas y sin espacios; teléfono solo dígitos. Único por tipo en toda la base. |
| `es_principal` | sí/no (1/0) | sí | El medio que se usa primero de ese tipo. Por omisión: `0`. |
| `estado_contacto` | uno de: activo, no_contactar, obsoleto | sí | activo = se le puede escribir; no_contactar = baja, rebote o queja; obsoleto = ya no sirve. Por omisión: `activo`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `prospectos`

Un contacto dentro del proceso de prospección (una 'entrada' al embudo). La misma persona puede tener varios prospectos en el tiempo (ciclos de 6 meses).

- **Fuente:** CRM (pantallas, con sesión); Importación CSV del CRM; n8n (API /automatizacion, llave X-API-Key).
- **Actualización:** El estado lo cambian n8n (validación, scoring, envíos, respuestas) y el CRM (clasificación, fila de automatización). Cada cambio de estado deja registro en auditoria.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `execution_id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `contacto_id` | entero | sí | Contacto al que pertenece. → `contactos.id` |
| `campana_id` | entero | no | Campaña en la que va. → `campanas.id` |
| `execution_id` | texto (máx. 100) | no | Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia). |
| `estado` | texto (máx. 60) | sí | Etapa en la prospección. Texto (no ENUM) ⚠: los valores válidos están en la sección «Estados del prospecto». Por omisión: `capturado`. |
| `score` | número decimal (2 decimales) | no | Calificación 0-100 de la automatización (última de resultados_scoring). |
| `prioridad` | uno de: alta, media, baja | no | Prioridad que asigna el scoring. |
| `fuente_url` | texto (máx. 2048) | no | De dónde salió el dato (página, directorio). Solo http/https. |
| `confianza` | uno de: alta, media, baja | no | Qué tan confiable es el dato de origen. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |
| `fila_desde` | fecha y hora (UTC) | no | Cuándo se mandó a la fila de automatización (botón «Mandar a automatización»). |
| `fila_por` | entero | no | Quién lo mandó a la fila. |
| `fila_tomado_en` | fecha y hora (UTC) | no | Cuándo lo tomó n8n de la fila. |
| `fila_execution_id` | texto (máx. 100) | no | Corrida de n8n que lo tomó de la fila. |
| `fila_estado_previo` | texto (máx. 60) | no | Estado que tenía antes de entrar a la fila (para regresarlo si se saca). |

### Campañas y correo

#### `campanas`

Campaña de prospección: agrupa prospectos y tiene vigencia y estado.

- **Fuente:** CRM (pantallas, con sesión).
- **Actualización:** Administración la crea, pausa o finaliza.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `nombre` | texto (máx. 160) | sí | Nombre. |
| `canal` | uno de: correo, whatsapp | sí | Canal: correo o WhatsApp (WhatsApp todavía no se usa). Por omisión: `correo`. |
| `estado` | uno de: borrador, activa, pausada, finalizada | sí | borrador, activa, pausada o finalizada. Solo una campaña vigente manda correos. Por omisión: `borrador`. |
| `fecha_inicio` | fecha (AAAA-MM-DD) | no | Desde cuándo manda correos. Vacía = desde que se activa. |
| `fecha_fin` | fecha (AAAA-MM-DD) | no | Hasta cuándo manda correos. Vacía = sin fin. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |

#### `correos_respuesta`

Correo que un vendedor le contestó a un prospecto desde el CRM (etapa 3), en el mismo hilo.

- **Fuente:** CRM (pantallas, con sesión).
- **Actualización:** Se crea al mandar; pasa de enviando a enviado o fallido. No se edita.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `respuesta_id` | entero | sí | Respuesta relacionada. → `respuestas.id` |
| `prospecto_id` | entero | sí | Prospecto relacionado. → `prospectos.id` |
| `usuario_id` | entero | sí | Usuario relacionado. → `usuarios.id` |
| `para` | texto (máx. 320) | sí | Destinatario: siempre el remitente de la respuesta original (no se puede cambiar). |
| `asunto` | texto (máx. 500) | sí | Asunto del correo. |
| `texto` | texto largo | sí | Texto del correo. |
| `uso_ia` | uno de: sin_ia, tal_cual, editado | sí | sin_ia, tal_cual (borrador de la IA sin cambios) o editado. Por omisión: `sin_ia`. |
| `estado` | uno de: enviando, enviado, fallido | sí | Estado (valores en Formato). Por omisión: `enviando`. |
| `error` | texto (máx. 300) | no | Error, si falló. |
| `proveedor_id` | texto (máx. 255) | no | Identificador del correo en SendGrid. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `enviado_en` | fecha y hora (UTC) | no | Cuándo confirmó SendGrid el envío. |

#### `envios`

Cada correo de prospección que salió (inicial o recordatorio) y su ventana de espera de respuesta.

- **Fuente:** n8n (API /automatizacion, llave X-API-Key).
- **Actualización:** n8n lo registra al enviar; la ventana pasa a vencida o cerrada (al responder). No se borra.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `execution_id`; `prospecto_id + canal + numero_contacto`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `prospecto_id` | entero | sí | Prospecto relacionado. → `prospectos.id` |
| `canal` | uno de: correo, whatsapp | sí | Canal: correo o WhatsApp (WhatsApp todavía no se usa). Por omisión: `correo`. |
| `numero_contacto` | entero | sí | 1 = correo inicial; 2 y 3 = recordatorios. Máximo 3 por persona cada 6 meses. |
| `ventana_vence_en` | fecha y hora (UTC) | sí | Hasta cuándo se espera respuesta antes del siguiente recordatorio (5 días hábiles). |
| `ventana_estado` | uno de: abierta, vencida, cerrada | sí | abierta = esperando; vencida = toca recordatorio; cerrada = ya respondió o terminó. Por omisión: `abierta`. |
| `execution_id` | texto (máx. 100) | no | Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia). |
| `enviado_en` | fecha y hora (UTC) | sí | Cuándo salió el correo. |
| `plantilla_id` | entero | no | Plantilla con la que salió (para rearmarlo si n8n reintenta). |
| `asunto` | texto (máx. 200) | no | Asunto con el que salió. |

#### `lista_supresion`

Correos, teléfonos o WhatsApp a los que nunca se les escribe (bajas, rebotes, quejas).

- **Fuente:** n8n (API /automatizacion, llave X-API-Key); CRM (pantallas, con sesión); La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Solo se agrega. Pesa más que cualquier otra regla.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `tipo + valor_normalizado`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `tipo` | uno de: correo, telefono, whatsapp | sí | Qué se suprime: correo, teléfono o WhatsApp. |
| `valor_normalizado` | texto (máx. 512) | sí | Correo o teléfono normalizado. Único por tipo. |
| `motivo` | texto (máx. 255) | sí | Por qué se suprimió (baja, rebote, queja…). |
| `execution_id` | texto (máx. 100) | no | Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia). |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `parametros_automatizacion`

Parámetros de la automatización que lee n8n (ej. pie de los correos).

- **Fuente:** CRM (pantallas, con sesión); Migración (valores iniciales).
- **Actualización:** Se edita en Administración.
- **Identificador:** `clave`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `clave` | texto (máx. 80) | sí | Nombre del parámetro (clave). |
| `valor` | JSON | sí | Valor (JSON). |
| `descripcion` | texto (máx. 255) | no | Descripción. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |

#### `plantillas_correo`

Texto de los 3 correos de prospección (1 = inicial, 2 y 3 = recordatorios). giro vacío = general.

- **Fuente:** CRM (pantallas, con sesión); Migración (valores iniciales).
- **Actualización:** Administrador o supervisor la edita en Administración → Correos de prospección.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `giro + numero`.
- **Regla en la base (`chk_plantillas_correo_numero`):** `(numero between 1 and 3)`

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `giro` | texto (máx. 120) | sí | Giro al que aplica; vacío = la general. Por omisión: ``. |
| `numero` | entero | sí | 1 = correo inicial; 2 y 3 = recordatorios. |
| `asunto` | texto (máx. 200) | sí | Asunto del correo. |
| `cuerpo` | texto largo | sí | Texto del correo. Admite {{primer_nombre}}, {{empresa}} y enlaces [texto](https://…). |
| `actualizado_por` | entero | no | Quién lo cambió por última vez. → `usuarios.id` |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |

#### `respuestas`

Respuesta de un prospecto a un correo (entra por SendGrid Inbound Parse → n8n). Incluye su clasificación.

- **Fuente:** n8n (API /automatizacion, llave X-API-Key); CRM (pantallas, con sesión).
- **Actualización:** n8n la registra y propone una clasificación; una persona puede clasificarla o corregirla en el CRM.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `execution_id`; `execution_id_clasificacion`.
- **Regla en la base (`chk_respuestas_confianza_sugerida`):** `(confianza_sugerida <= 100)`

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `prospecto_id` | entero | sí | Prospecto relacionado. → `prospectos.id` |
| `envio_id` | entero | no | Envío al que responde. → `envios.id` |
| `canal` | uno de: correo, whatsapp | sí | Canal: correo o WhatsApp (WhatsApp todavía no se usa). Por omisión: `correo`. |
| `contenido` | texto largo | no | Texto de la respuesta del prospecto. |
| `tardia` | sí/no (1/0) | sí | Llegó después de cerrada la ventana. Por omisión: `0`. |
| `estado` | uno de: pendiente_clasificacion, clasificada | sí | pendiente_clasificacion o clasificada. Por omisión: `pendiente_clasificacion`. |
| `clasificacion` | uno de: interesado, no_interesado, baja, automatica, ambigua, invalido, reagendar | no | Decisión final (persona o n8n). invalido y reagendar solo los pone una persona. |
| `comentario` | texto (máx. 500) | no | Comentario de quien lo registró. |
| `execution_id` | texto (máx. 100) | no | Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia). |
| `execution_id_clasificacion` | texto (máx. 100) | no | Corrida de n8n que la clasificó (única). |
| `recibido_en` | fecha y hora (UTC) | sí | Cuándo llegó. |
| `clasificado_en` | fecha y hora (UTC) | no | Cuándo se clasificó. |
| `clasificacion_sugerida` | uno de: interesado, no_interesado, baja, automatica, ambigua | no | Lo que PROPONE la IA de n8n (modo sugerencia). No es la decisión: esa sigue en estado/clasificacion. |
| `confianza_sugerida` | entero | no | Confianza 0-100 de la sugerencia de la IA. |
| `motivo_sugerencia` | texto (máx. 500) | no | Por qué la IA propuso esa clasificación. |
| `execution_id_sugerencia` | texto (máx. 100) | no | Corrida de n8n que hizo la sugerencia. |
| `sugerido_en` | fecha y hora (UTC) | no | Cuándo la IA hizo la sugerencia. |
| `remitente` | texto (máx. 320) | no | El "From" del correo, tal cual lo manda n8n. |
| `message_id` | texto (máx. 255) | no | Para contestar en el mismo hilo (opcionales). |
| `asunto` | texto (máx. 500) | no | Asunto del correo. |

### Automatización (n8n)

#### `eventos_pendientes`

Bandeja de salida (patrón outbox): avisos de la API hacia n8n que se reintentan hasta entregarse.

- **Fuente:** La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** El despachador la procesa sola: pendiente → enviado o fallido.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `evento_uuid`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `evento_uuid` | texto fijo (36) | sí | Identificador único del evento (n8n lo usa para no procesarlo dos veces). |
| `tipo` | texto (máx. 100) | sí | Tipo (valores en Formato). |
| `entidad_tipo` | texto (máx. 50) | sí | Tipo de registro al que se refiere. |
| `entidad_id` | entero | sí | Identificador de ese registro. |
| `payload` | JSON | sí | Datos del aviso para n8n (JSON). |
| `estado` | uno de: pendiente, procesando, enviado, fallido | sí | Estado (valores en Formato). Por omisión: `pendiente`. |
| `intentos` | entero | sí | Cuántas veces se intentó entregar (reintentos a los 5 s, 30 s y 120 s). Por omisión: `0`. |
| `proximo_intento_en` | fecha y hora (UTC) | no | Cuándo se vuelve a intentar entregarlo. |
| `ultimo_error` | texto largo | no | Último error al intentar. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |

#### `incidencias`

Problemas que reporta n8n durante una corrida (dato faltante, servicio caído).

- **Fuente:** n8n (API /automatizacion, llave X-API-Key).
- **Actualización:** Se registra abierta y se marca resuelta.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `execution_id + tipo`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `execution_id` | texto (máx. 100) | no | Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia). |
| `prospecto_id` | entero | no | Prospecto relacionado. → `prospectos.id` |
| `tipo` | texto (máx. 60) | sí | Tipo (valores en Formato). |
| `severidad` | uno de: baja, media, alta | sí | Gravedad (valores en Formato). Por omisión: `media`. |
| `mensaje` | texto largo | sí | Descripción del problema. |
| `detalle` | JSON | no | Detalle adicional. |
| `estado` | uno de: abierta, resuelta | sí | Estado (valores en Formato). Por omisión: `abierta`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |

#### `procesos_fallidos`

Fallas que requieren revisión humana (errores críticos de un flujo o eventos que no se pudieron entregar).

- **Fuente:** n8n (API /automatizacion, llave X-API-Key); La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Se revisa y se marca resuelto en Administración.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `execution_id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `evento_id` | entero | no | Evento de la bandeja de salida relacionado. → `eventos_pendientes.id` |
| `execution_id` | texto (máx. 100) | no | Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia). |
| `tipo` | texto (máx. 100) | sí | Tipo (valores en Formato). |
| `payload` | JSON | sí | Datos completos del evento (JSON). |
| `mensaje` | texto largo | sí | Descripción del problema. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `workflow` | texto (máx. 120) | no | Flujo de n8n donde ocurrió. |
| `nodo` | texto (máx. 120) | no | Nodo del flujo de n8n. |
| `endpoint` | texto (máx. 160) | no | Ruta de la API que se estaba llamando. |
| `codigo_http` | entero | no | Código HTTP de la respuesta, si hubo. |
| `estado` | uno de: abierto, en_revision, resuelto | sí | Estado (valores en Formato). Por omisión: `abierto`. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |

#### `resultados_scoring`

Cada calificación (score 0-100) que n8n calculó para un prospecto, con Gemini o reglas.

- **Fuente:** n8n (API /automatizacion, llave X-API-Key).
- **Actualización:** Solo se inserta (historial). El score vigente se copia a prospectos.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `execution_id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `execution_id` | texto (máx. 100) | sí | Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia). |
| `prospecto_id` | entero | sí | Prospecto relacionado. → `prospectos.id` |
| `score` | número decimal (2 decimales) | sí | Calificación 0-100. |
| `prioridad` | uno de: alta, media, baja | no | Prioridad (valores en Formato). |
| `confianza` | uno de: alta, media, baja | no | Confianza (valores en Formato). |
| `metodo` | uno de: gemini, reglas | sí | gemini = lo calculó la IA; reglas = respaldo sin IA. Por omisión: `gemini`. |
| `detalle` | JSON | no | Desglose del cálculo (JSON). |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

### Ventas

#### `cotizacion_partidas`

Renglones (conceptos) de una cotización.

- **Fuente:** CRM (pantallas, con sesión).
- **Actualización:** Se guardan con su versión; no se editan después.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `cotizacion_id` | entero | sí | → `cotizaciones.id` |
| `descripcion` | texto (máx. 255) | sí | Descripción. |
| `cantidad` | número decimal (2 decimales) | sí | Cantidad. |
| `precio_unitario` | número decimal (2 decimales) | sí | Precio por unidad en MXN. |
| `importe` | número decimal (2 decimales) | sí | cantidad × precio_unitario. |
| `orden` | entero | sí | Orden en que se muestra. Por omisión: `0`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `detalle` | texto (máx. 255) | no | Segunda línea opcional de la partida en el documento. |

#### `cotizaciones`

Cotización de una oportunidad. Cada versión es una fila; las anteriores quedan obsoletas (historial inmutable).

- **Fuente:** CRM (pantallas, con sesión).
- **Actualización:** Borrador → enviada → aceptada / rechazada / vencida. Cambiar una enviada crea una versión nueva.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `empresa_id` | entero | sí | Empresa a la que pertenece. → `empresas.id` |
| `oportunidad_id` | entero | sí | Oportunidad relacionada. → `oportunidades.id` |
| `contacto_id` | entero | no | Contacto al que pertenece. → `contactos.id` |
| `cotizacion_raiz_id` | entero | no | Primera versión de esta cotización (agrupa sus versiones). → `cotizaciones.id` |
| `version` | entero | sí | Número de versión (1, 2, 3…). Por omisión: `1`. |
| `moneda` | texto fijo (3) | sí | Siempre MXN. Por omisión: `MXN`. |
| `subtotal` | número decimal (2 decimales) | sí | Suma de los importes de las partidas, en MXN. |
| `descuento` | número decimal (2 decimales) | sí | Descuento en MXN. Por omisión: `0.00`. |
| `impuestos` | número decimal (2 decimales) | sí | IVA en MXN. Por omisión: `0.00`. |
| `total` | número decimal (2 decimales) | sí | subtotal − descuento + impuestos, en MXN (DECIMAL, sin redondeos de punto flotante). |
| `fecha_emision` | fecha (AAAA-MM-DD) | sí | Fecha del documento. |
| `fecha_envio` | fecha (AAAA-MM-DD) | no | Cuándo se marcó enviada al cliente. |
| `fecha_esperada_cierre` | fecha (AAAA-MM-DD) | no | Vigencia: hasta cuándo es válida; después pasa a vencida. |
| `probabilidad` | entero | no | Probabilidad de que la acepten, en porcentaje. |
| `estado` | uno de: borrador, enviada, aceptada, rechazada, vencida, obsoleta | sí | borrador, enviada, aceptada, rechazada, vencida u obsoleta (versión reemplazada). Por omisión: `borrador`. |
| `creado_por` | entero | sí | Quién lo creó (vacío = la automatización). → `usuarios.id` |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |
| `motivo_rechazo` | uno de: precio, tiempo_entrega, otro_proveedor, sin_presupuesto, ya_no_lo_necesita, otro | no | Por qué la rechazó el cliente. |
| `motivo_rechazo_detalle` | texto (máx. 500) | no | Explicación del rechazo (obligatoria con el motivo «otro»). |

#### `historial_etapa_oportunidad`

Cada cambio de etapa de una oportunidad, con quién y por qué (motivo si se perdió).

- **Fuente:** La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Solo se inserta.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `oportunidad_id` | entero | sí | Oportunidad relacionada. → `oportunidades.id` |
| `etapa_id` | entero | sí | → `catalogo_etapa_embudo.id` |
| `usuario_id` | entero | sí | Usuario relacionado. → `usuarios.id` |
| `motivo_perdida_id` | entero | no | → `catalogo_motivo_perdida.id` |
| `comentario` | texto (máx. 500) | no | Comentario de quien lo registró. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `oportunidades`

Posible venta con una empresa: etapa del embudo, valor estimado y fecha de cierre.

- **Fuente:** CRM (pantallas, con sesión).
- **Actualización:** Avanza de etapa (cada cambio queda en historial_etapa_oportunidad); se cierra ganada o perdida.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `empresa_id` | entero | sí | Empresa a la que pertenece. → `empresas.id` |
| `contacto_id` | entero | no | Contacto al que pertenece. → `contactos.id` |
| `prospecto_id` | entero | no | Prospecto relacionado. → `prospectos.id` |
| `titulo` | texto (máx. 255) | sí | Título. |
| `etapa_id` | entero | sí | Etapa actual del embudo (catalogo_etapa_embudo). → `catalogo_etapa_embudo.id` |
| `responsable_id` | entero | sí | Usuario responsable. → `usuarios.id` |
| `valor_estimado` | número decimal (2 decimales) | no | Monto esperado en MXN. |
| `fecha_cierre_estimada` | fecha (AAAA-MM-DD) | no | Cuándo se espera cerrar. Vencida si pasó y sigue abierta. |
| `motivo_perdida_id` | entero | no | Motivo del catálogo si se perdió. → `catalogo_motivo_perdida.id` |
| `motivo_perdida_detalle` | texto (máx. 500) | no | Explicación de la pérdida (obligatoria en los motivos que la piden). |
| `cerrada` | sí/no (1/0) | sí | 1 = ganada o perdida. Por omisión: `0`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |
| `lleva_factura` | sí/no (1/0) | sí | La venta lleva factura (su expediente pide la constancia fiscal). Por omisión: `0`. |

### Documentos

#### `catalogo_tipo_documento`

Tipos de documento (contrato, constancia fiscal…) y si son obligatorios en el expediente.

- **Fuente:** Migración (valores iniciales); CRM (pantallas, con sesión).
- **Actualización:** Administración marca cuáles son obligatorios.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `clave`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `clave` | texto (máx. 40) | sí | Clave fija que usa el código. |
| `nombre` | texto (máx. 120) | sí | Nombre. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `obligatorio` | sí/no (1/0) | sí | Papel obligatorio del expediente de un cliente. Por omisión: `0`. |
| `alcance` | uno de: venta, empresa | sí | Dónde se busca el papel (en la venta o en toda la empresa) y si solo se pide cuando la venta lleva factura. Por omisión: `empresa`. |
| `solo_con_factura` | sí/no (1/0) | sí | Solo se pide si la venta lleva factura. Por omisión: `0`. |

#### `documentos`

Archivos del expediente (PDF, DOCX, XLSX, PNG, JPG) guardados en Google Cloud Storage; aquí van sus datos. Cada versión es una fila.

- **Fuente:** CRM (pantallas, con sesión).
- **Actualización:** Se sube versión nueva; se aprueba o rechaza con motivo; se archiva. No se borra físicamente al desactivar.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `empresa_id` | entero | sí | Empresa a la que pertenece. → `empresas.id` |
| `oportunidad_id` | entero | no | Oportunidad relacionada. → `oportunidades.id` |
| `contacto_id` | entero | no | Contacto al que pertenece. → `contactos.id` |
| `documento_raiz_id` | entero | no | Primera versión de este documento. → `documentos.id` |
| `version` | entero | sí | Número de versión (1, 2, 3…). Por omisión: `1`. |
| `nombre_original` | texto (máx. 255) | sí | Nombre del archivo como se subió. |
| `mime_type` | texto (máx. 120) | sí | Tipo de archivo (PDF, DOCX, XLSX, PNG o JPG; se revisa el contenido real). |
| `tipo_documento_id` | entero | no | → `catalogo_tipo_documento.id` |
| `tamano_bytes` | entero | sí | Tamaño en bytes (máximo 25 MB). |
| `storage_driver` | texto (máx. 20) | sí | Dónde se guarda: gcs (Google Cloud Storage) o local (pruebas). |
| `storage_key` | texto (máx. 1024) | sí | Ruta del archivo en el almacenamiento (Google Cloud Storage). No se expone. |
| `estado` | uno de: vigente, obsoleto, archivado | sí | vigente, obsoleto (hay versión nueva) o archivado. Por omisión: `vigente`. |
| `politica_retencion` | texto (máx. 60) | no | Política de conservación, si se definió. |
| `subido_por` | entero | sí | Quién lo subió. → `usuarios.id` |
| `revisado_por` | entero | no | → `usuarios.id` |
| `revisado_en` | fecha y hora (UTC) | no | Cuándo se aprobó o rechazó. |
| `alertado_en` | fecha y hora (UTC) | no | Cuándo se avisó que seguía sin revisar. |
| `activo` | sí/no (1/0) | sí | 1 = vigente; 0 = desactivado (se oculta, no se borra). Por omisión: `1`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |
| `revision` | uno de: por_revisar, aprobado, rechazado | sí | por_revisar, aprobado o rechazado (de esta versión). Por omisión: `por_revisar`. |
| `motivo_rechazo` | uno de: ilegible, vencido, incompleto, no_es_de_la_empresa, tipo_equivocado, otro | no | Por qué se rechazó (valores en Formato). |
| `motivo_rechazo_detalle` | texto (máx. 500) | no | Explicación del rechazo (obligatoria con el motivo «otro»). |

### Seguimiento

#### `actividades`

Lo que ya pasó y se anotó a mano: llamadas, WhatsApp y comentarios.

- **Fuente:** CRM (pantallas, con sesión).
- **Actualización:** Solo se inserta (bitácora).
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `empresa_id` | entero | sí | Empresa a la que pertenece. → `empresas.id` |
| `contacto_id` | entero | no | Contacto al que pertenece. → `contactos.id` |
| `oportunidad_id` | entero | no | Oportunidad relacionada. → `oportunidades.id` |
| `tipo` | uno de: llamada, whatsapp, comentario | sí | llamada, whatsapp o comentario. |
| `resultado` | texto (máx. 255) | no | Resultado (texto, o JSON según el uso). |
| `proxima_accion` | texto (máx. 255) | no | Qué sigue, si se anotó. |
| `comentario` | texto largo | no | Comentario de quien lo registró. |
| `responsable_id` | entero | sí | Usuario responsable. → `usuarios.id` |
| `ocurrida_en` | fecha y hora (UTC) | sí | Cuándo pasó (puede ser antes de anotarlo). |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `notificaciones`

Avisos para cada usuario («Lo nuevo para ti») y, si aplica, su correo.

- **Fuente:** La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Se marca leída; el correo pasa de pendiente a enviado o fallido.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `usuario_id` | entero | sí | Usuario relacionado. → `usuarios.id` |
| `tipo` | texto (máx. 40) | sí | Tipo (valores en Formato). |
| `titulo` | texto (máx. 200) | sí | Título. |
| `cuerpo` | texto (máx. 1000) | no | Texto del mensaje. |
| `enlace` | texto (máx. 300) | no | A qué pantalla lleva el aviso. |
| `entidad` | texto (máx. 40) | no | Tipo de registro al que se refiere (empresa, tarea…). |
| `entidad_id` | entero | no | Identificador de ese registro. |
| `leida_en` | fecha y hora (UTC) | no | Cuándo la leyó (vacío = no leída). |
| `correo_estado` | uno de: no_aplica, pendiente, enviado, fallido | sí | Si además salió por correo: no_aplica, pendiente, enviado o fallido. Por omisión: `no_aplica`. |
| `correo_intentos` | entero | sí | Intentos de mandar el correo. Por omisión: `0`. |
| `correo_error` | texto (máx. 500) | no | Error de SendGrid si el correo del aviso falló. |
| `correo_enviado_en` | fecha y hora (UTC) | no | Cuándo salió el correo del aviso. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `tareas`

Pendientes de una persona (llamar, clasificar una respuesta, corregir un documento). Las crea una persona o la automatización.

- **Fuente:** CRM (pantallas, con sesión); n8n (API /automatizacion, llave X-API-Key); La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** pendiente → en_progreso → cerrada / cancelada. Responsable vacío = 'Sin asignar'.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `execution_id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `tipo` | uno de: seguimiento, clasificacion, revision_documento, otro | sí | seguimiento, clasificacion (de una respuesta), revision_documento u otro. Por omisión: `seguimiento`. |
| `titulo` | texto (máx. 255) | sí | Título. |
| `descripcion` | texto largo | no | Descripción. |
| `estado` | uno de: pendiente, en_progreso, cerrada, cancelada | sí | Estado (valores en Formato). Por omisión: `pendiente`. |
| `prioridad` | uno de: baja, media, alta, urgente | sí | Prioridad (valores en Formato). Por omisión: `media`. |
| `responsable_id` | entero | no | Quién la atiende. Vacío = «Sin asignar» (así llegan las que crea la automatización). → `usuarios.id` |
| `empresa_id` | entero | no | Empresa a la que pertenece. → `empresas.id` |
| `contacto_id` | entero | no | Contacto al que pertenece. → `contactos.id` |
| `prospecto_id` | entero | no | Prospecto relacionado. → `prospectos.id` |
| `respuesta_id` | entero | no | Respuesta que originó una tarea de clasificación; vacío en las demás. → `respuestas.id` |
| `execution_id` | texto (máx. 100) | no | Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia). |
| `fecha_limite` | fecha y hora (UTC) | no | Para cuándo. Vencida si pasó y sigue abierta. |
| `alertado_en` | fecha y hora (UTC) | no | Cuándo se avisó que estaba vencida. |
| `clasificacion` | texto (máx. 60) | no | Clasificación elegida al cerrar una tarea de clasificación. |
| `resultado` | texto largo | no | Qué pasó al cerrarla. |
| `cerrada_en` | fecha y hora (UTC) | no | Cuándo se cerró. |
| `creada_por` | entero | no | Quién la creó. Vacío = la automatización (n8n). → `usuarios.id` |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |
| `documento_id` | entero | no | Documento rechazado de una tarea «Corregir documento»; vacío en las demás. |

#### `uso_ia`

Cada uso de la IA desde el CRM (borradores de respuesta y resúmenes de ficha), para límites diarios y trazabilidad.

- **Fuente:** CRM (pantallas, con sesión).
- **Actualización:** Solo se inserta.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `usuario_id` | entero | sí | Usuario relacionado. → `usuarios.id` |
| `tipo` | texto (máx. 40) | sí | borrador_respuesta (etapa 3) o resumen_ficha (etapa 4). |
| `respuesta_id` | entero | no | Respuesta relacionada. |
| `empresa_id` | entero | no | De qué empresa es el resumen de la ficha. → `empresas.id` |
| `resultado` | texto largo | no | Lo que regresó la IA (JSON), para mostrar el último resumen. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

### Reportes

#### `metricas_comerciales_diarias`

Foto diaria de las métricas comerciales (pipeline, ganado, perdido) para las gráficas históricas.

- **Fuente:** La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Un trabajo diario inserta o recalcula la fila del día.
- **Identificador:** `fecha`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `fecha` | fecha (AAAA-MM-DD) | sí | Día de la foto (clave). |
| `oportunidades_abiertas` | entero | sí | Oportunidades abiertas ese día. |
| `valor_pipeline` | número decimal (2 decimales) | sí | Valor de las oportunidades abiertas, en MXN. |
| `oportunidades_ganadas` | entero | sí | Ganadas ese día. |
| `ingresos_cerrados` | número decimal (2 decimales) | sí | Valor ganado ese día, en MXN. |
| `oportunidades_perdidas` | entero | sí | Perdidas ese día. |
| `valor_perdido` | número decimal (2 decimales) | sí | Valor perdido ese día, en MXN. |
| `calculado_en` | fecha y hora (UTC) | sí | Cuándo se calculó la fila. |

### Catálogos

#### `catalogo_etapa_embudo`

Etapas del embudo de ventas con su probabilidad y orden.

- **Fuente:** Migración (valores iniciales).
- **Actualización:** Fijo; cambia solo por migración.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `clave`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `clave` | texto (máx. 40) | sí | Clave fija que usa el código. |
| `nombre` | texto (máx. 80) | sí | Nombre. |
| `probabilidad` | entero | sí | Probabilidad de cierre, en porcentaje. |
| `orden` | entero | sí | Orden en que se muestra. |
| `es_cierre` | sí/no (1/0) | sí | La etapa cierra la oportunidad (ganada o perdida). Por omisión: `0`. |
| `es_ganada` | sí/no (1/0) | sí | La etapa es «ganada». Por omisión: `0`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `catalogo_motivo_perdida`

Motivos por los que se pierde una oportunidad.

- **Fuente:** Migración (valores iniciales).
- **Actualización:** Fijo; cambia solo por migración.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `clave`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `clave` | texto (máx. 40) | sí | Clave fija que usa el código. |
| `nombre` | texto (máx. 120) | sí | Nombre. |
| `requiere_explicacion` | sí/no (1/0) | sí | Pide escribir la explicación al elegirlo. Por omisión: `0`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

### Usuarios y seguridad

#### `auditoria`

Registro de cambios: quién cambió qué, con el antes y el después (JSON). Es la bitácora de cambios del maestro.

- **Fuente:** La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Solo se inserta; no se edita ni se borra.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `usuario_id` | entero | no | Usuario relacionado. → `usuarios.id` |
| `entidad` | texto (máx. 80) | sí | Qué tipo de registro cambió (empresa, prospecto…). |
| `entidad_id` | entero | sí | Identificador de ese registro. |
| `accion` | texto (máx. 80) | sí | Qué se hizo (crear, editar, cambiar estado…). |
| `antes` | JSON | no | Valores antes del cambio (JSON). |
| `despues` | JSON | no | Valores después del cambio (JSON). |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `login_fallos`

Intentos fallidos de entrar por correo, para bloquear 15 minutos tras 10 fallos.

- **Fuente:** La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Se limpia sola con un trabajo programado.
- **Identificador:** `correo`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `correo` | texto (máx. 254) | sí | Correo con el que se intentó entrar (clave). |
| `fallos` | entero | sí | Intentos fallidos dentro de la ventana de 15 minutos. Por omisión: `0`. |
| `ventana_inicio` | fecha y hora (UTC) | sí | Inicio de la ventana de 15 minutos en que se cuentan los fallos. |
| `bloqueado_hasta` | fecha y hora (UTC) | no | Hasta cuándo está bloqueado ese correo (15 minutos tras 10 fallos). |

#### `roles`

Roles: administrador, supervisor y agente (vendedor).

- **Fuente:** Migración (valores iniciales).
- **Actualización:** Fijo.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `clave`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `clave` | texto (máx. 30) | sí | Clave fija que usa el código. |
| `nombre` | texto (máx. 100) | sí | Nombre. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `sesiones`

Sesiones abiertas. Se guarda el hash del token, nunca el token.

- **Fuente:** La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Se crean al entrar y se borran al salir, al expirar (12 h) o al desactivar al usuario.
- **Identificador:** `id`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | texto fijo (64) | sí | Hash SHA-256 del token de sesión (nunca el token). |
| `usuario_id` | entero | sí | Usuario relacionado. → `usuarios.id` |
| `expira_en` | fecha y hora (UTC) | sí | Cuándo vence (12 horas). |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |

#### `usuarios`

Personas que usan el CRM y su rol.

- **Fuente:** CRM (pantallas, con sesión); Migración (valores iniciales).
- **Actualización:** Solo administración los crea, edita o desactiva.
- **Identificador:** `id`.
- **Únicos (no se pueden repetir):** `correo`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `id` | entero | auto | Identificador interno, autonumérico. |
| `rol_id` | entero | sí | → `roles.id` |
| `nombre` | texto (máx. 160) | sí | Nombre. |
| `correo` | texto (máx. 254) | sí | Correo para entrar. Único. |
| `password_hash` | texto (máx. 255) | sí | Contraseña cifrada con Argon2id. Nunca se guarda la contraseña. |
| `activo` | sí/no (1/0) | sí | 1 = vigente; 0 = desactivado (se oculta, no se borra). Por omisión: `1`. |
| `creado_en` | fecha y hora (UTC) | sí | Cuándo se creó el registro. |
| `actualizado_en` | fecha y hora (UTC) | sí | Última modificación. |
| `ultimo_acceso_en` | fecha y hora (UTC) | no | Última vez que usó el CRM. |
| `avisos_por_correo` | sí/no (1/0) | sí | Si recibe los avisos también por correo. Por omisión: `1`. |

### Sistema

#### `schema_migrations`

Qué migraciones ya se aplicaron a esta base.

- **Fuente:** La API sola (trabajos programados o efectos de otra acción).
- **Actualización:** Lo escribe npm run migrate.
- **Identificador:** `version`.

| Campo | Formato | Obligatorio | Descripción |
|---|---|---|---|
| `version` | texto (máx. 255) | sí | Archivo de migración aplicado (clave). |
| `applied_at` | fecha y hora (UTC) | sí | Cuándo se aplicó. |


## 10. Campos sin descripción

Ninguno: todas las tablas y campos tienen descripción.

## 11. Cómo volver a generarlo

Después de cada migración nueva:

```bash
npm run migrate                         # contra una base local (no producción)
DICCIONARIO_DB_URL="mysql://root:<contraseña>@127.0.0.1:33306/<base>" node docs/documentacion/generar-diccionario.mjs
```

El script lee la estructura de esa base y los comentarios de `src/database/schema.ts`. Las descripciones de negocio y las reglas
de este documento están en `generar-diccionario.mjs` y en `diccionario.plantilla.md`: si un campo nuevo sale con ⚠, se agrega ahí.
