# Inventario de accesos · CRM NANOBRIDGE

**Para:** la transferencia operativa (OB-07): quién tiene acceso a qué, qué depende de cuentas de los pasantes y qué hay
que pasar a alguien de planta antes del cierre (9-dic-2026).
**Versión:** 0.9 · 4 de noviembre de 2026. Los permisos de Google Cloud se leyeron del proyecto ese día; lo marcado
⏳ hay que confirmarlo con quien administra esa cuenta.

Aquí no hay contraseñas ni llaves: solo dónde viven y quién las puede leer.

## 1. Lo que hay que hacer antes del cierre

| # | Qué | Por qué | Quién |
|---|---|---|---|
| 1 | Dar acceso de administrador a alguien de planta en **SendGrid** (Teammate) y en **n8n Cloud** | Hoy las dos cuentas dependen de los pasantes | Dirección y T2 |
| 2 | Cambiar **a quién avisan** las fallas (B4), las respuestas (PT2) y la caída de la API (Cloud Monitoring) | Hoy llegan al Gmail de Fabián y a las cuentas de los pasantes | T2 |
| 3 | Quitar o bajar los permisos de **pasante.tics001** y **pasante.tics002** en Google Cloud, una vez entregado todo | Tienen editor, leen los secretos y una puede cambiar permisos | Dueño del proyecto |
| 4 | **Rotar los secretos** que leyeron los pasantes (§3) después de quitarles el acceso | Quien los leyó los puede seguir usando | Dueño del proyecto, con el RUNBOOK §7 |
| 5 | Pasar el **repositorio de GitHub** a una cuenta u organización de la empresa, y hacerlo privado | Hoy es la cuenta personal de Mich y es público | Mich y Dirección |
| 6 | Dar de alta en el **CRM** a los administradores de planta y desactivar las cuentas de prueba y de pasantes | Las cuentas del CRM son de personas | Administrador del CRM |
| 7 | Cambiar el **remitente** de SendGrid (hoy con el domicilio de Fabián) por el de la empresa | Va en cada correo | T2 con el domicilio de Carlos |

## 2. Google Cloud · proyecto `crm-prospeccion-outbound`

Donde viven la API (Cloud Run), la base (Cloud SQL), los documentos (Cloud Storage), las imágenes (Artifact Registry),
los secretos (Secret Manager), los avisos (Cloud Monitoring) y la página del CRM (Firebase Hosting, en el mismo
proyecto). Detalle de cada pieza en el RUNBOOK, §3.

**Personas con acceso** (leído el 4-nov-2026):

| Cuenta | Quién es | Permisos | Qué hacer al cierre |
|---|---|---|---|
| `director.general@nano-bridge-mex.com` | Dirección | **Dueño** (owner): todo | Se queda. Es el único que puede cambiar las políticas de la organización (RUNBOOK §4) |
| `pasante.tics001@nano-bridge-mex.com` | Mich (T1) | Editor y lectura de secretos | Quitar o pasar a alguien de planta |
| `pasante.tics002@nano-bridge-mex.com` | Fabián (T2) | Editor, lectura de secretos, administrador de Cloud Run, **puede cambiar permisos del proyecto** y crear tokens de cuentas de servicio | Quitar o pasar a alguien de planta |

**Cuentas de servicio** (las usan los programas, no las personas):

| Cuenta | Para qué | Permisos |
|---|---|---|
| `nanobridge-api-sa` | La API en Cloud Run | Conectarse a Cloud SQL y leer los secretos |
| `firebase-adminsdk-fbsvc` | Firebase | Las de Firebase |
| Agentes de Google (compute, Cloud Run, Container Registry) | Los crea Google | Los suyos; no se tocan |

## 3. Secretos (Secret Manager)

Los leen las tres personas de §2 y la cuenta de la API. Cómo consultarlos o rotarlos: RUNBOOK §7.

| Secreto | Para qué | Si se rota |
|---|---|---|
| `DATABASE_URL` | La API entra a la base | Cambiar también la contraseña de `appuser` en Cloud SQL (RUNBOOK §6) |
| `CRM_CALLBACK_API_KEY` | Llave con la que n8n llama a la API | Cambiarla también en la credencial «Nanobridge-ApiKey» de n8n |
| `WEBHOOK_ENTRADA_API_KEY` | Llave para que la API llame a n8n (B3, sin usar) | Sin efecto hoy |
| `REPLY_TO_SIGNING_SECRET` | Firma el Reply-To de cada correo | **Las respuestas a correos ya enviados llegan como «no identificadas»**: rotarlo solo si se filtró |
| `SENDGRID_API_KEY` | La API manda avisos, respuestas y cotizaciones | Crear la llave nueva en SendGrid primero |
| `GEMINI_API_KEY` | La IA del CRM (borrador y resumen) | Crear la llave nueva en Google AI Studio primero |

## 4. Base de datos (Cloud SQL `nanobridge-db`)

- La API entra con el usuario `appuser` (contraseña en `DATABASE_URL`).
- Los dos usuarios `root` tienen contraseñas al azar que nadie vio (8-oct-2026); si hace falta, el dueño del proyecto
  les pone otra con `gcloud sql users set-password`.
- **No hay IPs autorizadas** (revisado el 4-nov): para migrar se autoriza la IP solo mientras dura (RUNBOOK §6).

## 5. n8n Cloud

| Qué | Dónde | Estado |
|---|---|---|
| Cuenta | n8n Cloud de Fabián | ⏳ Confirmar el correo de la cuenta y dar acceso a alguien de planta |
| Flujos | PT1a, PT1, PT1b, PT2, PT2a, PT3, PT4, PT5 y B4 | Copia de referencia del código en `docs/n8n/` |
| Credenciales guardadas en n8n | «Nanobridge-ApiKey» (la `CRM_CALLBACK_API_KEY`), «SendGrid account» y la llave de Gemini de n8n | Viven dentro de n8n; si se rota una, se cambia ahí |
| Avisos | `DESTINOS` en B4 («armar correo de error») y en PT2 («armar aviso de respuesta») | Hoy al Gmail de Fabián: cambiarlos (§1, punto 2) |

## 6. SendGrid

| Qué | Estado |
|---|---|
| Cuenta | La de `pasante.tics002@nano-bridge-mex.com` (decidido el 22-oct-2026). El jefe tiene acceso a ese correo |
| Plan | Prueba que vence el 24-nov; Carlos confirmó el pago (4-nov) |
| Dominio | `contacto.nano-bridge-mex.com`, verificado; respuestas en `respuestas.contacto.nano-bridge-mex.com` |
| Inbound Parse y Event Webhook | Apuntan a n8n (PT2 y PT3) |
| Llaves | Una para n8n (en su credencial) y otra para la API (`SENDGRID_API_KEY`) |
| Remitente | Con el domicilio de Fabián; cambiarlo por el de la empresa (§1, punto 7) |
| Pendiente | Dar de alta a alguien de planta como Teammate administrador |

## 7. Dominio y DNS

`nano-bridge-mex.com` está en **Squarespace Domains**; el acceso lo tiene el jefe de Fabián. Ahí están los registros
de SendGrid (autenticación del dominio y el MX de respuestas, 29-sep-2026). ⏳ Confirmar quién más tiene acceso.

## 8. Google AI Studio (Gemini)

Dos llaves en el mismo proyecto de pago: una para n8n (score y sugerencia de clasificación) y otra para el CRM
(`GEMINI_API_KEY`). ⏳ Confirmar en qué cuenta de Google está el proyecto de AI Studio y quién lo administra.

## 9. GitHub

| Qué | Estado |
|---|---|
| Repositorio | `Sheismich/CRM_NANOBRIDGE`, en la cuenta personal de Mich. **Público** |
| Quién sube cambios | Mich y Fabián (⏳ confirmar si Fabián es colaborador o sube con otra cuenta) |
| GitHub Actions | Corre las pruebas en cada cambio, con permisos de solo lectura y sin secretos |
| Al cierre | Transferirlo a una cuenta u organización de la empresa y hacerlo privado (§1, punto 5) |

## 10. Usuarios del CRM

Se administran en el CRM: Administración → Usuarios (solo administradores). El primer administrador se creó una sola
vez con `/auth/bootstrap`, que ya no acepta otro. Al cierre: dar de alta a los administradores de planta, desactivar
las cuentas de prueba y las de los pasantes, y borrar los datos de ejemplo (`limpiar-datos-prueba.mjs`).

## 11. Cosas que se usan desde la compu de quien despliega

- **gcloud** con una cuenta de §2 (la sesión vence seguido; RUNBOOK y el manual operativo dicen cómo volver a entrar).
- **Firebase CLI** (`npx firebase-tools`), con la misma cuenta, para publicar el front.
- El build se hace desde una copia limpia del commit (`git archive`), para no subir archivos locales como `.env`.
