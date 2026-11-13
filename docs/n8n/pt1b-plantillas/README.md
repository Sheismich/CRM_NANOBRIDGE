# PT1, PT4 y PT1b: el texto del correo sale de la API (19-oct-2026)

Etapa 1 de las mejoras: los correos de prospección se escriben en el CRM
(Administración → Correos de prospección). Desde la API con la migración 033,
`POST /automatizacion/envios` regresa, además de lo de siempre, el correo ya
armado:

```json
"correo": { "asunto": "…", "texto": "…", "html": "<p>…</p>" }
```

Viene también cuando la respuesta es `ya_existia: true` (mismo texto). Toca el
contacto que sigue de la persona: 1 = correo inicial, 2 = recordatorio 1,
3 = recordatorio 2. El pie (domicilio, aviso de privacidad) ya viene dentro;
el link de baja lo sigue poniendo SendGrid (`subscription_tracking`, no se
toca).

**Nombre del campo en n8n: `correo_contenido`.** En PT1b ya existía `correo`
(la dirección del prospecto, el destinatario), así que el texto armado viaja
como `correo_contenido` (decidido al aplicar el prompt 1, 19-oct-2026).

**Orden:** primero el deploy de la API (con la 033). Luego los prompts 1 y 2,
y al final el 3. Hasta que PT1b use `correo_contenido`, el campo de más no estorba.

## Prompt 1 · PT1 (flujo "PT1. ingesta y scoring")

> En este flujo, el nodo HTTP que hace POST a `/automatizacion/envios` ahora
> regresa un campo `correo` (objeto con `asunto`, `texto` y `html`). En el
> nodo que llama al subflujo PT1b (Execute Workflow, o el Code "Datos para el
> envío" que arma sus datos), agrega el campo `correo_contenido` con el valor
> `{{ $('NOMBRE_DEL_NODO_POST_ENVIOS').item.json.correo }}`, junto a
> `reply_to`. No cambies nada más.

(Cambia `NOMBRE_DEL_NODO_POST_ENVIOS` por el nombre real del nodo, o deja
que la IA de n8n lo encuentre.)

## Prompt 2 · PT4 (recordatorios)

> Igual que en PT1: el nodo HTTP que hace POST a `/automatizacion/envios`
> regresa `correo` (objeto con `asunto`, `texto` y `html`). En los datos que
> se le pasan al subflujo PT1b agrega `correo_contenido` con el valor del
> campo `correo` de esa respuesta (no cambies el campo `correo` que ya existe:
> es la dirección del prospecto), junto a `reply_to`. No cambies nada más.

## Prompt 3 · PT1b, nodo "Armar correo SendGrid"

> En el subflujo PT1b, si el disparador (Execute Workflow Trigger) tiene
> campos definidos, agrega uno llamado `correo_contenido` de tipo objeto (no
> toques `correo`, que es la dirección del destinatario). Luego, en el
> nodo Code "Armar correo SendGrid", quita el asunto y el texto temporales
> ("correo de PRUEBA") y usa lo que llega en `correo_contenido`:
>
> ```js
> const c = d.correo_contenido;
> if (!c || !c.asunto || !c.texto || !c.html) {
>   throw new Error('Falta el correo armado por la API (campo correo de POST /envios)');
> }
> // subject: c.asunto
> // content: [{ type: 'text/plain', value: c.texto }, { type: 'text/html', value: c.html }]
> ```
>
> Pon `c.asunto` en `subject` y esos dos valores en `content`, en el mismo
> orden que ya tenía (primero text/plain, luego text/html). Deja igual el
> `reply_to`, el `from`, el `subscription_tracking` y lo demás.

Si el nodo no usa la variable `d` para los datos de entrada, la IA de n8n la
ajusta; lo importante es que el texto salga de `correo_contenido` y que, si no llega,
el flujo falle (lo atrapa B4) en lugar de mandar un correo vacío.

## Prueba

Con `MODO_PRUEBAS` encendido, un correo nuevo a `+prueba12`:
1. Cambiar el asunto del "Correo 1" en Administración (ej. agregar "(v2)").
2. Correr PT1 con ese prospecto.
3. El correo que llega trae el asunto y el texto de la pantalla, con el
   primer nombre y la empresa cambiados, y el link de baja al final.

## Prompt 4 · PT1b, link de baja dentro del pie (22-oct-2026)

Desde el molde nuevo del correo (opción A de `docs/diseno/correo-diseno.html`)
el html y el texto que regresa la API ya traen la línea "¿Ya no quiere recibir
estos correos? Darte de baja" dentro del pie, con la etiqueta
`[darte_de_baja]` donde va el link. SendGrid cambia esa etiqueta por su URL de
baja si se lo pedimos con `substitution_tag`. Por eso PT1b deja de pegar su
propio pie (`text`/`html` del `subscription_tracking`).

**Orden:** este cambio va JUSTO DESPUÉS del deploy de la API que trae el molde.
Antes del deploy, SendGrid no encontraría la etiqueta y el correo saldría sin
link de baja. Después del deploy pero sin este cambio, el correo saldría con
`[darte_de_baja]` a la vista y con dos pies. No hacerlo cerca de las 10:00 de
un día hábil (PT4 corre solo a esa hora).

> En el subflujo PT1b, nodo Code "Armar correo SendGrid", cambia
> `tracking_settings.subscription_tracking` para que quede exactamente así
> (quita sus campos `text` y `html`):
>
> ```js
> subscription_tracking: { enable: true, substitution_tag: '[darte_de_baja]' }
> ```
>
> No cambies nada más (ni `content`, ni `click_tracking`, ni `open_tracking`).

**Prueba:** correr PT1a con un prospecto de prueba (`+pruebaN`). El correo
llega con la firma con logo, el pie gris y "Darte de baja" como link (al pasar
el mouse debe apuntar a SendGrid, no decir `[darte_de_baja]`), y sin un
segundo pie al final.

## Prompt 5 · PT1b, el link de baja ya no es de SendGrid (13-nov-2026)

El 12-nov dos prospectos con correo en Microsoft 365 quedaron en baja 7
segundos después de recibir el correo: el escáner de seguridad de Microsoft
abre todos los links, y el de SendGrid da de baja con solo abrirlo. Desde la
API con la página de baja propia (`src/baja/`), el html y el texto que regresa
`POST /automatizacion/envios` ya traen el link completo y firmado
(`…/api/v1/baja/<prospecto>.<firma>`), que lleva a una página con el botón
"Confirmar baja". SendGrid ya no tiene que poner nada.

**Orden:** primero el deploy de la API, luego este cambio. Con PT1a pausada no
sale nada a medias. PT4 usa el mismo subflujo: queda arreglado con este cambio.

> En el subflujo PT1b, nodo Code "Armar correo SendGrid", cambia
> `tracking_settings.subscription_tracking` para que quede exactamente así:
>
> ```js
> subscription_tracking: { enable: false }
> ```
>
> No cambies nada más (ni `content`, ni `click_tracking`, ni `open_tracking`).

**Prueba:** correr PT1a con un prospecto de prueba (`+pruebaN`).
1. En el correo, "Darte de baja" apunta a
   `crm-prospeccion-outbound.web.app/api/v1/baja/…` (no a SendGrid).
2. Abrir el link: sale la página con el botón y el prospecto SIGUE activo en
   el CRM.
3. Apretar "Confirmar baja": el prospecto queda en baja, sus medios en "no
   contactar" y el Historial dice "Baja confirmada en la página de baja".
4. En SendGrid → Activity ese correo no tiene evento "Unsubscribe".

Los correos que salieron antes de este cambio conservan el link de SendGrid:
PT3 sigue igual y atiende esas bajas.
