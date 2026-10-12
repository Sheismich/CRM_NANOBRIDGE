# Diseño del CRM

## Inicio — aprobado el 9-oct-2026

`inicio-aprobado.html` es un prototipo suelto: se abre con doble clic, no está conectado al backend y todos los números son de ejemplo. El botón de sol y luna (abajo del menú; en celular, en la barra de arriba) cambia entre modo día y oscuro.

Lo que se aprobó:

- **Franja azul de arriba**, como tarjeta redondeada: degradado azul marino → morado, la N de marca de agua, saludo y 4 números grandes (contactadas, respondieron, interesados, tasa de respuesta). Es igual en los dos modos.
- **Debajo, tarjetas con relieve + encabezado de color**: sombras suaves sin bordes, íconos en círculo hundido, franja suave en cada encabezado (menta en la gráfica, cyan en "Lo que acaba de pasar", lila en campañas).
- **Contenido**: gráfica "Correos enviados por día" (con eje de valores y el número de hoy), "Lo que acaba de pasar", campañas con su tasa de respuesta y el pipeline abierto.
- **Celular**: barra de navegación abajo, tipo app, y todo en una columna.

Se descartó el estilo "circuito" (trazo en la esquina de las tarjetas).

## Datos que el backend todavía no entrega

La gráfica por día, el "+N hoy" y "Lo que acaba de pasar" necesitan endpoints nuevos. Los datos ya se guardan: `envios.enviado_en`, y en `respuestas`, `recibido_en` y `clasificacion`. La comparación contra el mes anterior sale llamando dos veces a `GET /reportes/prospeccion`.

## Archivos

- `capturas/`: Inicio en compu (día y oscuro) y en celular.
- `logos/`: la N sola y el logo completo, en color (para fondo claro) y en claro (letras blancas, para fondo oscuro). Salen del `print_transparent.svg` original de la empresa.

## Demás pantallas — elegidas por Fabián el 9-oct-2026 (falta enseñarlas al jefe)

Todas son prototipos sueltos (doble clic, datos de ejemplo, botón sol/luna). Si traen una barra negra abajo, sirve para cambiar de vista dentro del prototipo; no es parte del diseño.

- `tareas.html` — elegida la opción **3 · Mi día** (tarjeta con la siguiente tarea, con marca de agua de la N en día y noche); "Ver todas" abre la opción **6 · Lista + detalle**.
- `prospectos.html` — embudo de tarjetas por estado + lista; alta en panel lateral; pestañas Importaciones y Campañas.
- `empresas.html` — contadores + lista, con selector **Lista | Tarjetas**; ficha de empresa con historial unificado.
- `oportunidades.html` — **tablero + embudo**: barra de dinero arriba de cada etapa y tarjetas abajo; arrastrar entre etapas (perder pide motivo, ganar pide confirmación).
- `contactos.html` — lista con medios en color (verde activo, rojo no contactar, ámbar sin medio), selector **Lista | Tarjetas**.
- `cotizaciones.html` — tablero por estado; clic abre la cotización como documento; "+ Nueva cotización" abre el editor por pasos.
- `documentos.html` — bandeja de revisión; clic abre la vista previa; el expediente (checklist de papeles) va dentro de la ficha de empresa.
- `reportes.html` — elegida la opción **A · Panel completo** (indicadores con comparación vs mes anterior, conversión, forecast, prospección, tareas y agentes en una pantalla). La barra de abajo muestra las otras opciones que se descartaron.
- `administracion.html` — **centro de control**: estado del sistema con semáforos y tarjetas (API, base de datos, avisos a n8n, SendGrid), problemas agrupados por causa, actividad reciente escrita en frases, equipo y roles.
- `login.html` — elegido **Circuito vivo**: pulsos de luz animados por trazos de circuito (se quedan quietos si el sistema tiene las animaciones apagadas), tarjeta al centro, modo día y noche, y un circuito propio para celular. `login-opciones.html` y `login-opcion-partida.html` son las opciones que se descartaron.

Ya están elegidas todas las pantallas. Lo que el backend tiene que agregar para estas pantallas está en la lista de pendientes de Fabián.

## Ajuste a Inicio — 11-oct-2026 (Fabián)

La fila de abajo de Inicio queda con **Campañas** (ancha, a la izquierda) y **Pipeline abierto** a la par (angosta, a la derecha), con el mismo estilo de tarjetas que ya está aprobado:

- **Campañas:** una fila por campaña con nombre, chip de estado (Activa en verde, Pausada en ámbar), "N contactadas · N respondieron", barra de avance y la tasa de respuesta en grande a la derecha.
- **Pipeline abierto:** monto grande, "N oportunidades · $ ponderado · N ganadas · N perdidas este mes", barra de "Probabilidad calculada" con su % y el botón **"Crear nueva oportunidad"** (degradado azul → morado) abajo.

## Ajustes del 11-oct-2026 (Fabián, tomados de Stitch)

- **Tareas · Mi día** (`tareas.html`, opción 3): acomodo nuevo. Hay chips con ícono para la empresa, el contacto y la campaña. La caja **"Lo que contestó"** muestra el correo del prospecto y la clasificación de la IA. Junto a los botones va el teléfono, y la columna derecha tiene el anillo con "↗ Vas bien · 33% completado" y el panel morado de la automatización. Capturas: `capturas/tareas-mi-dia-*.png`.
- **Oportunidades** (`oportunidades.html`): abajo del tablero va una franja con la **tasa de conversión** y el **tiempo promedio para cerrar**, y con el **informe ejecutivo** en PDF y en CSV.
- **Informe ejecutivo** (`informe-ejecutivo.html`): así saldría el PDF. Es una hoja carta con la N de marca de agua atrás, logo, resumen del mes, conversión, forecast, prospección y desempeño por agente. El CSV trae los mismos números en renglones.
- **Documentos** (`documentos.html`):
  - En lugar de la zona de "arrastra aquí" hay dos botones arriba, **Descargar lote** y **Subir documento**.
  - Los documentos se **aprueban o rechazan**, y el rechazo lleva su motivo. Los contadores son Por revisar, Aprobados, Expedientes incompletos y Rechazados.
  - Al dar clic en un documento se abre el panel. Arriba dice "Pendiente de aprobación" y trae los botones Rechazar y Aprobar; abajo de la vista previa sale el **resumen del expediente** de esa empresa, con 5 tarjetitas.
  - Al dar clic en el **nombre de la empresa** en la lista, o en cualquier tarjetita del resumen, se va al **expediente en la ficha de la empresa**, que tiene un "← Documentos" para regresar.
  - Capturas: `capturas/documentos-*.png`.
  - Al **rechazar** sale una ventana que pide el motivo: se elige uno rápido (ilegible, vencido, incompleto, no es de esta empresa, tipo equivocado u otro) y hay que **explicarlo por escrito, es obligatorio**. Captura: `capturas/documentos-rechazo.png`.
- **Reportes** (`reportes.html`, opción A): mismo diseño, y además cada gráfica lleva **una frase que la explica** (franja azul abajo del título) y **dos datos al pie** (por ejemplo, ciclo medio de venta y la etapa donde más se caen). Captura: `capturas/reportes-con-frases.png`.
- **Reportes · Día** (`reportes.html`, al dar clic en "Día" arriba; "Mes" regresa al panel). Se elige una fecha con ‹ › y "Hoy". Trae 5 números del día (correos, respuestas, tareas cerradas, tareas creadas, bajas), un aviso de "cosas para revisar" (tareas que vencieron sin cerrar, fallas del sistema) y la **bitácora del día**: todo en orden de hora, con filtros por tipo y persona; las incidencias van en rojo. A la derecha, **por persona** (de qué hora a qué hora trabajó, cuántas cerró o tomó y cuántas se le vencieron) y **quedó pendiente** (lo que vencía ese día y no se cerró). Capturas: `capturas/reportes-dia*.png`.
- **Administración** (`administracion.html`): "Actividad reciente" se cambió por **"Registro de cambios"**, que solo ven los administradores. Muestra quién movió qué: cambios de rol, ediciones con **antes → después**, borrados y bajas (con "Ver cómo estaba"), descargas, altas de usuarios y cambios de configuración. Tiene filtros por tipo y búsqueda por usuario o registro. El trabajo del día ya no va ahí: está en Reportes → Día. Captura: `capturas/administracion-registro-cambios.png`.
- **Administración · arriba y Equipo** (11-oct): la franja azul con la N de marca de agua ahora trae los **4 servicios conectados** (API, base de datos, avisos a n8n, correos). Cada uno dice qué tan rápido responde o cuánto lleva, y tiene su semáforo; el que falla se ilumina en ámbar. Hay un "Revisado hace N s" y arriba el botón "Exportar registro de cambios". **Equipo y Roles se juntaron** en una tarjeta: niveles de acceso con cuántos usuarios tiene cada uno, y los usuarios con su correo, último acceso y rol, más "Nuevo usuario". Capturas: `capturas/administracion-centro-control*.png`.
- **Inicio** (11-oct): abajo quedaron **Campañas** (ancha) y **Pipeline abierto** (angosta) a la par. Pipeline trae el monto, ganadas y perdidas del mes, la barra de "Probabilidad calculada" y el botón **"Crear nueva oportunidad"**. En celular van una debajo de la otra. Captura: `capturas/inicio-compu-dia.png`.
- **Revisión en celular (11-oct, 375 px de ancho)**: Inicio, Mi día, Oportunidades, Documentos (lista, panel, rechazo y expediente), Reportes (panel y Día) y Administración. Se corrigió que en Administración las tarjetas se salían por la derecha y que en Reportes la tabla de agentes se cortaba (ahora se desliza de lado). Capturas: `capturas/celular-*.png`.
