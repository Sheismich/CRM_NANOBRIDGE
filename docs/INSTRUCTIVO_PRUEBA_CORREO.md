# Instructivo: mandar un correo de prueba y enseñar el CRM

Para hacer tú solo la demo completa: se manda un correo real desde n8n, se
contesta y la respuesta aparece en el CRM para clasificarla.

Mientras el sistema siga en **modo pruebas**, solo sirve así (MODO_PRUEBAS
y SANDBOX encendidos en PT1).

---

## Antes de empezar (una sola vez por computadora)

- Tener Node instalado y el repo clonado.
- Instalar lo del front: en PowerShell, en la carpeta del repo,
  `npm --prefix frontend install`.

---

## Paso 1. Levantar el CRM (front)

En PowerShell, dentro de la carpeta del repo:

```powershell
$env:VITE_API_URL="https://nanobridge-api-165032456965.us-central1.run.app"; npm --prefix frontend run dev
```

- Abre **http://localhost:5173** y entra con tu usuario de admin.
- Deja esa ventana abierta. Para apagarlo: **Ctrl + C**.
- Ojo: aunque corre en tu compu, está conectado a la **API de producción**.
  Todo lo que hagas ahí es real.

---

## Paso 2. Elegir a quién se lo mandas

**Regla de oro: cada prueba usa una dirección que nunca se haya usado.**

Si repites una, la API responde "ventana activa" y PT1 marca a ese
prospecto como *excluido* para siempre. El correo no sale y esa dirección
ya no sirve para pruebas.

- **Tu Gmail:** agrega una etiqueta nueva, por ejemplo
  `fabiandelirardz+prueba6@gmail.com`. Llega a tu misma bandeja, pero para
  el sistema es una persona distinta. Revisa abajo el
  [registro de direcciones usadas](#registro-de-direcciones-usadas).
- **Otra persona:** su correo tal cual, con su permiso y solo si nunca se
  ha usado.

Anota la dirección en el registro **antes** de mandar.

---

## Paso 3. Mandar el correo (n8n)

Entra a n8n → workflow **"PT1. ingesta y scoring"** → abre el chat de la IA
de n8n y pégale esto, cambiando `CORREO_NUEVO` en los dos lugares:

```
En el workflow "PT1. ingesta y scoring" (borrador), haz una ejecución real igual a la 118, pero a otro destinatario:

1. En el nodo Code "Modo pruebas": agrega "CORREO_NUEVO" a la lista PERMITIDOS (deja las que ya están) y cambia SANDBOX a false. MODO_PRUEBAS se queda en true.
2. Ejecuta el flujo con un prospecto de prueba cuyo correo sea exactamente CORREO_NUEVO (nombre y empresa de prueba). Es un prospecto nuevo: no reutilices ninguno de los anteriores.
3. En cuanto termine, vuelve a poner SANDBOX = true en "Modo pruebas" y guarda.
4. Pásame: número de ejecución, prospecto_id, envío id, el reply_to y el código de respuesta de SendGrid (debe ser 202).
No publiques el workflow.
```

**Si usas tu Gmail con etiqueta** (`+prueba6`), en PERMITIDOS basta tu Gmail
normal, que ya está en la lista, porque la etiqueta se ignora al comparar.
En ese caso puedes quitar la parte de "agrega a PERMITIDOS".

### Cómo saber si salió bien

Revisa el resumen de la IA:

| Lo que ves | Qué significa |
|---|---|
| SendGrid **202** | Se mandó de verdad ✅ |
| SendGrid **200** | SANDBOX seguía encendido: SendGrid lo aceptó pero **no lo entregó**. Esa dirección ya se gastó; usa otra. |
| "Modo pruebas: destinatario fuera de la lista" | La dirección no está en PERMITIDOS. |
| "ventana activa" / excluido | La dirección ya se había usado. Usa otra. |

### Revísalo tú mismo (importante)

Abre el nodo **"Modo pruebas"** y confirma con tus ojos que dice
`const SANDBOX = true;`. Si se quedó en `false`, cámbialo tú y guarda.

---

## Paso 4. Ver el correo

- Busca en la bandeja del destinatario. Si no aparece en Principal, revisa
  **Promociones** y **Spam**.
- Para comprobar que va firmado: en Gmail abre el correo → **⋮ → Mostrar
  original**. Arriba deben salir `SPF: PASS`, `DKIM: PASS` y `DMARC: PASS`.
- Si se lo vas a enseñar a alguien, aclara que **el texto es provisional**.
  Todavía falta la redacción final y el pie legal con el link de baja
  visible.

---

## Paso 5. Contestar y verlo en el CRM (la mejor parte de la demo)

1. Desde el correo que lo recibió, **contesta** con cualquier texto, por
   ejemplo "Me interesa, ¿me dan más información?".
2. Espera unos segundos. En n8n, workflow **"PT2. respuestas (Inbound
   Parse)"** → pestaña **Executions**: debe aparecer una ejecución nueva en
   verde.
   (PT3 **no** se dispara con respuestas: solo con bajas, rebotes y
   marcas de spam. Que PT3 esté quieto es lo normal.)
3. En el CRM: **Tareas → Cola de clasificación**. Ahí está la respuesta.
   Clasifícala, por ejemplo como "interesado".
4. Puedes enseñar también **Prospectos** y **Empresas**: ahí aparece el
   prospecto de prueba con su historial.

---

## Lo que NO hay que hacer

- ❌ **No des clic en "cancelar suscripción"** del correo, salvo que
  quieras enseñar las bajas a propósito. Esa dirección queda bloqueada para
  siempre, en el CRM y en SendGrid.
- ❌ No reutilices direcciones (Paso 2).
- ❌ No dejes SANDBOX en `false` al terminar.
- ❌ No publiques PT1: sigue en borrador a propósito.
- ❌ En SendGrid, no uses el botón **"Test Integration"** del Event
  Webhook: mete correos falsos a la lista de supresión de producción.
- ❌ No pegues contraseñas ni llaves en ningún chat, ni con la IA de n8n
  ni conmigo.

---

## Si algo falla

| Síntoma | Qué revisar |
|---|---|
| El front no carga o no deja entrar | Que la ventana de PowerShell siga abierta y que hayas puesto `VITE_API_URL` en el mismo comando. |
| El correo no llega | Spam/Promociones; luego el código de SendGrid en el resumen (¿200 en vez de 202?). |
| Contesté y no aparece en el CRM | Executions de PT2 en n8n. Si hay una en rojo, abre el workflow de errores (B4) o mándale la captura a Claude. |
| La respuesta aparece como "Respuesta no identificada" | Contestaste a otro correo o se perdió la dirección de respuesta. Contesta el correo original con "Responder", no reenviar. |

---

## Registro de direcciones usadas

Cada fila es un prospecto de prueba en producción. **No se borran filas de
la base de datos**: al final se limpian cerrando sus ventanas.

| Dirección | Fecha | Notas |
|---|---|---|
| fabiandelirardz+prueba1@gmail.com | 29-sep-2026 | prospecto 26 |
| fabiandelirardz+prueba2@gmail.com | 29-sep-2026 | prospecto 27 |
| fabiandelirardz+prueba3@gmail.com | 29-sep-2026 | prospecto 28; se gastó en sandbox (200) |
| fabiandelirardz+prueba4@gmail.com | 29-sep-2026 | prospecto 29, envío 14; contestado y dado de baja (suprimido) |
| | | |
