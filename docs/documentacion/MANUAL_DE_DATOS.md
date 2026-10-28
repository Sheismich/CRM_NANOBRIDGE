# Manual de datos · CRM NANOBRIDGE

**Entregable:** manual de datos (T1, paquete final OB-07). **Para:** quien cargue, revise y mantenga los datos del CRM
(supervisor o el responsable de datos que siga). **Versión:** 1.0 · 28 de octubre de 2026.

Este manual explica el trabajo con los datos en el día a día. El detalle de cada campo está en el
[diccionario](DICCIONARIO_DE_DATOS.md); las reglas que protegen la base, en el [reporte de controles](REPORTE_DE_CONTROLES.md),
y la revisión periódica, en el [procedimiento de auditoría](PROCEDIMIENTO_AUDITORIA.md).

## 1. Cómo está organizada la información

- **Empresa:** el cliente o prospecto como negocio. Tiene giro, tamaño, ubicación y un **responsable** (vendedor).
- **Contacto:** una persona dentro de una empresa. Siempre pertenece a una empresa.
- **Medio de contacto:** el correo, teléfono o WhatsApp de una persona. Cada uno es **único en todo el CRM**: el mismo correo no
  puede ser de dos personas.
- **Prospecto:** una persona dentro del proceso de prospección. Una misma persona puede tener varios a lo largo del
  tiempo (cada 6 meses puede empezar un ciclo nuevo).
- **Oportunidad, cotización, documento y tarea** cuelgan de la empresa.

Quién ve qué: un **agente** solo ve las empresas de las que es responsable; **supervisor** y **administrador** ven todo.

## 2. Cargar prospectos con un archivo (importación CSV)

**Prospectos → Importaciones → Descargar plantilla.** La plantilla trae las columnas y una fila de ejemplo.

| Columna | ¿Obligatoria? | Notas |
|---|---|---|
| `empresaNombreLegal` | sí | 2-255 caracteres |
| `contactoNombre` | sí | 2-160 caracteres |
| `correo` / `telefono` | **al menos uno** | sin al menos uno no se puede saber si la persona ya existe |
| `canalInicial` | sí | `correo`, `telefono` o `whatsapp`; debe venir su medio en la misma fila |
| `empresaGiro`, `empresaTamano` | recomendadas | **sin giro y tamaño la automatización no le escribe**; tamaño: micro, pequeña, mediana o grande |
| `empresaRegion`, `empresaEstado`, `empresaCiudad`, `empresaPais` | no | país en 2 letras (MX por omisión) |
| `empresaSitioWeb`, `fuenteUrl` | no | deben empezar con `http://` o `https://` |
| `contactoPuesto`, `confianza`, `prioridad`, `score`, `observaciones`, `campanaId` | no | `score` de 0 a 100 |

- Se puede guardar desde Excel tal cual (con o sin acentos; da igual mayúsculas en tamaño, canal, confianza y prioridad).
- Límites: 2,000 filas, 40 columnas y 2 MB por archivo. Una columna con otro nombre se rechaza y el CRM dice cuáles acepta.
- **Importar no manda correos ni crea nada todavía.** Cada fila queda «por revisar».

### Revisar el lote

Cada fila sale con su estado:

| Estado | Qué hacer |
|---|---|
| **Por revisar** | Confirmar (entra al CRM) o rechazar. «Confirmar todas las pendientes» las confirma de una vez. |
| **Duplicada** contra alguien que ya está en el CRM | La persona ya existe (mismo correo, o mismo teléfono si no trae correo). Confirmar **usando el contacto existente** (se le crea un prospecto nuevo, sin repetir a la persona) o rechazar. |
| **Duplicada** contra otra fila del mismo archivo | Primero resolver la otra fila; esta solo se puede rechazar. |
| **Con errores** | El motivo sale en español. Corregir el archivo y volver a importarlo, o rechazar la fila. |

Las filas que nadie confirma **expiran a los 30 días**. Después de cargar una lista, correr la auditoría
(procedimiento §1) antes de mandarla a automatización.

**Ojo con las empresas:** el CRM reconoce a la **persona** repetida, pero no a la **empresa** repetida por nombre. Si en
el archivo vienen dos personas de la misma empresa escrita igual, se crea una empresa por cada una, salvo que
compartan teléfono. Para agregar gente a una empresa que ya existe, usar «+ Nuevo prospecto → Ya existe en el CRM».

## 3. Alta de uno en uno

- **Prospecto nuevo:** Prospectos → «+ Nuevo prospecto». «Empresa nueva» o «Ya existe en el CRM» (busca la empresa y le
  cuelga a la persona). Mismas reglas que el CSV.
- **Persona que ya es contacto de una empresa:** en la ficha de la empresa, botón «A prospección» del contacto.
- **Empresa o contacto sin prospección** (un cliente que llegó por otro lado): Empresas → «+ Nueva empresa», o en la
  ficha, «+ Agregar» contacto.

## 4. Corregir datos

- **Empresa:** ficha → «Editar» (nombre, giro, tamaño, ubicación, redes, responsable).
- **Contacto y sus medios:** ficha → contacto → «Editar». **Borrar el valor de un medio no lo elimina:** queda como
  «obsoleto» y sigue reservado a esa persona.
- **Un medio en «no contactar»** (la persona pidió su baja) se muestra pero **no se puede editar ni reactivar**.
- **Un contacto no se puede mover a otra empresa.** Si quedó en la equivocada, avisar al responsable técnico (ver §9).
- Todo cambio queda en **Administración → Registro de cambios**, con el antes y el después.

## 5. Desactivar, no borrar

Empresas, contactos y usuarios se **desactivan**: dejan de aparecer, pero su historial se conserva y sus correos y
teléfonos **siguen apartados**, así que no se pueden volver a capturar para otra persona. Por eso:

- Desactivar solo lo que de verdad ya no sirve (empresa cerrada, persona que ya no trabaja ahí).
- **No desactivar para «limpiar» un duplicado** sin antes revisar con el responsable técnico (procedimiento de auditoría §4).

## 6. Bajas y lista de supresión

- Una persona se da de baja sola con el enlace «Darte de baja» del pie de los correos, marcando el correo como spam, o
  si su correo rebota. También al clasificar su respuesta como «baja».
- Al darse de baja: sus medios pasan a «no contactar», entra a la **lista de supresión**, se cancelan sus seguimientos y
  su prospecto queda en «baja».
- **La lista de supresión manda sobre todo:** aunque alguien vuelva a capturar ese correo, nunca se le escribe.
- **Una baja no se revierte desde el CRM.** Si alguien pide volver a recibir correos, lo decide Dirección y lo hace el
  responsable técnico, dejando constancia.

## 7. Mandar a automatización

Solo administrador y supervisor: Prospectos → elegir con las casillas → «Mandar a automatización». Entran a la **fila**
y la automatización toma de 6 a 10 por día hábil.

No entran (y el CRM dice por qué): sin giro o tamaño, sin correo activo, en baja, empresa o contacto desactivados, o la
persona ya recibió 3 correos en los últimos 6 meses. A cada persona se le escriben como máximo 3 correos (el inicial y
dos recordatorios, con 5 días hábiles entre uno y otro), y nunca más de 20 al día en total al empezar.

## 8. Limpiar los datos de prueba (antes del piloto)

La [auditoría del 28-oct](auditorias/calidad-2026-10-28.md) §6 lista las empresas y los medios de prueba. Hay dos formas:

| | Desactivar desde el CRM | Borrar en la base |
|---|---|---|
| Quién | Supervisor o administrador | Responsable técnico (T2), con T1 |
| Cómo | Ficha → «Desactivar» en cada empresa de prueba | [`limpiar-datos-prueba.mjs`](limpiar-datos-prueba.mjs), con respaldo previo |
| Resultado | Dejan de verse; sus correos de prueba siguen apartados y su historial queda | Desaparecen del todo; los reportes y la auditoría quedan solo con datos reales |
| Se puede deshacer | Sí | Solo restaurando el respaldo (RUNBOOK §9) |

Para el piloto conviene **borrar en la base**, para que los reportes y los KPI midan solo datos reales. Hacerlo el día
del encendido (RUNBOOK §10), así:

1. Confirmar que hay respaldo del día (RUNBOOK §9).
2. Correr el script **sin** `--borrar`: lista las empresas que reconoce como de prueba y cuántas filas se borrarían de
   cada tabla. Revisar la lista con T2.
3. Correrlo con `--empresas=<ids>` y `--borrar` (más `LIMPIEZA_CONFIRMO=borrar-datos-de-prueba`). Si alguna empresa no
   parece de prueba, el script no borra nada; si algo falla a medias, deshace todo.
4. Correr la auditoría y comprobar que «Datos de prueba» quedó en cero. El registro de la limpieza queda en
   `auditorias/limpieza-<fecha>.md`.

El script no toca la lista de supresión (una baja nunca se pierde), la bitácora de auditoría, campañas, usuarios ni
catálogos. Los archivos de documentos de prueba que estén en Google Cloud Storage quedan en el bucket; se pueden borrar
aparte.

## 9. Respaldos y a quién acudir

- La base se respalda sola cada día a las 3:00 a.m. y **se puede recuperar a cualquier minuto de los últimos 7 días**.
  Si algo se borró por error, avisar de inmediato al responsable técnico: el procedimiento está en el RUNBOOK §9.
- Si el CRM no carga, llega un aviso por correo a los responsables (RUNBOOK §11).
- Responsable de datos: **T1**. Responsable técnico (automatización, n8n, despliegues): **T2**. Al terminar el
  proyecto, Dirección designa a quién pasan estos papeles.

## 10. Mantenimiento

| Qué | Cuándo | Cómo |
|---|---|---|
| Auditoría de calidad | Cada semana, después de cargar una lista y cada día del piloto | [Procedimiento](PROCEDIMIENTO_AUDITORIA.md) |
| Diccionario de datos | Después de cada cambio a la estructura de la base | `generar-diccionario.mjs` |
| Revisar filas importadas pendientes | Cada semana (expiran a los 30 días) | Prospectos → Importaciones |
| Revisar tareas «Sin asignar» y responsables de empresa | Cada semana | Tareas y Empresas → «Sin asignar» |
