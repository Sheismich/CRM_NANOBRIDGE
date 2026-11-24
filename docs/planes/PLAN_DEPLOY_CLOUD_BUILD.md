# Plan · Deploy automático con Cloud Build (#10 de la revisión del 20-nov)

**Para:** Mich y Fabián, para revisarlo antes de tocar Google Cloud.
**Versión:** 0.1 · 23 de noviembre de 2026. **Estado: propuesta.** Esta rama solo trae `cloudbuild.yaml`, una línea en
`nest-cli.json` y este plan; en Google Cloud no se ha creado nada todavía.

## 1. Qué cambia

| | Hoy (RUNBOOK §6) | Con esto |
|---|---|---|
| Quién | Fabián o Mich, a mano desde su compu o Cloud Shell | Cualquiera que empuje un tag `v*` y alguien que lo apruebe |
| Migraciones | `npm run migrate` desde una compu, autorizando su IP en Cloud SQL y revocándola | Un Cloud Run Job (`nanobridge-migrar`) con la misma imagen, por el conector de Cloud SQL: **sin abrir IPs** |
| Orden | A mano; dos veces se desplegó antes de migrar (la segunda, el 18-nov) | Construir → subir → migrar → desplegar. Si la migración falla, **no se despliega** |
| Copia limpia | `git archive` para no subir el `.env` | Cloud Build clona el repo: el `.env` nunca está |
| Front | `firebase deploy` aparte | El mismo build lo publica |
| Variables | Cuidar `--update-env-vars` | El build no toca variables: solo cambia la imagen |

## 2. Lo que trae esta rama (probado en local)

- **`nest-cli.json`**: copia `src/database/migrations/*.sql` a `dist/database/migrations`. Antes la imagen no traía los
  `.sql` y no podía migrar. Probado: `nest build` deja las 44, y `node dist/database/migrate.js` (lo mismo que correrá
  el Job) aplicó las 44 en una base vacía con solo `DATABASE_URL`, `CRM_CALLBACK_API_KEY` y `REPLY_TO_SIGNING_SECRET`;
  la segunda corrida no aplicó nada.
- **`cloudbuild.yaml`**: los pasos de §1. Etiqueta la imagen con el commit (`:<sha corto>`, para volver atrás) y con
  `:v1` (la de siempre). Revisa `/health` antes de publicar el front.

## 3. Una sola vez en Google Cloud (Mich, después de que Fabián revise)

### 3.1 Cuenta de servicio para los deploys

Una propia (`nanobridge-deploy`) y no la de Compute, que hoy usan otros servicios. Solo con lo que necesita:

```bash
P=crm-prospeccion-outbound
gcloud iam service-accounts create nanobridge-deploy --project=$P --display-name="Deploy automático (Cloud Build)"
SA=nanobridge-deploy@$P.iam.gserviceaccount.com
for ROL in roles/run.developer roles/artifactregistry.writer roles/logging.logWriter roles/firebasehosting.admin; do
  gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA --role=$ROL --condition=None
done
# Desplegar la API y el Job "como" nanobridge-api-sa (solo sobre esa cuenta, no sobre todas):
gcloud iam service-accounts add-iam-policy-binding nanobridge-api-sa@$P.iam.gserviceaccount.com \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountUser --project=$P
```

| Rol | Para qué |
|---|---|
| `run.developer` | Desplegar `nanobridge-api` y actualizar y correr el Job (no puede cambiar permisos) |
| `artifactregistry.writer` | Subir la imagen |
| `logging.logWriter` | Los registros del build |
| `firebasehosting.admin` | Publicar el front |
| `iam.serviceAccountUser` **sobre `nanobridge-api-sa`** | Que la API y el Job sigan corriendo con su cuenta de siempre |

La cuenta de deploy **no lee secretos ni entra a la base**: eso lo hace el Job con `nanobridge-api-sa`, que ya tiene
`cloudsql.client` y `secretmanager.secretAccessor`.

### 3.2 El Job de migraciones

Se crea después de unir esta rama, con la primera imagen que ya trae los `.sql` (construida a mano una vez, como hoy):

```bash
gcloud run jobs create nanobridge-migrar --project=$P --region=us-central1 \
  --image=us-central1-docker.pkg.dev/$P/nanobridge-repo/nanobridge-api:v1 \
  --service-account=nanobridge-api-sa@$P.iam.gserviceaccount.com \
  --set-cloudsql-instances=$P:us-central1:nanobridge-db \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,CRM_CALLBACK_API_KEY=CRM_CALLBACK_API_KEY:latest,REPLY_TO_SIGNING_SECRET=REPLY_TO_SIGNING_SECRET:latest \
  --command=node --args=dist/database/migrate.js --max-retries=0 --task-timeout=10m
gcloud run jobs execute nanobridge-migrar --region=us-central1 --project=$P --wait   # debe decir que no hay pendientes
```

Usa el mismo `DATABASE_URL` que la API (por el socket de Cloud SQL), así que no hace falta autorizar ninguna IP.

### 3.3 Conectar GitHub (en el navegador, la dueña del repo)

Cloud Build → Repositorios (2.ª gen.) → **Crear conexión de host** → GitHub, región `us-central1`, nombre `github`.
Autorizar la app de Google Cloud Build en GitHub **solo para `Sheismich/CRM_NANOBRIDGE`** y vincular el repo. Esto lo
tiene que hacer Mich porque el repo es suyo.

### 3.4 El disparador, con aprobación

```bash
gcloud builds triggers create github --project=$P --region=us-central1 --name=deploy-por-tag \
  --repository=projects/$P/locations/us-central1/connections/github/repositories/Sheismich-CRM_NANOBRIDGE \
  --tag-pattern='^v.*' --build-config=cloudbuild.yaml \
  --service-account=projects/$P/serviceAccounts/nanobridge-deploy@$P.iam.gserviceaccount.com \
  --require-approval
```

`--require-approval`: un tag **no despliega solo**. Cloud Build espera a que Mich o Fabián den «Aprobar» en la consola.
Así un tag por error no llega a producción.

## 4. Cómo se despliega después

1. PR con CI en verde, revisado por el otro, unido a `main` (las reglas del plan de pendientes siguen igual).
2. `git tag v2026.11.24-1 <commit de main>` y `git push origin v2026.11.24-1`.
3. En Cloud Build → Historial, **Aprobar** el build. Tarda unos 6 minutos (3 de imagen, el resto migrar, desplegar y front).
4. Anotar la fila en el RUNBOOK §6 como siempre: el tag, la revisión y qué cambió.

**Volver atrás:** `gcloud run services update-traffic nanobridge-api --region=us-central1 --to-revisions=<revisión anterior>=100`.
Las migraciones no se deshacen solas (igual que hoy): una migración que cambie columnas que usa el código viejo se
planea en dos pasos.

**El camino a mano sigue en el RUNBOOK** por si Cloud Build falla.

## 5. Listo cuando

- Un tag de prueba con un cambio inocuo (por ejemplo, un comentario) deja una revisión nueva en Cloud Run con las mismas
  18 variables, el Job dice que no hay migraciones pendientes, `/health` responde 200 y el front se publica.
- Un build sin aprobar no despliega nada.
- Una migración que falla a propósito (en una rama de prueba, contra una base de prueba) detiene el build antes de
  desplegar. ⏳ Decidir con Fabián si vale la pena probarlo así o basta con leer el paso `migrar`.

## 6. Para decidir antes de encender

- ¿Quién aprueba? Propuesta: cualquiera de los dos, pero nunca quien empujó el tag.
- ¿El front en el mismo build? Propuesta: sí; si falla, la API ya quedó desplegada y el front se publica a mano.
- ¿Se borra el camino a mano del RUNBOOK? Propuesta: no, se queda como respaldo hasta el cierre.
- Al cierre (OB-07): pasar la aprobación a alguien de planta.
