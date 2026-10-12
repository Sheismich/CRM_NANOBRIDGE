# Prompt para Google Stitch

Cómo usarlo:

1. En Stitch sube los logos (ya los subiste) y las capturas `01-login.png` … `11-administracion.png` de esta carpeta. Stitch entiende mejor las imágenes que el HTML; el archivo `todas-las-pantallas.html` es para que tú y quien quieras vean todo junto.
2. Pega primero el **PROMPT BASE** con la captura de Inicio (`02-inicio-aprobado.png`). Con eso fija el estilo.
3. Luego ve pantalla por pantalla con su captura y su **prompt corto** (abajo). Stitch se confunde si le pides las 11 de un jalón.
4. Va en inglés porque Stitch le atina mejor así; los textos de la pantalla le pido que los deje en español.

---

## PROMPT BASE (pegar una vez, con la captura de Inicio)

```
Redesign this B2B CRM web app called NANOBRIDGE so it stops looking like a generic SaaS template. It is used daily by a small Mexican sales team (admin, supervisor, agents) to prospect companies by email, track opportunities, quotes and documents. All UI text must stay in Mexican Spanish exactly as in the screenshots. Keep every section, number, column and action that exists — improve the look, hierarchy and personality, do not remove features.

BRAND
- Logo: the "N" made of circuit traces (attached). Use it as the identity seed: thin circuit lines, nodes and connection dots as a subtle signature motif (in empty states, card corners at very low opacity, dividers, loading states) — never as busy decoration over data.
- Colors: navy #2a449b, deep purple #5b2d86, cyan #23bad3, mint #41e198, lavender #a796e6. Light background #eef1f9, panels #ffffff, text #151c36. Dark mode: background #0a0f1e, panels #10172d, text #dfe5f7.
- Signature gradient: navy → purple, used ONLY on the top hero band of each screen and the primary button. Mint/cyan are for positive data and live states, not decoration.
- Typography: a condensed bold display face (like Anton) only for big numbers and page titles; Manrope for everything else. Use tabular numbers for money and counts.

ALREADY APPROVED (keep it, build the rest around it)
- Home ("Inicio"): rounded hero band with the navy→purple gradient, a large faded "N" watermark, greeting and 4 big KPIs. Below it, cards with soft relief shadows (no borders), a soft tinted header strip per card (mint, cyan, lilac) and icons inside a sunken circle.
- Light and dark mode on every screen (sun/moon toggle at the bottom of the sidebar).
- Mobile: bottom navigation bar like a native app, single column.

WHAT TO FIX — WHY IT FEELS GENERIC
- Every screen is the same "white card + gray label + big number" grid. Give each screen ONE hero element that is unique to its job (described per screen) and make everything else quieter.
- Stronger hierarchy: one dominant thing per screen, fewer equal-weight boxes, more whitespace between groups and less inside them.
- Sidebar is plain text with gray dots. Make it feel branded: proper icons, an active state with a small glowing mint node (like a lit circuit point), badges for pending counts.
- Status colors must mean something and be consistent across all screens: mint = good/active, cyan = in progress/new, amber = waiting/attention, red = overdue/do-not-contact, lavender = neutral/closed.
- Add micro-details that make it feel crafted: avatar initials with color per person, relative times ("hace 2 h"), subtle hover lift on cards, skeleton loading in brand colors, friendly empty states with the circuit "N".
- Dense data stays dense (tables, lists): good row height, aligned numbers, sticky headers, no zebra noise.

Output: desktop 1440px wide, light mode first. Then show the same screen in dark mode and on mobile (390px).
```

---

## PROMPTS CORTOS POR PANTALLA (uno a la vez, con su captura)

**01 · Login**
```
Login screen, same style. Keep the "living circuit" idea: animated light pulses traveling along circuit traces behind a centered login card (email, password, "Entrar"). Make the circuit come out of the N logo so it feels like the brand, not wallpaper. Day and night versions, and a mobile version with its own vertical circuit.
```

**02 · Inicio** (ya aprobado: solo pulir)
```
Home screen. This one is approved — only polish it: refine spacing, typography and the chart, keep the hero band, the card style and every section exactly. Make the "Correos enviados por día" chart the hero below the band.
```

**03 · Tareas · Mi día**
```
Tasks screen "Mi día". The hero is the big "next task" card (white in light mode with a faded N watermark; navy in dark mode) with Hecha / Reprogramar / Saltar. Make it feel like a focus mode: the next task is huge, "Después" is a calm timeline by hour, the right column has progress ring, "respuestas por clasificar" and team tasks with "Tomar". "Ver todas" opens a list + detail view — design that view too.
```

**04 · Prospectos**
```
Prospects screen. The hero is the funnel of status cards (capturado, validado, interesado, etc.) — make it read as a real flow from left to right, connected by circuit lines, each card with its count and a tiny trend. Below it, the list with campaign, company and how many emails each prospect has received. Tabs Importaciones and Campañas stay.
```

**05 · Empresas**
```
Companies screen. Counters on top, then the list with a Lista | Tarjetas toggle. Each company shows how its prospecting is going and "the last thing that happened" (reply, email sent, activity) with an icon and relative time — make that last-activity column the visual protagonist. Also design the company detail with a unified history timeline and the documents checklist.
```

**06 · Oportunidades**
```
Opportunities screen: kanban board fused with a funnel. Above each stage column, a bar whose height is the money in that stage (lighter part = weighted by probability). Cards show value, owner avatar, days in stage and close date; overdue in red. Make the money funnel feel premium — this is the screen the boss looks at. Dragging to "Perdida" asks for a reason.
```

**07 · Contactos**
```
Contacts screen with Lista | Tarjetas toggle. Each person shows their email/phone/WhatsApp as colored chips: mint = can write, red = do not contact, amber = no valid channel. Counters on top for those three groups. Make the cards version feel like people, not rows (avatar, role, company, prospecting status).
```

**08 · Cotizaciones**
```
Quotes screen: board by status (Borradores, Enviadas, Aceptadas, Rechazadas, Vencidas). Clicking a quote opens it as a real paper document preview with the NANOBRIDGE logo, items and totals. "+ Nueva cotización" opens a step-by-step editor. Make the document preview look like a premium printed quote.
```

**09 · Documentos**
```
Documents screen: a review inbox ("Por revisar" first, then approved and rejected). Clicking a document opens a large inline preview with Aprobar / Rechazar. Make it feel like an inbox you can clear fast: keyboard-like flow, clear status, file type icons.
```

**10 · Reportes**
```
Reports screen "panel completo": KPI tiles with comparison vs last month and sparklines, conversion by stage, forecast by month, prospecting by day, tasks by type, performance per agent. Give each chart one clear takeaway sentence in its header, and use the brand palette consistently (navy, cyan, mint, purple, amber). It should feel like an executive dashboard, not a template.
```

**11 · Administración**
```
Admin screen as a "control center": system health cards with traffic-light status (API, base de datos, avisos a n8n, SendGrid), problems grouped by cause with a "reintentar" action, recent activity written as sentences, and team & roles. Make the health area feel alive (pulsing mint dot when OK, circuit lines connecting the four services).
```
