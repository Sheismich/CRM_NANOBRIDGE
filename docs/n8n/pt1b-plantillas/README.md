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

**Orden:** primero el deploy de la API (con la 033). Luego los prompts 1 y 2,
y al final el 3. Hasta que PT1b use `correo`, el campo de más no estorba.

## Prompt 1 · PT1 (flujo "PT1. ingesta y scoring")

> En este flujo, el nodo HTTP que hace POST a `/automatizacion/envios` ahora
> regresa un campo `correo` (objeto con `asunto`, `texto` y `html`). En el
> nodo que llama al subflujo PT1b (Execute Workflow, o el Code "Datos para el
> envío" que arma sus datos), agrega el campo `correo` con el valor
> `{{ $('NOMBRE_DEL_NODO_POST_ENVIOS').item.json.correo }}`, junto a
> `reply_to`. No cambies nada más.

(Cambia `NOMBRE_DEL_NODO_POST_ENVIOS` por el nombre real del nodo, o deja
que la IA de n8n lo encuentre.)

## Prompt 2 · PT4 (recordatorios)

> Igual que en PT1: el nodo HTTP que hace POST a `/automatizacion/envios`
> regresa `correo` (objeto con `asunto`, `texto` y `html`). En los datos que
> se le pasan al subflujo PT1b agrega `correo` con el valor de esa respuesta,
> junto a `reply_to`. No cambies nada más.

## Prompt 3 · PT1b, nodo "Armar correo SendGrid"

> En el subflujo PT1b, si el disparador (Execute Workflow Trigger) tiene
> campos definidos, agrega uno llamado `correo` de tipo objeto. Luego, en el
> nodo Code "Armar correo SendGrid", quita el asunto y el texto temporales
> ("correo de PRUEBA") y usa lo que llega en `correo`:
>
> ```js
> const c = d.correo;
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
ajusta; lo importante es que el texto salga de `correo` y que, si no llega,
el flujo falle (lo atrapa B4) en lugar de mandar un correo vacío.

## Prueba

Con `MODO_PRUEBAS` encendido, un correo nuevo a `+prueba12`:
1. Cambiar el asunto del "Correo 1" en Administración (ej. agregar "(v2)").
2. Correr PT1 con ese prospecto.
3. El correo que llega trae el asunto y el texto de la pantalla, con el
   primer nombre y la empresa cambiados, y el link de baja al final.
