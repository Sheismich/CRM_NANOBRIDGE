# Plan de front de Fabián (rediseño, desde el 13-oct-2026)

El front nuevo se reparte entre dos personas. A Fabián le tocan **Inicio, Tareas, Documentos, Administración y el Informe ejecutivo**, y además la **Base común**, porque todas las pantallas la usan y tiene que existir antes que cualquier otra. Las demás pantallas (Login, Prospectos, Empresas + ficha, Contactos, Oportunidades, Cotizaciones y Reportes) son de Mich y están en `PLAN_FRONTEND.md`, sección "Rediseño".

La tabla de avance de las dos personas vive en un solo lugar: `PLAN_FRONTEND.md` → "Rediseño". Al terminar cada pantalla se anota ahí (hecha por, commit, en vista previa).

El backend de todas estas pantallas ya está en producción desde el 12-oct-2026 (revisión `00024-r4f`; `00025-b4l` desde la misma noche).

## Orden

| # | Qué | Diseño | Estimado |
|---|---|---|---|
| 1 | Base común ✅ 13-oct | `inicio-aprobado.html` | 1-2 días |
| 2 | Inicio ✅ 13-oct | `inicio-aprobado.html` | ½-1 día |
| 3 | Tareas (Mi día + Ver todas) ✅ 13-oct | `tareas.html` (opciones 3 y 6) | 1 día |
| 4 | Documentos | `documentos.html` | 1 día |
| 5 | Administración | `administracion.html` | 1 día |
| 6 | Informe ejecutivo | `informe-ejecutivo.html` | ½ día |

Una pantalla por sesión de Claude. La Base común va primero porque Mich no puede empezar sus pantallas sin ella: en cuanto esté, se hace push y se le avisa.

## 1. Base común ✅ (13-oct-2026)

Hecha. Cómo se usa cada pieza: `PLAN_FRONTEND.md` → "Base común — cómo se usa"; catálogo en `npm run dev` → `/base`. Falta subirla al canal de vista previa (se puede junto con el Inicio, porque sola no cambia nada que se vea más que el menú y los colores).

Lo que se pidió:

Todo lo que comparten las 11 pantallas. Mich lo usa tal cual; si a ella le falta algo, lo agrega aquí mismo (no copias por pantalla).

- **Tokens** (`frontend/src/index.css` + `lib/tema.ts`): pasar los de `docs/diseno/inicio-aprobado.html`, conservando los nombres actuales y agregando los que falten:
  - fondo oscuro `#0a0f1e`, panel `#10172d`, línea `#1b2340`;
  - relieve: fondo liso `#e8ecf5` / `#0f1529` y sombras suaves sin borde;
  - encabezado de color por tarjeta (menta, cyan, lila) y `--purple: #5b2d86`.
- **Componentes nuevos en `components/ui/`:**
  - `Franja`: tarjeta redondeada con degradado navy → morado, N de marca de agua, saludo y números grandes en Anton.
  - `Tarjeta`: con relieve, ícono en un cuadrito hundido y encabezado de color.
  - `Ficha` (chip), `Pastilla` (ok / warn / danger), `Contador`, `PanelLateral` (detalle que se abre al dar clic) y `Modal`.
  - `MarcaDeAgua`: la N con el giro y la opacidad del diseño (.09 de día, .12 de noche).
- **Menú:**
  - Escritorio: rehacer `Sidebar.tsx` como en el diseño (punto menta en la opción activa, contador en Tareas, abajo la persona y el cambio de modo).
  - Celular (menos de 760 px): barra de arriba azul marino y barra de navegación abajo con 5 accesos (Inicio, Tareas, Prospectos, Empresas, Más). Se tocan `AppShell.tsx`, `Topbar.tsx` y `nav-items.ts`; el contenido lleva espacio abajo para que la barra no lo tape.
- **Primer deploy a la vista previa** (ver "Publicar").
- **Al terminar:** anotar en `PLAN_FRONTEND.md` → "Rediseño" qué componentes hay y cómo se usan (una línea por componente), para que Mich no tenga que leer el código para saberlo.

## 2. Inicio (`pages/DashboardPage.tsx`) ✅ (13-oct-2026)

Hecho. Piezas en `components/inicio/` y la lógica (fechas, agrupar el feed) en `lib/inicio.ts`. Decisiones:
- **Backend nuevo:** `abiertas.valor_ponderado` en `GET /reportes/pipeline/resumen` (valor × probabilidad de todas las abiertas, también sin fecha de cierre; prueba en test/390). **Falta desplegarlo**; mientras, la tarjeta esconde el ponderado y la barra de probabilidad.
- **Agente:** los reportes son solo de admin/supervisor, así que el agente ve la franja con SUS números de `/tareas/conteos` (vencen hoy, vencidas, cerró hoy, cerró ayer), el aviso de respuestas por contestar y sus tareas.
- "Automatización activa" = alguna campaña con `activa_hoy`; si no, "Sin campañas activas" en gris.
- La gráfica va del día 1 a hoy (mínimo 7 días). El feed junta los envíos seguidos de la misma campaña y número en un lote, y las respuestas sin clasificar en un renglón con liga a la cola.
- "Crear nueva oportunidad" abre un panel: buscar empresa → el mismo formulario de la ficha → abre la ficha en Oportunidades.
- Se quitaron del Inicio de admin "Qué hacer hoy", forecast y actividad por agente (no están en el diseño; viven en Tareas y Reportes).

Lo que se pidió:

- **Franja:** contactadas, respondieron, interesados y tasa, con "+N hoy". Sale de `GET /reportes/prospeccion` con el rango del mes y con el de hoy; la comparación ("septiembre: 8.2 %") es una tercera llamada con el mes anterior.
- **Correos enviados por día:** `GET /reportes/prospeccion/por-dia`, gráfica en SVG (como `components/reportes/Graficas.tsx`).
- **Lo que acaba de pasar:** `GET /reportes/actividad-reciente`.
- **Campañas** (ancha): `por_campana` de `/reportes/prospeccion` (ya trae interesados).
- **Pipeline abierto** (angosta): `GET /reportes/pipeline/resumen` con el rango del mes (trae ganadas y perdidas). Botón "Crear nueva oportunidad" con `NuevaOportunidadForm`.
- Conservar la diferencia entre lo que ve un agente y lo que ven admin y supervisor (los reportes son solo de admin/supervisor).

## 3. Tareas (`pages/TareasPage.tsx`) ✅ (13-oct-2026)

Hecha. Piezas en `components/tareas/` (`MiDia`, `VerTodas`, `DetalleTarea`, `AccionesTarea` con las ventanas de Hecha y Reprogramar) y lógica en `lib/mi-dia.ts`. Decisiones:
- **Backend nuevo:** `PATCH /tareas/:id/reprogramar {fechaLimite}` (futura; un agente solo las suyas; auditada; limpia `alertado_en` para que el aviso de vencida vuelva a salir; sale en el historial como "reprogramada"). Prueba en test/430; suite 555/555. **Falta desplegarlo: hasta entonces el botón Reprogramar da error.**
- "Hecha" pide el resultado en una ventana (obligatorio, con respuestas rápidas). Reprogramar trae atajos (mañana 9:00, en 2 días, próximo lunes).
- "Saltar" y elegir una tarea de "Después" solo viven en la pantalla.
- URL: `?vista=todas`, `&alcance=todas|sin_asignar`, `?tab=cola` (la liga del Inicio sigue sirviendo).
- Ver todas trae hasta 100 abiertas (dos llamadas: pendiente + en progreso) o las 100 cerradas más recientes; si hay más, lo avisa.
- En el celular el detalle sale en un PanelLateral.

Lo que se pidió:

- **Mi día:**
  - Arriba la siguiente tarea con `GET /tareas/:id`: chips de empresa, contacto y campaña, teléfono junto a los botones, caja "Lo que contestó" con la sugerencia de la IA (`respuesta`), y botones Hecha / Reprogramar / Saltar.
  - Abajo "Después".
  - Anillo de avance con `GET /tareas/conteos` (cerradas hoy y ayer, pendientes de hoy, vencidas): "↗ Vas bien · 33 % completado".
  - Cola de clasificación (`ColaClasificacion`, solo admin/supervisor).
  - "Del equipo / Tomar" **solo para admin y supervisor**, con `PATCH /tareas/:id/asignar`. Los agentes no toman tareas.
  - "Saltar" vive solo en la pantalla; no se guarda.
  - Panel morado de la automatización: `por-dia` + `actividad-reciente` (sin backend nuevo).
- **Ver todas:** lista + detalle, con `GET /tareas?q=` y `GET /tareas/:id/historial`.

## 4. Documentos (`pages/DocumentosPage.tsx` y `components/ficha/DocumentosTab.tsx`)

- Botones arriba: **Descargar lote** (`/documentos/lote`) y **Subir documento**.
- Contadores: `GET /documentos/conteos` (por revisar, aprobados, expedientes incompletos, rechazados).
- Lista filtrada por `revision`, tipo y `q`.
- Panel con vista previa en `<iframe>` / `<img>` a `/api/v1/documentos/:id/descarga?modo=ver` (mismo origen por el rewrite de Firebase, la cookie viaja sola). **Ojo:** `firebase.json` manda `X-Frame-Options: DENY` y `frame-ancestors 'none'` a TODAS las rutas, también a `/api/**`, así que un `<iframe>` del PDF va a salir en blanco. Hay que cambiar a `SAMEORIGIN` / `frame-ancestors 'self'` (al menos para `/api/v1/documentos/**`) o mostrar el PDF de otra forma. Probarlo en la vista previa, no solo en local (en local Vite no manda esos encabezados).
- **Aprobar / Rechazar** (`PATCH :id/aprobar` y `:id/rechazar`), solo admin y supervisor. Rechazar abre un `Modal`: motivo rápido (ilegible, vencido, incompleto, no es de esta empresa, tipo equivocado, otro) + explicación obligatoria de hasta 500 caracteres. El front nuevo ya no usa `PATCH :id/revisar`.
- **Expediente:** el resumen va en el panel del documento, y la sección de expediente de la ficha también es de Fabián: vive en `DocumentosTab.tsx`, que la ficha de Mich solo coloca. Hoy no hay papeles obligatorios (Carlos, 12-oct): `GET /documentos/expediente/:id` regresa `total: 0` y se enseñan los documentos de la empresa; la lista de papeles aparece sola el día que se marquen en el catálogo.
- Clic en el nombre de la empresa → ficha con `?tab=documentos`, con un "← Documentos" para regresar. **Coordinar con Mich** la ruta exacta cuando ella rehaga la ficha.

## 5. Administración (`pages/AdministracionPage.tsx`)

- **Franja** con los 4 servicios de `GET /admin/salud` (API, base de datos, avisos a n8n, correos), con su semáforo. "Responde en" lo mide la pantalla; "Revisado hace N s". No prometer uptime, entregabilidad ni réplica (no los tenemos).
- **Problemas agrupados por causa** (`GET /admin/problemas`) con "Reintentar todos" (`POST /admin/problemas/reintentar`, solo avisos del outbox) y "Resolver" (`POST /admin/problemas/resolver`).
- **Registro de cambios** (`GET /admin/registro-cambios` con filtros de tipo, usuario, entidad y búsqueda; paginado), solo administrador. Botón "Exportar registro de cambios" en PDF y CSV: `/admin/registro-cambios/export`.
- **Equipo y roles** en una tarjeta: niveles de acceso con cuántos usuarios tiene cada uno, usuarios con correo, `ultimo_acceso_en` y rol, y "Nuevo usuario" (`UsuariosAdmin` restilizado).
- La pestaña Auditoría cruda desaparece (la reemplaza el Registro de cambios). Mientras siga el front viejo, el backend deja `/auditoria` a admin y supervisor; se cierra el día del cambio.

## 6. Informe ejecutivo

El PDF y el CSV ya los genera el backend: `GET /api/v1/reportes/export/informe-ejecutivo?formato=pdf|csv&mes=YYYY-MM&responsableId=` (solo admin y supervisor; `mes` por omisión = el actual).

1. **Revisar el PDF real contra `docs/diseno/informe-ejecutivo.html`**, con datos de producción: hoja carta, N de marca de agua, logo, resumen del mes, conversión y tiempo promedio, conversión por etapa, forecast, prospección (vs mes anterior) y desempeño por agente. Lo que no cuadre se corrige en `src/reportes/informe-ejecutivo.service.ts` (con su prueba) y se despliega antes que el front.
2. **Componente `components/reportes/InformeEjecutivo.tsx`**: selector de mes (y de agente, opcional) + botones PDF y CSV con `api.descargar(...)`. Muestra un aviso mientras descarga y el error si falla.
3. **Dónde va:** en la franja de abajo de Oportunidades, que es pantalla de Mich. Fabián entrega el componente; Mich solo lo coloca. Si Fabián termina antes que ella Oportunidades, se puede poner también en Reportes o en el Inicio de admin/supervisor.

## Cómo se trabaja

- **Antes de cada sesión:** `git fetch` y revisar si Mich subió algo (sobre todo en `index.css`, `components/ui/`, `types.ts`, `nav-items.ts`, que tocan los dos). Leer la sección de la pantalla en `docs/diseno/README.md` y ver sus capturas en `docs/diseno/capturas/`. Los `.html` del diseño no se leen completos (traen logos en base64): solo el `<style>` y el bloque de la parte que se va a hacer.
- **Rama:** todo en `main`. Las pantallas se reemplazan en su mismo archivo y ruta, sin interruptor de versión vieja/nueva. La liga normal sigue con lo publicado desde `415da55`; un arreglo urgente al front viejo iría en una rama desde ese commit.
- **Se reusa lo que ya funciona:** `lib/api.ts` (con `api.descargar`), React Query, los formularios existentes, `ColaClasificacion`, `EstadoVacio`, `Paginacion` y `.tabla-tarjetas` para listas en el celular. Sin librerías nuevas: gráficas en SVG.
- **Tipos:** las respuestas nuevas van a `src/types.ts`, en un bloque con el nombre de la pantalla para no chocar con Mich. Revisar la forma exacta del JSON contra el service del backend.
- **Cambios de backend** que salgan en el camino: primero el backend (TDD), sin romper el front publicado, y se despliega antes que el front. Si le afectan a Mich, se anotan en `PLAN_FRONTEND.md`.

## Verificación (cada pantalla)

1. `cd frontend && npm run lint && npm run build` sin errores.
2. En local contra producción: en PowerShell `$env:API_URL="https://nanobridge-api-165032456965.us-central1.run.app"; npm run dev` y entrar con un usuario de prueba (`API_URL`, sin `VITE_`: ver el comentario de `vite.config.ts`).
3. En el navegador: escritorio y celular (375 px), día y noche, contra las capturas; como administrador y como agente; estados vacíos; que las acciones guarden de verdad (aprobar, rechazar con motivo, reintentar, cerrar tarea).
4. Deploy al canal de vista previa y abrir la liga en el celular.
5. Anotar el avance en `PLAN_FRONTEND.md` → "Rediseño".

## Publicar (vista previa)

Desde `frontend/`, con la cuenta de Fabián:
```
npm ci
VITE_API_URL= npm run build
npx firebase-tools hosting:channel:deploy nuevo-diseno --expires 30d
```
Cada deploy reinicia los 30 días. La liga normal no cambia hasta que estén las 11 pantallas de los dos.

## Día del cambio

Cuando estén todas (las de Fabián y las de Mich), en este orden. Está escrito completo en `PLAN_FRONTEND.md` → "Rediseño":
1. `npx firebase-tools hosting:clone crm-prospeccion-outbound:nuevo-diseno crm-prospeccion-outbound:live` (sin volver a compilar).
2. Deploy del backend que cierra `/auditoria` al supervisor, vuelve obligatorio el motivo de rechazo de cotizaciones y limita o quita `PATCH /documentos/:id/revisar`.
3. Revisar en la liga normal: login, una pantalla por rol y Administración como supervisor.
