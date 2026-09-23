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
cd tu-repo-clonado
git pull

gcloud builds submit --tag us-central1-docker.pkg.dev/crm-prospeccion-outbound/nanobridge-repo/nanobridge-api:v1

gcloud run deploy nanobridge-api \
  --image=us-central1-docker.pkg.dev/crm-prospeccion-outbound/nanobridge-repo/nanobridge-api:v1 \
  --region=us-central1
```

- `git pull` trae tu código más reciente a la copia clonada en Cloud Shell.
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

**Paso 2 — exportar las variables que necesita `npm run migrate`.** El
validador de entorno del proyecto exige que existan `CRM_CALLBACK_API_KEY`,
`WEBHOOK_ENTRADA_API_KEY` y `STORAGE_LOCAL_SIGNING_SECRET` aunque una
migración no las use para nada — así que hay que sacarlas de Secret Manager
antes de correr el comando, o falla con un error de Zod:

```bash
export CRM_CALLBACK_API_KEY=$(gcloud secrets versions access latest --secret=CRM_CALLBACK_API_KEY --project=crm-prospeccion-outbound)
export WEBHOOK_ENTRADA_API_KEY=$(gcloud secrets versions access latest --secret=WEBHOOK_ENTRADA_API_KEY --project=crm-prospeccion-outbound)
export STORAGE_LOCAL_SIGNING_SECRET=$(gcloud secrets versions access latest --secret=STORAGE_LOCAL_SIGNING_SECRET --project=crm-prospeccion-outbound)
```

**Paso 3 — armar el `DATABASE_URL` apuntando a la IP pública de Cloud SQL**
(no al socket que usa Cloud Run — aquí necesitas host y puerto reales,
`3306`):

```bash
gcloud sql instances describe nanobridge-db --format='value(ipAddresses[0].ipAddress)'
gcloud secrets versions access latest --secret=DATABASE_URL --project=crm-prospeccion-outbound
```

Del segundo comando, saca la contraseña (el texto entre `appuser:` y
`@localhost`). **Cuidado:** si corres estos dos comandos uno tras otro sin
pausa, Cloud Shell a veces pega las dos salidas en una sola línea sin
separador (la IP queda pegada al final del secreto) — si ves eso, corre los
comandos por separado y confírmalos uno a la vez.

```bash
export DATABASE_URL="mysql://appuser:<password>@<ip_publica>:3306/nanobridge_crm"
npm install
npm run migrate
```

**Paso 4 — revocar el acceso que diste** (siempre, apenas termines):

```bash
gcloud sql instances patch nanobridge-db --clear-authorized-networks --project=crm-prospeccion-outbound --quiet
```

**Paso 5 — redesplegar** exactamente como en el punto 5 de arriba
(`gcloud builds submit` + `gcloud run deploy`).

## 7. Consultar o rotar secretos

Los valores actuales de los secretos no están escritos en ningún documento
a propósito (pueden rotarse). Para verlos:

```bash
gcloud secrets versions access latest --secret=<NOMBRE> --project=crm-prospeccion-outbound
```

Nombres válidos: `CRM_CALLBACK_API_KEY`, `WEBHOOK_ENTRADA_API_KEY`,
`STORAGE_LOCAL_SIGNING_SECRET`, `DATABASE_URL`.

Si necesitas la contraseña de MySQL y no la tienes, no es recuperable desde
Cloud SQL directamente — resetéala con:

```bash
gcloud sql users set-password appuser --instance=nanobridge-db --password=<nueva> --project=crm-prospeccion-outbound
```

(y luego actualiza el secreto `DATABASE_URL` en Secret Manager con la
contraseña nueva).

## 8. Cómo apuntar un nodo HTTP de n8n a la API

- URL base: `https://nanobridge-api-165032456965.us-central1.run.app`
- Header: `X-API-Key: <valor de CRM_CALLBACK_API_KEY>` (sacarlo con el
  comando del punto 7, no asumir que sigue siendo el mismo de siempre)

## 9. Pendientes de infraestructura (no urgentes, pero abiertos)

- Activar respaldos automáticos en Cloud SQL — hoy no hay backup si algo le
  pasa a la base.
- Forzar SSL en las conexiones a Cloud SQL.
- Borrar la cuenta de servicio `n8n-invoker-sa` (quedó de un intento de
  autenticación anterior, ya no se usa, no representa un riesgo activo pero
  es basura que se puede limpiar).
