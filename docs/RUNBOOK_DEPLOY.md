# Runbook: Docker local, GCP y despliegue

Esta guía explica, en lenguaje llano, qué es cada pieza de infraestructura de
este proyecto y cómo se hace un despliegue paso a paso. Está pensada para
volver a leerla en frío, sin tener que recordar por qué se hizo cada cosa.

## 1. Docker local — tu base de datos de pruebas

El contenedor `nanobridge-mysql` (puerto 3307) es MySQL corriendo aislado en
tu máquina, para cuando levantas el servidor localmente con `npm run dev`.
**No tiene nada que ver con producción.**

Su esquema quedó desactualizado (le faltan tablas como `eventos_pendientes`,
`oportunidades`, `documentos` — nunca se le corrieron las migraciones más
recientes). Los tests automáticos (`npm test`) no lo usan: levantan su propio
contenedor MySQL desechable en cada corrida, así que no dependen de que este
esté al día. Solo importa si algún día quieres correr `npm run dev`/`npm
start` localmente — en ese caso, recréalo desde cero y corre `npm run
migrate` contra él antes de usarlo.

## 2. Por qué el proyecto vive en Google Cloud

n8n Cloud (el n8n que usa Fabián, hospedado en internet) no puede alcanzar
`localhost` ni el Docker de tu máquina — no hay forma de que le pegue a algo
que solo existe en tu compu. Para que los nodos HTTP Request de n8n pudieran
hablar con la API, esta necesitaba una URL pública real. De ahí nace todo lo
de abajo.

## 3. Piezas de GCP y para qué sirve cada una

Todo vive en el proyecto `crm-prospeccion-outbound`, región `us-central1`.

| Recurso | Nombre | Para qué sirve |
|---|---|---|
| Cloud Run | `nanobridge-api` | Corre la API en la nube, con URL pública fija: `https://nanobridge-api-165032456965.us-central1.run.app` |
| Cloud SQL | `nanobridge-db` (MySQL 8.0) | La base de datos real de producción, con las 30 tablas del esquema |
| Cloud Storage | `nanobridge-documentos` | Bucket donde se guardan los documentos que suba el CRM (Cloud Run no tiene disco persistente, así que "guardar en local" no sirve ahí) |
| Artifact Registry | `nanobridge-repo` | Guarda las imágenes Docker ya construidas de la API, listas para que Cloud Run las use |
| Secret Manager | — | Guarda contraseñas y API keys de forma segura (no van en el código ni en `.env` de producción) |
| Service accounts | `nanobridge-api-sa` | El "usuario robot" con el que corre la API en Cloud Run; solo tiene permiso de hablar con Cloud SQL y con el bucket de documentos, nada más |

**Docker aquí es otra cosa distinta al Docker local del punto 1**: el
`Dockerfile` del repo no levanta una base de datos, es la receta para
empaquetar tu código en una imagen que Cloud Run pueda ejecutar.
`gcloud builds submit` lee esa receta, construye la imagen, y la sube a
Artifact Registry.

## 4. Los dos permisos que solo tu jefe puede tocar

El proyecto tenía activas, por default, dos reglas de seguridad de Google que
bloqueaban cosas necesarias:

1. `iam.allowedPolicyMemberDomains` impedía hacer el servicio de Cloud Run
   público. Es necesario porque n8n y el futuro CRM (que corre en el
   navegador del usuario) nunca pueden tener metida una credencial de
   Google adentro — la única protección real posible ahí es la `X-API-Key`
   en cada petición, no el borde de la red.
2. `iam.disableServiceAccountKeyCreation` impedía crear una llave alterna
   para evitar el punto 1.

Solo el Owner del proyecto (`director.general@nano-bridge-mex.com`) puede
anular estas políticas, desde Consola → "Organization Policies" → buscar la
política → "Anular política del elemento superior" → "Reemplazar" → "Permitir
todo". Ya está hecho y queda limitado a este proyecto, no afecta al resto de
la organización.

## 5. Cómo redesplegar (cambio de código, sin migración nueva)

Se corre desde **Cloud Shell** (la terminal de Google en el navegador) — no
desde tu compu, ahí no tienes `gcloud` instalado.

```bash
cd ~/CRM_NANOBRIDGE
git checkout main && git pull && git checkout <commit-a-desplegar>
git checkout -- package-lock.json   # ver nota abajo

gcloud builds submit --tag us-central1-docker.pkg.dev/crm-prospeccion-outbound/nanobridge-repo/nanobridge-api:v1

gcloud run deploy nanobridge-api \
  --image=us-central1-docker.pkg.dev/crm-prospeccion-outbound/nanobridge-repo/nanobridge-api:v1 \
  --region=us-central1
```

- `git pull` trae tu código más reciente a la copia clonada en Cloud Shell, y
  `git checkout <commit>` fija exactamente la versión que se va a desplegar:
  así un commit que alguien suba mientras tanto no se cuela.
- `git checkout -- package-lock.json`: el npm de Cloud Shell es más nuevo y
  reescribía ese archivo con `npm install`. `gcloud builds submit` sube la
  carpeta tal cual, así que el build usaba ese archivo modificado y no el
  del repo (visto el 1-oct-2026). Desde el 2-oct las migraciones usan
  `npm ci`, que no lo toca; el comando se queda por si acaso.
- Al terminar, `git checkout main` para no dejar la copia en un commit fijo.
- `gcloud builds submit` empaqueta el código con el `Dockerfile` y sube la
  imagen a Artifact Registry (siempre con la misma etiqueta `v1`, se
  sobreescribe, no se van acumulando `v2`, `v3`...).
- `gcloud run deploy` le dice a Cloud Run que use la imagen nueva. Esto crea
  una "revisión" nueva (verás nombres tipo `nanobridge-api-00003-hbt`) y le
  pasa el 100% del tráfico.

Verifica que quedó bien:

```bash
curl https://nanobridge-api-165032456965.us-central1.run.app/health
```

Debe responder `{"status":"ok","service":"nanobridge-crm-api"}`. Nota: la
ruta es `/health`, no `/api/v1/health`.

## 6. Cómo redesplegar cuando hay una migración nueva

Si agregaste una tabla o columna nueva, hay pasos extra **antes** del deploy,
porque Cloud SQL por default solo acepta conexiones desde IPs autorizadas
explícitamente.

**Paso 1 — autorizar tu IP de Cloud Shell temporalmente:**

```bash
MY_IP=$(curl -s ifconfig.me); echo $MY_IP
gcloud sql instances patch nanobridge-db --authorized-networks=$MY_IP/32 --project=crm-prospeccion-outbound --quiet
```

(`echo $MY_IP` es necesario — el primer comando por sí solo no imprime
nada, y sin ver la IP es fácil confundirse en el siguiente paso.)

**Paso 2 — instalar dependencias, ANTES de sacar cualquier secreto:**

```bash
npm ci
```

- `npm ci` instala exactamente lo del `package-lock.json` y no lo
  reescribe (`npm install` sí, con el npm más nuevo de Cloud Shell).
- Va antes que los secretos porque al instalar corren scripts de terceros
  (los de cada dependencia): si los secretos ya estuvieran en el ambiente,
  esos scripts podrían leerlos.

**Paso 3 — cargar los secretos y el `DATABASE_URL` sin que se vean en
pantalla ni queden en el historial.** `npm run migrate` valida todo el
ambiente, así que pide `CRM_CALLBACK_API_KEY`, `WEBHOOK_ENTRADA_API_KEY` y
`REPLY_TO_SIGNING_SECRET` aunque la migración no las use. El `DATABASE_URL`
del secreto apunta al socket de Cloud Run (`@localhost/...?socketPath=...`);
aquí se cambia por la IP pública y el puerto `3306`, sin imprimirlo:

```bash
P=crm-prospeccion-outbound
export CRM_CALLBACK_API_KEY=$(gcloud secrets versions access latest --secret=CRM_CALLBACK_API_KEY --project=$P)
export WEBHOOK_ENTRADA_API_KEY=$(gcloud secrets versions access latest --secret=WEBHOOK_ENTRADA_API_KEY --project=$P)
export REPLY_TO_SIGNING_SECRET=$(gcloud secrets versions access latest --secret=REPLY_TO_SIGNING_SECRET --project=$P)
DB_IP=$(gcloud sql instances describe nanobridge-db --project=$P --format="value(ipAddresses[0].ipAddress)")
export DATABASE_URL=$(gcloud secrets versions access latest --secret=DATABASE_URL --project=$P | sed -e "s#@localhost/#@$DB_IP:3306/#" -e "s#?socketPath=.*##")
# Revisar que quedó bien, con la contraseña tapada:
echo "$DATABASE_URL" | sed -E "s#(://[^:]+:)[^@]*@#\1****@#"
```

Debe verse `mysql://appuser:****@<ip>:3306/nanobridge_crm`. Luego:

```bash
npm run migrate
unset CRM_CALLBACK_API_KEY WEBHOOK_ENTRADA_API_KEY REPLY_TO_SIGNING_SECRET DATABASE_URL
```

**Nunca** escribas la contraseña dentro de un comando (`export
DATABASE_URL="mysql://appuser:LA_CONTRASEÑA@..."`): queda guardada en el
historial de Cloud Shell. Y no pegues en un chat la salida de `gcloud
secrets versions access`.

**Paso 4 — revocar el acceso que diste** (siempre, apenas termines):

```bash
gcloud sql instances patch nanobridge-db --clear-authorized-networks --project=crm-prospeccion-outbound --quiet
```

**Paso 5 — redesplegar** exactamente como en el punto 5 de arriba
(`gcloud builds submit` + `gcloud run deploy`).

**Orden:** la migración va **antes** del código. El código nuevo suele leer
las columnas nuevas (con la 023, `GET /cola-clasificacion` tronaba sin
ellas); el código viejo con columnas de más no se rompe.

**Si `npm run migrate` se queda colgado en Cloud Shell**, la migración se
aplica a mano con el cliente de MySQL (`-p` pide la contraseña sin
mostrarla ni guardarla en el historial; `$DB_IP` es la del paso 3):

```bash
mysql -h "$DB_IP" -u appuser -p nanobridge_crm < src/database/migrations/<archivo>.sql
mysql -h "$DB_IP" -u appuser -p nanobridge_crm -e "INSERT INTO schema_migrations (version) VALUES ('<archivo>.sql');"
```

El segundo comando la registra como aplicada, igual que lo hace
`apply-migrations.ts`. Una migración a la vez, en orden.

### Qué está en producción

Actualiza esta tabla en cada deploy.

| Fecha | Revisión | Commit | Migraciones hasta | Qué trajo |
|---|---|---|---|---|
| 1-oct-2026 | `nanobridge-api-00008-6wj` | `91b88d5` | `023_sugerencia_clasificacion.sql` | Sugerencia de la IA, interesado → tarea, `/vencidas` con datos del recordatorio, "Sin asignar" y reporte de prospección |
| 1-oct-2026 | `nanobridge-api-00009-jfk` | `ff9f3d3` | (sin migración) | Baja por link o spam de SendGrid = persona completa |
| 1-oct-2026 | `nanobridge-api-00010-dq5` | `def4d07` | (sin migración) | "La baja manda": la baja cancela seguimientos y una clasificación posterior no la deshace |
| 2-oct-2026 | `nanobridge-api-00011-6cg` | `def4d07` (misma imagen) | (sin migración) | Solo configuración: `TRUST_PROXY=true` (antes todos los usuarios compartían el límite de intentos de login, por la IP del proxy de Google) |
| 2-oct-2026 | `nanobridge-api-00012-nrx` | `7ddf33a` | `024_respuestas_remitente.sql` | Bloque A de fixes: el correo manda en la identidad, la baja es de la persona y no se deshace, el CRM respeta la lista de supresión, spam de respuestas ignorado, remitente guardado; además /campanas y pausa = espera |
| 2-oct-2026 | `nanobridge-api-00013-kxh` | `270caf1` | `026_envios_indice_ventana.sql` | Bloque B de fixes: freno de login por cuenta (025), sesiones y reactivar usuario, errores 4xx en vez de 500, outbox que no se atora, trabajos diarios por endpoint (PT5), descargas con sesión, índice de ventanas (026), campañas sin fecha de fin pasada, días hábiles en hora de México, CSRF, Node 22 sin root |
| 5-oct-2026 | `nanobridge-api-00014-2mh` | `69bed7f` | `027_metricas_montos_grandes.sql` | Bloques C y D de fixes: asignar = dar dueño, permisos de agentes en tareas/oportunidades/CSV/documentos, métricas con montos grandes (027), cotizaciones en centavos y con estados cerrados, día de México en reportes, fecha de actividades; más el code review de verificación (outbox sin duplicados, personas desactivadas, carrera baja/seguimiento, códigos de error) |
| 5-oct-2026 | `nanobridge-api-00015-…` | `69bed7f` (misma imagen) | (sin migración) | No quedó anotada. Por lo que se ve después, solo configuración: `SESSION_COOKIE_NAME=__session` para publicar el front en Firebase |
| 6-oct-2026 | `nanobridge-api-00016-vwc` | `74502d5` | (sin migración) | Antes de encender: la ventana se cierra por persona al responder y tope de 50 correos al día (`TOPE_DIARIO_CORREOS`, `en_espera` en verificación, `tope_diario_alcanzado` en `/vencidas`) |
| 6-oct-2026 | `nanobridge-api-00017-cbm` | `74502d5` (misma imagen) | (sin migración) | Solo la contraseña nueva de `appuser` (versión 2 del secreto `DATABASE_URL`; la anterior estaba expuesta desde el 23-sep) |

**Variables que deben seguir puestas en Cloud Run** (`gcloud run deploy --image=…` las
conserva; no uses `--set-env-vars`, que borra las que no menciones):
- `TRUST_PROXY=true` — sin ella, el límite de login es uno solo para todos los usuarios.
- `SESSION_COOKIE_NAME=__session` — el front publicado en Firebase
  (https://crm-prospeccion-outbound.web.app) solo deja pasar esa cookie; sin ella
  nadie puede iniciar sesión.
- `TOPE_DIARIO_CORREOS` no está puesta: vale 50 por defecto. Al encender los
  envíos reales se baja a 20 (calentamiento del dominio, PLAN_N8N_DEFINITIVO.md)
  con `--update-env-vars TOPE_DIARIO_CORREOS=20`.

### Consultar la base desde Cloud Shell sin escribir la contraseña

Para revisar algo rápido (p. ej. qué migraciones están aplicadas). La contraseña sale
del secreto `DATABASE_URL` y solo vive durante el comando `mysql`: no se imprime ni queda
en el historial. La última línea vuelve a cerrar la base: córrela aunque algo falle.

```bash
P=crm-prospeccion-outbound
MY_IP=$(curl -s ifconfig.me); echo $MY_IP
gcloud sql instances patch nanobridge-db --authorized-networks=$MY_IP/32 --project=$P --quiet
DB_IP=$(gcloud sql instances describe nanobridge-db --project=$P --format="value(ipAddresses[0].ipAddress)")
MYSQL_PWD=$(gcloud secrets versions access latest --secret=DATABASE_URL --project=$P | sed -E 's#^mysql://[^:]+:([^@]*)@.*#\1#') \
  mysql -h "$DB_IP" -u appuser nanobridge_crm -e "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3;"
gcloud sql instances patch nanobridge-db --clear-authorized-networks --project=$P --quiet
```

Cambia la consulta del `-e "..."` por la que necesites (solo lectura, de preferencia).

### Revisión única: personas fundidas por teléfono (antes del 2-oct-2026)

Antes del Bloque A, una persona que compartía teléfono (el conmutador de su empresa) con
alguien ya registrado quedaba **fundida** con esa persona: su prospecto se colgaba del
contacto equivocado y su correo ni se guardaba. El arreglo evita casos nuevos, pero no
corrige los viejos. Esta consulta (solo lectura) lista los contactos con más de un
prospecto creado antes del arreglo:

```sql
SELECT c.id AS contacto_id, c.nombre, e.nombre_legal,
       COUNT(p.id) AS prospectos,
       GROUP_CONCAT(p.id ORDER BY p.id) AS prospecto_ids,
       GROUP_CONCAT(DISTINCT p.fuente_url ORDER BY p.id SEPARATOR ' | ') AS fuentes
FROM contactos c
JOIN empresas e ON e.id = c.empresa_id
JOIN prospectos p ON p.contacto_id = c.id
WHERE p.creado_en < '2026-10-03'
GROUP BY c.id, c.nombre, e.nombre_legal
HAVING COUNT(p.id) > 1
ORDER BY prospectos DESC;
```

No todo lo que sale es un error: la misma persona que vuelve a entrar con su mismo correo
también aparece. Hay que revisar a mano las fuentes de cada fila: si son de personas
distintas, ese contacto está fundido. El CRM todavía no tiene pantalla para separar
personas: anota los `prospecto_ids` y se prepara el arreglo en SQL aparte, revisado antes
de correrlo.

## 7. Consultar o rotar secretos

Los valores actuales de los secretos no están escritos en ningún documento
a propósito (pueden rotarse). Para verlos:

```bash
gcloud secrets versions access latest --secret=<NOMBRE> --project=crm-prospeccion-outbound
```

Nombres válidos: `CRM_CALLBACK_API_KEY`, `WEBHOOK_ENTRADA_API_KEY`,
`REPLY_TO_SIGNING_SECRET`, `DATABASE_URL`. (`STORAGE_LOCAL_SIGNING_SECRET`
ya no se usa desde el 2-oct-2026: las descargas no llevan URL firmada.)

**Rotar `REPLY_TO_SIGNING_SECRET` invalida los Reply-To de los correos ya
enviados:** sus respuestas llegarían como "Respuesta no identificada". Solo
rotarlo si se filtró.

## 8. Secreto nuevo `REPLY_TO_SIGNING_SECRET` (una sola vez)

Desde el commit del Reply-To firmado (29-sep-2026), la API no arranca sin
este secreto: firma el Reply-To de cada correo. Se crea **una vez**, antes
del primer deploy que lo necesita. En Cloud Shell:

```bash
# 1. Crear el secreto con un valor aleatorio (nadie lo ve ni lo copia).
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create REPLY_TO_SIGNING_SECRET --data-file=- --project=crm-prospeccion-outbound

# 2. Darle permiso de leerlo al usuario robot de la API.
gcloud secrets add-iam-policy-binding REPLY_TO_SIGNING_SECRET \
  --member=serviceAccount:nanobridge-api-sa@crm-prospeccion-outbound.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor --project=crm-prospeccion-outbound
```

3. En ese primer deploy, agregar al `gcloud run deploy` del punto 5 la línea
`--update-secrets=REPLY_TO_SIGNING_SECRET=REPLY_TO_SIGNING_SECRET:latest`.
Cloud Run la recuerda: los deploys siguientes ya no la necesitan.

Si se olvida el paso 3, la revisión nueva no arranca y Cloud Run deja
funcionando la anterior; no se cae nada, solo hay que repetir el deploy con
la línea.

Si necesitas la contraseña de MySQL y no la tienes, no es recuperable desde
Cloud SQL directamente — resetéala con:

```bash
gcloud sql users set-password appuser --instance=nanobridge-db --prompt-for-password --project=crm-prospeccion-outbound
```

(`--prompt-for-password` la pide sin mostrarla; con `--password=...`
quedaría en el historial.)

(y luego actualiza el secreto `DATABASE_URL` en Secret Manager con la
contraseña nueva).

## 8. Cómo apuntar un nodo HTTP de n8n a la API

- URL base: `https://nanobridge-api-165032456965.us-central1.run.app`
- Header: `X-API-Key: <valor de CRM_CALLBACK_API_KEY>` (sacarlo con el
  comando del punto 7, no asumir que sigue siendo el mismo de siempre)

## Actualizar la imagen base de Node

El `Dockerfile` fija `node:22-bookworm-slim` por digest (`@sha256:...`): dos
builds del mismo commit usan exactamente la misma base. A cambio, los parches
de seguridad de la imagen no llegan solos. Una vez al mes, o cuando salga un
aviso de seguridad de Node:

```bash
docker pull node:22-bookworm-slim
docker inspect --format "{{index .RepoDigests 0}}" node:22-bookworm-slim
```

Copia el `sha256:...` nuevo en la línea `ARG NODE_IMAGE=` del `Dockerfile`,
corre la suite y despliega como cualquier cambio de código. Node 22 recibe
parches hasta abril de 2027; antes de esa fecha hay que pasar a Node 24.

## 9. Pendientes de infraestructura (no urgentes, pero abiertos)

- Activar respaldos automáticos en Cloud SQL — hoy no hay backup si algo le
  pasa a la base.
- Forzar SSL en las conexiones a Cloud SQL.
- Borrar la cuenta de servicio `n8n-invoker-sa` (quedó de un intento de
  autenticación anterior, ya no se usa, no representa un riesgo activo pero
  es basura que se puede limpiar).
- Quitar el secreto `STORAGE_LOCAL_SIGNING_SECRET` del servicio de Cloud Run
  (ya no se usa desde el 2-oct-2026, ver §7).
- DMARC: ya existe con `p=none` (solo vigilar; SPF, DKIM y DMARC pasan,
  verificado el 6-oct-2026). Cuando haya volumen real sin problemas, subirlo
  a `p=quarantine`.
- Link Branding en SendGrid (2 registros DNS) para que el link de baja use
  `contacto.nano-bridge-mex.com` en vez de `ct.sendgrid.net`. Menor.

## 10. Lista de encendido (antes de salir en vivo)

Nada de esto se hace hasta que todo esté listo: el día que se encienda, se
recorre completa. El orden de los pendientes vive en `PLAN_N8N_DEFINITIVO.md`
("Pendientes en orden").

- [ ] Apagar `MODO_PRUEBAS` en PT1 y PT4.
- [ ] Textos reales en los correos (quitar "correo de PRUEBA" en PT1b). Antes,
      elegir con Carlos la opción A (plantilla por giro) o B (Gemini en vivo
      con candados), `PLAN_N8N_DEFINITIVO.md` ronda 1 #3. El pie debe llevar
      el link de baja visible: hoy `subscription_tracking: { enable: true }`
      solo pone el encabezado `List-Unsubscribe` (con One-Click, verificado
      el 6-oct-2026), no texto en el cuerpo. Pasarle `text` y `html` con la
      marca `<% %>` que SendGrid convierte en el link.
- [ ] Pruebas en vivo que faltan: respuesta automática (fuera de oficina),
      correo sin firma y rebote.
- [ ] Respaldos automáticos de Cloud SQL activados (§9).
- [ ] Tope diario a 20 para calentar el dominio:
      `--update-env-vars TOPE_DIARIO_CORREOS=20`.
- [ ] Cupo apartado para recordatorios y fila de espera de correos iniciales.
      Depende de Carlos: ¿los prospectos llegan en lotes o uno por uno?
- [ ] Publicar PT4.
- [ ] Borrar los datos de prueba.
- [ ] Domicilio de la empresa en el remitente (hoy el remitente de pruebas
      tiene el de la casa de Fabián).
- [ ] Cuenta definitiva de SendGrid (la de prueba vence el 24-nov-2026 y está
      con el correo de pasante). Al cambiar: rehacer la autenticación del
      dominio, dar de alta Inbound Parse y poner la API key nueva en n8n.
      Antes de que termine la pasantía de Fabián.
- [ ] Corregir el nombre del admin "Fabi�n" (quedó mal guardado al crearlo):
      Administración → Usuarios → editar.
- [ ] Las 5 respuestas de Carlos, incluida: ¿"no interesado" bloquea para
      siempre o 6 meses?
- [ ] Los 2 usuarios `root` de MySQL con contraseña desconocida: cambiarles
      la contraseña o borrarlos.
- [x] Contraseña de `appuser` rotada (6-oct-2026, revisión `00017-cbm`).
