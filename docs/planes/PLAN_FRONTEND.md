# Plan de frontend del CRM

Borrador para revisión de Dirección — a diferencia de los documentos `_DEFINITIVO`, este todavía no ha pasado por una decisión formal. Es el primer plan de frontend que existe en el proyecto: hasta el 18-sep-2026, ni `PLAN_CRM_DEFINITIVO.md` ni el programa integrado de 16 semanas asignan a nadie la construcción de una interfaz, y no existe ni una sola pantalla en el repositorio (`CRM_NANOBRIDGE`, 100% backend). Este plan parte de eso, del backend que sí existe hoy (29 tablas, ~30 endpoints), y del correo del jefe sobre qué información quiere ver en el CRM.

## 0. Bloqueo de recursos — léase antes que todo lo demás

El programa integrado de 16 semanas reparte cuatro pasantes en dos células: M1/M2 (tratamiento de agua) y T1/T2 (outbound). A T1 le tocó datos/backend y a T2 automatización/backend — **a nadie le tocó frontend**. Este documento no resuelve eso; solo dice qué habría que construir una vez que Dirección decida quién lo hace (¿T1/T2 le dedican una fracción de su tiempo? ¿se solicita un quinto recurso?). Sin esa decisión, las fases de la sección 7 no tienen fecha real.

## 1. Lo que pidió el jefe, mapeado contra el backend real

El correo pide cinco cosas. Las cinco ya tienen soporte en el backend — no hay que construir API nueva para la mayoría, solo la interfaz:

| Lo que pidió el jefe | Dónde ya vive en el backend | Nota |
| --- | --- | --- |
| 1. Info de empresa y región demográfica (nombre, empresa, medios de contacto, puestos, redes sociales) | `GET/POST /api/v1/empresas`, `GET /:id` (trae contactos + medios de contacto anidados), `POST/PATCH/DELETE /:id/contactos/:contactoId` | "Redes sociales" hoy solo cubre LinkedIn (`medios_contacto.tipo`) — ver pregunta abierta §3. |
| 2. Historial de interacciones (correo/WhatsApp/llamada, documentos enviados, comentarios, confirmación de revisión, negativas) | `GET/POST /api/v1/actividades` — **ya es una línea de tiempo unificada**: mezcla llamadas/WhatsApp/comentarios capturados a mano con correos y respuestas automáticas (`envios`/`respuestas`) que vienen de n8n. Documentos y su revisión viven en `/api/v1/documentos` (`revisado_por`/`revisado_en`). | Este es el módulo más completo de los cinco — no hace falta nada nuevo de backend. |
| 3. Gestión de ventas (etapa del embudo, negociación, cierre) | `GET/POST /api/v1/oportunidades`, `PATCH /:id/etapa`, `PATCH /:id/reabrir`, `GET /oportunidades/catalogos` (etapas y motivos de pérdida, ya en tabla, no hardcodeados) | Etapas actuales: calificada → descubrimiento → propuesta → negociación → verbalmente ganada → ganada / perdida. |
| 4. Cotizaciones (montos estimados, presupuestos enviados, previstos a cierre) | `GET/POST /api/v1/cotizaciones`, `GET /:id`, `POST /:id/version`, `PATCH /:id/estado` | Cada edición crea una versión nueva; nunca se edita en sitio. |
| 5. Desempeño del CRM (actividades y ventas por agente, proyecciones de ingreso) | `GET /api/v1/reportes/{actividades, tareas, pipeline/resumen, pipeline/conversion-etapas, forecast, metricas-diarias}` (todos filtrables por agente y rango de fechas) | Solo `administrador`/`supervisor` — un agente ya ve lo suyo filtrado directo en `/oportunidades`, `/tareas`, `/cotizaciones`. |

El "sistema de control de información documentada como reportes de cada cliente" que el jefe menciona sin estar seguro — **sí se puede, y no necesita backend nuevo**: es una pantalla de "ficha de cliente" que combina `GET /empresas/:id` + `/actividades?empresa_id=` + `/oportunidades?empresa_id=` + `/cotizaciones?empresa_id=` + `/documentos?empresa_id=` en una sola vista. Ver §5, "Ficha de cliente".

## 2. Preguntas abiertas antes de construir

Dos puntos del correo del jefe son ambiguos de una forma que vale la pena aclarar con él antes de construir algo que no sea lo que imagina, en vez de adivinar:

1. **"Redes sociales" (plural)** — el modelo de datos hoy solo distingue LinkedIn como red social (`medios_contacto.tipo`); no hay Instagram, Facebook, X, etc. Es un cambio menor (agregar valores al ENUM), pero hay que confirmar si de verdad los necesita o si LinkedIn es lo único relevante en un contexto B2B industrial.
2. **"Proyecciones de ingreso conforme a los cierres con los mismos clientes"** — esto suena a negocio repetido/expansión con clientes que **ya cerraron** antes, que es distinto de lo que ya existe (`/reportes/forecast`, que proyecta el pipeline **abierto**, no negocio futuro con cuentas ya ganadas). Si es lo segundo, es una vista nueva (agrupar oportunidades ganadas por empresa a lo largo del tiempo) que no está en ningún plan todavía. Vale la pena confirmar antes de construir el forecast agregado como si fuera suficiente.

## 3. Stack técnico recomendado

El backend expone JSON por HTTP con sesión por cookie (`credentials: true` en CORS, ya configurado — falta agregar la URL del frontend a `CORS_ORIGINS` cuando exista). Eso deja abierta la elección del framework; se recomienda:

- **React 18 + TypeScript + Vite** — el ecosistema con más documentación para un equipo que aprende sobre la marcha, y la habilidad más transferible a un CV.
- **TanStack Query (React Query)** para leer/escribir contra la API — este backend es, en esencia, listas + detalle + formularios sobre ~15 recursos; React Query evita reescribir el mismo `loading`/`error`/`cache` en cada pantalla.
- **React Router** para la navegación entre módulos.
- **Tailwind CSS + shadcn/ui** — componentes que se copian al proyecto (no una dependencia más que actualizar), suficientes para una interfaz de trabajo interna sin necesitar a alguien dedicado a diseño.
- **React Hook Form + Zod** para formularios — el backend ya valida todo con Zod; los mismos esquemas (o una copia deliberada, ya que front y back son proyectos separados) pueden reusarse para validar en el cliente antes de mandar la petición.
- **Despliegue**: sitio estático (build de Vite) en Firebase Hosting — mismo proyecto de GCP donde ya vive la API (`crm-prospeccion-outbound`), sin infraestructura nueva que aprender.

## 4. Autenticación y roles en el frontend

- Login contra `POST /api/v1/auth/login` — la cookie de sesión la pone el navegador solo; el frontend no maneja ningún token a mano.
- `GET /api/v1/auth/me` al cargar la app, para saber quién es el usuario y su rol (`administrador` / `supervisor` / `agente`) — de ahí sale qué navegación y qué acciones mostrar.
- El backend ya aplica los permisos reales (un agente no puede ver empresas ajenas aunque el frontend se lo permitiera); el rol en el cliente es para **UX** (ocultar botones que van a fallar con 403/404), no la fuente de verdad de seguridad.

## 5. Arquitectura de información (pantallas)

```
Login
│
├─ Inicio (dashboard)
│   ├─ Agente: mis tareas pendientes, mi cola de clasificación
│   └─ Admin/Supervisor: resumen de pipeline, forecast, actividad por agente
│
├─ Empresas (clientes)
│   ├─ Lista (filtros: región, giro, tamaño — catálogos vía /catalogos)
│   ├─ Alta / edición
│   └─ Ficha de cliente (detalle) ── responde al punto #1 y al "reporte por
│       cliente" del jefe (§1) ── pestañas:
│         ├─ Información y contactos (medios de contacto, puestos)
│         ├─ Historial (línea de tiempo unificada — punto #2)
│         ├─ Oportunidades de esta empresa — punto #3
│         ├─ Cotizaciones de esta empresa — punto #4
│         └─ Documentos de esta empresa
│
├─ Prospectos
│   ├─ Lista + detalle
│   └─ Importación CSV (subir archivo, revisar lote fila por fila,
│       confirmar / rechazar, confirmar-todos) — el flujo completo ya
│       construido y probado con datos reales de STEELSAFE, solo le
│       falta pantalla
│
├─ Tareas
│   ├─ Bandeja (filtros: estado, prioridad, tipo)
│   └─ Cola de clasificación
│
├─ Oportunidades ── punto #3
│   └─ Vista por etapa (kanban o lista agrupada) + detalle con cambio de
│       etapa / reapertura
│
├─ Cotizaciones ── punto #4
│   └─ Lista + detalle + nueva versión + cambio de estado
│
├─ Documentos
│   └─ Por empresa: subir, clasificar por tipo, marcar revisado
│
├─ Reportes (solo admin/supervisor) ── punto #5
│   └─ Actividades y ventas por agente, pipeline, conversión por etapa,
│       forecast, histórico de métricas diarias, exportar CSV
│
└─ Administración (solo admin)
    ├─ Usuarios
    ├─ Auditoría (consulta)
    └─ Monitoreo de integración: eventos pendientes / procesos fallidos
        (para saber si n8n está recibiendo lo que el CRM le manda)
```

## 6. Fases de construcción

Sin fechas fijas (ver §0). Orden sugerido por dependencia, no por semana:

1. **Fundacional**: login/sesión, layout y navegación por rol, lista + ficha de cliente básica (info y contactos). Sienta las bases para todo lo demás y ya cubre el punto #1 completo.
2. **Historial y ventas**: línea de tiempo (punto #2) y oportunidades/embudo (punto #3) dentro de la ficha de cliente.
3. **Cotizaciones y documentos**: punto #4, más el módulo de documentos.
4. **Prospectos**: pantalla de importación CSV — el backend ya está probado, así que es la fase con menos riesgo técnico una vez que exista el resto de la app (necesita la ficha de cliente para poder ver a qué se convirtió un prospecto confirmado).
5. **Desempeño**: reportes y dashboards (punto #5) — tiene más sentido una vez que haya datos reales cargados (empresas, oportunidades, cotizaciones) para mostrar, no antes.
6. **Administración**: usuarios, auditoría, monitoreo de outbox — uso interno del equipo, no cara al cliente ni al jefe; puede ir al final sin bloquear nada de lo anterior.

## 7. Fuera de alcance de este plan

- **n8n**: la interfaz no reemplaza ni necesita saber cómo funciona la automatización — consume sus resultados (prospectos clasificados, respuestas) ya guardados en el backend.
- **Diseño visual de marca** (colores, logotipo, tono): no definido en ningún documento del proyecto; se necesita antes de la fase 1 o se avanza con un estilo neutro de placeholder.
- Todo lo que el backend mismo marca como pendiente en su README (`/contactos` independiente sin aplicar todavía, cobertura de pruebas incompleta) — no bloquea el frontend, pero conviene que quien lo construya lo sepa antes de toparse con la ruta anidada de contactos en vez de la independiente.
