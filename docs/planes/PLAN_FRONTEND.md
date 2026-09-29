# Plan de frontend del CRM

## 0. Bloqueo de recursos — léase antes que todo lo demás

El programa integrado de 16 semanas reparte cuatro pasantes en dos células: M1/M2 (tratamiento de agua) y T1/T2 (outbound). A T1 le tocó datos/backend y a T2 automatización/backend — **a nadie le tocó frontend**. Este documento no resuelve eso; solo dice qué habría que construir una vez que Dirección decida quién lo hace (¿T1/T2 le dedican una fracción de su tiempo? ¿se solicita un quinto recurso?). Sin esa decisión, las fases de la sección 6 no tienen fecha real.

Aun así, la construcción ya arrancó (carpeta `frontend/` del repositorio, desde el 24-sep-2026). El avance por fase está en §6.

## 1. Lo que pidió el jefe, mapeado contra el backend real

El correo pide cinco cosas. Las cinco ya tienen soporte en el backend — no hay que construir API nueva para la mayoría, solo la interfaz:

| Lo que pidió el jefe | Dónde ya vive en el backend | Nota |
| --- | --- | --- |
| 1. Info de empresa y región demográfica (nombre, empresa, medios de contacto, puestos, redes sociales) | `GET/POST /api/v1/empresas`, `GET /:id` (trae contactos + medios de contacto anidados), `POST/PATCH/DELETE /:id/contactos/:contactoId`, además de `GET/POST /api/v1/contactos` y `GET/PATCH/DELETE /:id` (vista plana, sin pasar por la empresa — ver README) | "Redes sociales" ✅ resuelto (22-sep-2026, migración `021_redes_sociales.sql`): `empresas` y `contactos` ahora tienen `facebook_url`/`instagram_url` además de `linkedin_url`/`sitio_web` (`facebookUrl`/`instagramUrl` en los payloads de alta/edición) — ver pregunta abierta §2 resuelta abajo. |
| 2. Historial de interacciones (correo/WhatsApp/llamada, documentos enviados, comentarios, confirmación de revisión, negativas) | `GET/POST /api/v1/actividades` — **ya es una línea de tiempo unificada**: mezcla llamadas/WhatsApp/comentarios capturados a mano con correos y respuestas automáticas (`envios`/`respuestas`) que vienen de n8n, tareas cerradas y cambios de estado del prospecto. Documentos y su revisión viven en `/api/v1/documentos` (`revisado_por`/`revisado_en`). | Para el correo del jefe no hace falta backend nuevo. Diferencia con `PLAN_CRM_DEFINITIVO.md` #4: ese plan pone en la línea de tiempo también los documentos enviados y sus confirmaciones de revisión, y el endpoint hoy no los incluye. Mientras tanto se ven en la pestaña Documentos de la ficha. Las negativas sí aparecen: la clasificación de cada respuesta (`no_interesado`, `baja`, etc.), las tareas de clasificación cerradas y, desde el 25-sep-2026, el cambio de estado del prospecto que deja cada clasificación. |
| 3. Gestión de ventas (etapa del embudo, negociación, cierre) | `GET/POST /api/v1/oportunidades`, `PATCH /:id/etapa`, `PATCH /:id/reabrir`, `GET /oportunidades/catalogos` (etapas y motivos de pérdida, ya en tabla, no hardcodeados) | Etapas actuales: calificada → descubrimiento → propuesta → negociación → verbalmente ganada → ganada / perdida. |
| 4. Cotizaciones (montos estimados, presupuestos enviados, previstos a cierre) | `GET/POST /api/v1/cotizaciones`, `GET /:id`, `POST /:id/version`, `PATCH /:id/estado` | Cada edición crea una versión nueva; nunca se edita en sitio. |
| 5. Desempeño del CRM (actividades y ventas por agente, proyecciones de ingreso) | `GET /api/v1/reportes/{actividades, tareas, pipeline/resumen, pipeline/conversion-etapas, forecast, metricas-diarias, desempeno-por-agente}` (todos filtrables por agente y rango de fechas) | Solo `administrador`/`supervisor` — un agente ya ve lo suyo filtrado directo en `/oportunidades`, `/tareas`, `/cotizaciones`. La tabla "Desempeño por agente" de la sección 5 (pantallas) usa `/desempeno-por-agente` ✅ (22-sep-2026): antes de este endpoint, armarla exigía llamar `/tareas` y `/pipeline/resumen` una vez POR AGENTE (ninguno acepta una lista de `responsableId`) y unir todo a mano en el cliente — hallazgo de la persona a cargo de este frontend al intentar construir esa pantalla. Ahora es una sola llamada que ya trae, por cada agente activo, actividades + tareas cerradas/vencidas + oportunidades ganadas/ingresos. |

El "sistema de control de información documentada como reportes de cada cliente" que el jefe menciona sin estar seguro — **sí se puede, y no necesita backend nuevo**: es una pantalla de "ficha de cliente" que combina `GET /empresas/:id` + `/actividades?empresaId=` + `/oportunidades?empresaId=` + `/cotizaciones?empresaId=` + `/documentos?empresaId=` en una sola vista. Ver §5, "Ficha de cliente". (`/oportunidades` no aceptaba `empresaId`; se agregó el 25-sep-2026 al construir esa pestaña. En `/cotizaciones` y `/documentos` el parámetro es obligatorio.) Es lo mismo que `CRM_09_CIERRE_ALCANCE_COMERCIAL.md` llama "Vista de cuenta 360".

## 2. Preguntas abiertas antes de construir

Un punto del correo del jefe sigue siendo ambiguo de una forma que vale la pena aclarar con él antes de construir algo que no sea lo que imagina, en vez de adivinar:

1. ~~**"Redes sociales" (plural)**~~ — resuelto (22-sep-2026): se agregaron `facebook_url`/`instagram_url` a `empresas` y `contactos` (migración `021_redes_sociales.sql`), junto a `linkedin_url`/`sitio_web` que ya existían. Las tres son campos de URL (`http`/`https` únicamente — antes se aceptaba cualquier esquema, incluido `javascript:`, corregido de paso al mismo tiempo, ver `src/shared/http-url.ts`), no un catálogo cerrado de redes: si el jefe pide otra red (X, TikTok) es agregar otra columna, no tocar un ENUM. **No se agregó X/TikTok todavía** — no se pidieron, y agregar columnas "por si acaso" no está en el criterio de este proyecto (ver el resto de la documentación: se construye lo que se pidió, no lo que se anticipa).
2. **"Proyecciones de ingreso conforme a los cierres con los mismos clientes"** — esto suena a negocio repetido/expansión con clientes que **ya cerraron** antes, que es distinto de lo que ya existe (`/reportes/forecast`, que proyecta el pipeline **abierto**, no negocio futuro con cuentas ya ganadas). Si es lo segundo, es una vista nueva (agrupar oportunidades ganadas por empresa a lo largo del tiempo) que no está en ningún plan todavía. Vale la pena confirmar antes de construir el forecast agregado como si fuera suficiente.

## 3. Stack técnico

El backend expone JSON por HTTP con sesión por cookie (`credentials: true` en CORS, ya configurado — falta agregar la URL del frontend a `CORS_ORIGINS` cuando se despliegue). Stack elegido, y el que ya usa `frontend/`:

- **React 19 + TypeScript + Vite** — el ecosistema con más documentación para un equipo que aprende sobre la marcha, y la habilidad más transferible a un CV.
- **TanStack Query (React Query)** para leer/escribir contra la API — este backend es, en esencia, listas + detalle + formularios sobre ~15 recursos; React Query evita reescribir el mismo `loading`/`error`/`cache` en cada pantalla.
- **React Router 7** para la navegación entre módulos.
- **Tailwind CSS 4** con componentes propios en `frontend/src/components/ui/` (se planteó shadcn/ui; con los pocos componentes que hacen falta, alcanzó con escribirlos a mano sobre el estilo de los mockups).
- **React Hook Form + Zod** para formularios (instalados, todavía sin pantallas de alta/edición) — el backend ya valida todo con Zod; los mismos esquemas (o una copia deliberada, ya que front y back son proyectos separados) pueden reusarse para validar en el cliente antes de mandar la petición.
- **Despliegue (propuesta, todavía no está en `RUNBOOK_DEPLOY.md`)**: sitio estático (build de Vite) en Firebase Hosting — mismo proyecto de GCP donde ya vive la API (`crm-prospeccion-outbound`), sin infraestructura nueva que aprender. Las cookies de sesión entre orígenes distintos siguen la regla de `PLAN_API_DEFINITIVO.md` (CORS restringido al origen del frontend, `SameSite=Lax` o `None` + `Secure`).

## 4. Autenticación y roles en el frontend

- Login contra `POST /api/v1/auth/login` — la cookie de sesión la pone el navegador solo; el frontend no maneja ningún token a mano.
- `GET /api/v1/auth/me` al cargar la app, para saber quién es el usuario y su rol (`administrador` / `supervisor` / `agente`) — de ahí sale qué navegación y qué acciones mostrar.
- El backend ya aplica los permisos reales (un agente no puede ver empresas ajenas aunque el frontend se lo permitiera); el rol en el cliente es para **UX** (ocultar botones que van a fallar con 403/404), no la fuente de verdad de seguridad.
- Qué ve cada rol, según los `@Roles` del backend: el **agente** ve sus empresas y lo que tiene asignado (tareas, oportunidades); **administrador y supervisor** además ven reportes, auditoría y la lista de usuarios, y son los únicos que ven la cola de clasificación y clasifican (un agente recibe 403); solo el **administrador** da de alta/edita usuarios y ve eventos pendientes y procesos fallidos.

## 5. Arquitectura de información (pantallas)

```
Login
│
├─ Inicio (dashboard)
│   ├─ Agente: mis tareas pendientes
│   └─ Admin/Supervisor: resumen de pipeline, forecast, actividad por
│       agente, cola de clasificación (solo ellos clasifican desde el
│       24-sep-2026 — ver README del backend, "Quién clasifica")
│
├─ Empresas (clientes)
│   ├─ Lista (hoy solo paginada: GET /empresas no acepta filtros; los de
│   │   región, giro y tamaño necesitan agregarse al backend primero)
│   ├─ Alta / edición
│   └─ Ficha de cliente (detalle) ── responde al punto #1 y al "reporte por
│       cliente" del jefe (§1) ── pestañas:
│         ├─ Información y contactos (medios de contacto, puestos,
│         │   sitio web, LinkedIn, Facebook, Instagram — §2 punto 1)
│         ├─ Historial (línea de tiempo unificada — punto #2)
│         ├─ Oportunidades de esta empresa — punto #3
│         ├─ Cotizaciones de esta empresa — punto #4
│         └─ Documentos de esta empresa
│
├─ Prospectos
│   ├─ Lista + detalle
│   └─ Importación CSV (subir archivo, elegir entre lotes anteriores,
│       revisar lote fila por fila, confirmar / rechazar,
│       confirmar-todos) — el flujo ya estaba construido y probado con
│       datos reales de STEELSAFE; la lista de lotes
│       (GET /prospectos/importaciones) se agregó con la pantalla
│
├─ Tareas
│   ├─ Bandeja (filtros: estado, prioridad, tipo; responsable para
│   │   admin/supervisor) — el SLA de PLAN_CRM #5 se muestra marcando
│   │   las tareas con fecha límite vencida (no hay filtro de SLA).
│   │   Una tarea de tipo "clasificacion" no lleva botón "Cerrar":
│   │   PATCH /tareas/:id/cerrar la rechaza (409); solo se resuelve
│   │   clasificándola desde la cola
│   └─ Cola de clasificación (solo admin/supervisor): interesado,
│       no interesado, baja, inválido, reagendar (este último pide
│       fecha de seguimiento futura)
│
├─ Oportunidades ── punto #3
│   └─ Vista por etapa (kanban o lista agrupada) + detalle con cambio de
│       etapa / reapertura — perder exige motivo del catálogo (y
│       explicación si es "otro"); solo una perdida se reabre
│
├─ Cotizaciones ── punto #4
│   └─ Por empresa (GET /cotizaciones exige empresaId): lista + detalle +
│       nueva versión + cambio de estado (borrador → enviada → aceptada /
│       rechazada / vencida; la versión anterior queda obsoleta)
│
├─ Documentos
│   └─ Por empresa (GET /documentos exige empresaId): subir (PDF, DOCX,
│       XLSX, PNG, JPG; máx. 25 MB — PLAN_CRM #8), tipo del catálogo,
│       nueva versión, marcar revisado, archivar, descargar
│
├─ Reportes (solo admin/supervisor) ── punto #5
│   └─ Actividades y ventas por agente, pipeline, conversión por etapa,
│       forecast, histórico de métricas diarias, exportar CSV
│
└─ Administración (admin/supervisor; cada parte con su propio permiso)
    ├─ Usuarios (admin/supervisor consultan; solo admin da de alta,
    │   edita y desactiva)
    ├─ Auditoría (consulta; admin/supervisor)
    └─ Monitoreo de integración (solo admin): eventos pendientes con
        "reintentar" (PLAN_CRM #5) y procesos fallidos con cambio de
        estado abierto → en revisión → resuelto (PLAN_N8N B4). Sirve
        para saber si n8n está recibiendo lo que el CRM le manda
```

## 6. Fases de construcción

Sin fechas fijas (ver §0). Orden sugerido por dependencia, no por semana:

1. **Fundacional**: login/sesión, layout y navegación por rol, lista + ficha de cliente básica (info y contactos). Sienta las bases para todo lo demás y ya cubre el punto #1 completo.
2. **Historial y ventas**: línea de tiempo (punto #2) y oportunidades/embudo (punto #3) dentro de la ficha de cliente.
3. **Cotizaciones y documentos**: punto #4, más el módulo de documentos.
4. **Prospectos**: pantalla de importación CSV — el backend ya está probado, así que es la fase con menos riesgo técnico una vez que exista el resto de la app (necesita la ficha de cliente para poder ver a qué se convirtió un prospecto confirmado).
5. **Desempeño**: reportes y dashboards (punto #5) — tiene más sentido una vez que haya datos reales cargados (empresas, oportunidades, cotizaciones) para mostrar, no antes.
6. **Administración**: usuarios, auditoría, monitoreo de outbox — uso interno del equipo, no cara al cliente ni al jefe; puede ir al final sin bloquear nada de lo anterior.

Avance:

- **Fase 1 ✅ (24-sep-2026):** login, layout con navegación por rol, lista de empresas y ficha con "Información y contactos". El inicio muestra el resumen de pipeline (admin/supervisor) o la bandeja propia (agente).
- **Fase 2 construida (28-sep-2026), falta probarla en navegador contra datos reales:** pestañas Historial y Oportunidades de la ficha. Desde el Historial se registra una llamada, WhatsApp o comentario (`POST /actividades`). En Oportunidades se crea una nueva (`POST /oportunidades`) y, al abrir una, se ve su historial de etapas, se cambia de etapa (perder pide motivo) y se reabre si está perdida.
- **Fase 3 construida (28-sep-2026), falta probarla en navegador contra datos reales:** pestañas Cotizaciones y Documentos de la ficha. Cotizaciones: lista de la versión vigente de cada una, alta con partidas contra una oportunidad abierta, detalle con partidas, totales y versiones, nueva versión (parte de la vigente) y cambio de estado según las transiciones del backend. Documentos: subir (tipo, oportunidad y contacto opcionales), descargar con la URL firmada, marcar revisado, archivar/reactivar, nueva versión y eliminar (solo admin/supervisor). Las pantallas generales de Cotizaciones y Documentos del menú siguen sin construir: como ambos listados exigen `empresaId`, hoy se trabajan desde la ficha.
- **Fase 4 ✅ (29-sep-2026):** pantalla Prospectos con dos pestañas. "Importaciones" sigue el mockup: la última importación (o cualquier anterior, con un selector), contadores por estado, revisión fila por fila (confirmar, rechazar; una duplicada contra un contacto existente se confirma solo con "Usar contacto existente"), "Confirmar todas las pendientes" y una plantilla CSV descargable con las columnas que espera el backend. "Prospectos" lista los ya confirmados, con búsqueda y prioridad; al abrir uno se ve su detalle (`GET /prospectos/:id`: estado, prioridad, confianza, score, campaña, fuente y los medios del contacto, marcando los `no_contactar`) con liga a la ficha de la empresa. Para esto se agregó al backend `GET /prospectos/importaciones` (lista de lotes): sin él no había forma de volver a un lote después de importarlo. Probada el 28-sep-2026 con CSV reales en la base de desarrollo (confirmar, rechazar, duplicada por teléfono contra un contacto existente, duplicada dentro del mismo archivo, fila sin correo ni teléfono). De esa prueba salió un ajuste al backend: los catálogos del CSV (`empresaTamano`, `canalInicial`, `confianza`, `prioridad`) ya aceptan mayúsculas y acentos ("MICRO", "Pequeña", "Teléfono"), y los errores de validación de cada fila salen en español con los valores permitidos, en vez de "Invalid option: expected one of…".
- **Fase 5 construida (29-sep-2026), falta probarla en navegador con los datos de desarrollo:** pantalla Reportes (solo admin/supervisor) con filtros de periodo (este mes, mes anterior, últimos 90 días, este año, todo, personalizado) y agente (`GET /usuarios?rol=agente`). Muestra indicadores (pipeline abierto, ingresos cerrados, perdido, tareas cerradas/vencidas), la tabla "Desempeño por agente" con totales, conversión por etapa (barras), forecast mensual (columnas estimado vs. ponderado, con tabla y marca de meses atrasados), tareas por tipo e histórico diario con "Recalcular hoy". Cada reporte exporta su CSV (`GET /reportes/export/:reporte` con los mismos filtros). Dos criterios: lo que es foto del momento (pipeline abierto, tareas vencidas) se rotula como "hoy", y el forecast no usa el periodo (proyecta el pipeline abierto, no el pasado), solo el agente. El Inicio de admin/supervisor suma el forecast de los próximos meses y la actividad por agente del mes. La cola de clasificación del Inicio llega con la pantalla de Tareas. Se probó el render con datos sembrados en una base desechable (3 agentes, 12 oportunidades, actividades y tareas), incluidos el filtro por agente y la descarga del CSV desde el botón (con BOM, para que Excel respete los acentos). De paso se corrigió el gradiente de marca (`--grad`) en el menú lateral, la barra superior, el avatar y la barrita de los títulos de sección: la clase `bg-[var(--grad)]` generaba un `background-color` inválido y no se veía en ninguna pantalla; ahora es `bg-[image:var(--grad)]`.
- **Tareas construida (29-sep-2026)**, adelantada a la fase 6 porque sin ella nadie podía clasificar desde la interfaz. La bandeja es "Mis tareas" para un agente (el backend ya la filtra a las suyas). Tiene filtros de estado, prioridad y tipo, más responsable para admin/supervisor. Marca las vencidas en rojo y permite crear una tarea (seguimiento, revisión de documento u otro, con responsable si eres admin/supervisor) y cerrarla con su resultado. Una de clasificación no se cierra aquí: lleva a la cola. La cola de clasificación (solo admin/supervisor, `?tab=cola`) muestra por tarjeta la empresa, el contacto, el texto de la respuesta y la sugerencia de n8n. Tiene las cinco clasificaciones con su explicación: "baja" advierte que suprime todos los medios y "reagendar" pide una fecha futura. El Inicio de admin/supervisor muestra cuántas respuestas esperan en la cola. Para esto, `GET /cola-clasificacion` ahora trae empresa, contacto y respuesta (antes devolvía la tarea sola, sin nada que leer para decidir) y `GET /tareas` trae `empresa_nombre`, ambos aditivos. Probado con datos sembrados: se clasificó una respuesta como "reagendar" desde la pantalla (tarea cerrada, seguimiento creado en la fecha elegida) y se revisó la vista de agente. Las tareas que crea n8n llegan sin responsable ("Sin asignar") y ningún agente las veía. Para eso se agregó `PATCH /tareas/:id/asignar` (solo admin/supervisor; a un usuario activo que no sea la cuenta "sistema"; solo tareas abiertas; queda en auditoría) con su selector en el detalle de la tarea.
- **Fase 6 construida (29-sep-2026):** pantalla Administración con tres pestañas, cada una con el permiso de su controller:
  - **Usuarios** (admin y supervisor consultan): filtros por rol y estado. Solo el administrador da de alta, edita (nombre, correo, rol, nueva contraseña) y desactiva, con confirmación. El 409 de "último administrador activo" se muestra tal cual. No se ofrece desactivarse a uno mismo ni editar la cuenta "sistema". **Límite del backend:** no hay endpoint para reactivar un usuario desactivado.
  - **Auditoría** (admin y supervisor): filtros por entidad, acción, usuario y rango de fechas. Cada fila resume el cambio ("estado: abierto → resuelto") y al abrirla muestra el antes y el después completos. Las acciones sin usuario se rotulan "Automatización". La lista de acciones del filtro está escrita a mano: si el backend agrega una nueva, hay que sumarla en `AuditoriaAdmin.tsx`.
  - **Integración con n8n** (solo administrador): eventos hacia n8n (por defecto los fallidos) con "Reintentar" y "Despachar ahora", y procesos fallidos (por defecto los abiertos) con su triage abierto → en revisión → resuelto y el payload al abrirlos.

  Se probó en navegador con datos sembrados: reintentar un evento, cambiar el estado de un proceso, crear un supervisor, el rechazo al quitarle el rol al único administrador y la vista del supervisor (sin Integración ni edición).
- **Oportunidades y Contactos del menú (29-sep-2026):**
  - **Oportunidades:** tablero del embudo con una columna por etapa abierta (conteo, monto y probabilidad), búsqueda por oportunidad o empresa y filtro por responsable (admin/supervisor). Las fechas de cierre ya pasadas salen en rojo. Al abrir una tarjeta se usa el mismo panel de detalle de la ficha (cambio de etapa, pérdida con motivo, reapertura). Otra pestaña lista las ganadas y perdidas. Para esto `GET /oportunidades` ahora trae `empresa_nombre` (aditivo). Las oportunidades nuevas se siguen creando desde la ficha, porque cuelgan de una empresa y sus contactos.
  - **Contactos:** vista plana de `GET /contactos` con búsqueda por nombre, empresa (liga a la ficha), medios (los suprimidos en rojo) y redes.

  Se probó en navegador mover una oportunidad de Propuesta a Negociación desde el tablero.
- Pendiente: las pantallas generales de Cotizaciones y Documentos siguen como placeholder; se trabajan desde la ficha de cada empresa porque ambos listados exigen `empresaId`.

Relación con las fases de `PLAN_CRM_DEFINITIVO.md`: aquellas son las del backend y ya están construidas; estas son solo las de la interfaz.

## 7. Fuera de alcance de este plan

- **n8n**: la interfaz no reemplaza ni necesita saber cómo funciona la automatización — consume sus resultados (prospectos clasificados, respuestas) ya guardados en el backend. En particular, el frontend **no registra supresiones**: desde el 24-sep-2026 la API las crea sola cuando una respuesta se clasifica `baja`, sea por n8n o desde la cola de clasificación (`PLAN_N8N_DEFINITIVO.md` B2). La ficha solo muestra el resultado: el medio de contacto aparece como `no_contactar`.
- **Diseño visual de marca** (colores, logotipo, tono): no definido en ningún documento del proyecto; se necesita antes de la fase 1 o se avanza con un estilo neutro de placeholder.
- Todo lo que el backend mismo marca como pendiente en su README ("Qué falta") — no bloquea el frontend, pero conviene que quien lo construya lo sepa: el envío real de correos (n8n ya usa los endpoints reales de `/automatizacion`, verificado 21–23-sep-2026 según `PLAN_N8N_DEFINITIVO.md` B1, pero el envío sigue en MOCK hasta conectar SendGrid; mientras tanto no habrá correos enviados reales en el Historial), el driver de GCS sin probar contra un bucket real (el frontend no lo nota, usa la misma `GET /:id/descarga` con cualquier driver), y la superficie de `/automatizacion/*` (los 18 endpoints que consume n8n, no el frontend) con cobertura de pruebas todavía parcial.
