# Flujo de campaña · CRM NANOBRIDGE

**Entregable:** flujo de campaña listo para decisión (OB-05), proyecto naranja · outbound.
**Para:** Dirección General y quien opere la prospección. **Redacta:** T1 · **Revisión:** T2 (dueño de los flujos de n8n).
**Versión:** 0.9 · 10 de noviembre de 2026 (encendido del 6-nov y correos por campaña del 9-nov). Pasa a 1.0 con los
contactos de Carlos cargados y la audiencia certificada por campaña (§2).

Este documento junta lo autorizado para la prospección: a quién se le escribe, qué se le dice, con qué límites, qué se
excluye, qué queda registrado, cómo se vigila y cómo se detiene. **El encendido se adelantó al 6-nov-2026, con
autorización escrita de Carlos** (en lugar de la revisión G5 del 23 al 27-nov que marcaba el programa); los envíos
automáticos corren desde el lunes 9-nov.

Cómo funciona cada pieza por dentro está en el [flujo de actualización](FLUJO_DE_ACTUALIZACION.md) (OB-03); aquí
solo lo que hace falta para decidir.

## 1. Lo que se pide autorizar

| # | Decisión | Propuesta | Estado |
|---|---|---|---|
| 1 | **Audiencia** | Los contactos que Carlos cargue en sus campañas, con correo de persona, giro y tamaño | ⏳ Encendido sin lista (6-nov); falta que Carlos los cargue |
| 2 | **Textos de los 3 correos** (inicial y 2 recordatorios) | Los actuales, en Administración → Correos de prospección (§3) | Carlos los aprobó por escrito (6-nov); los cambios se hacen desde Administración |
| 3 | **Pie del correo:** domicilio de la empresa y aviso de privacidad | Ignacio T Chávez 328, Obraje, 20230, Aguascalientes, Ags. (Carlos, 4-nov); el aviso ya está publicado | Hecho (pie y remitente, 6-nov) |
| 4 | **Tope diario** de correos | 20 al día, para calentar el dominio; se duplica cada semana si los rebotes quedan debajo de 2 % y las quejas debajo de 0.1 % | Aplicado (6-nov, `00051-wn9`) |
| 5 | **Nuevos por día** | 10 como máximo (`NUEVOS_POR_DIA`) | Valor actual |
| 6 | **Horario** | Lunes a viernes: recordatorios (PT4) a las 9:00 y nuevos (PT1a) a las 10:00, hora de México | Publicado (6-nov) |
| 7 | **Un «no interesado»** ¿bloquea para siempre o 6 meses? | 6 meses desde su respuesta: puede volver a entrar, pero el correo espera (`578-no-interesado-seis-meses`) | Carlos decidió (4-nov) |
| 8 | **Correos de área** (`info@`, `ventas@`) | Fuera al inicio: solo correos de persona | Decidido (6-nov) |
| 9 | **Quién recibe los avisos** de respuestas (PT2) y de fallas (B4) | `pasante.tics002@` y `director.general@nano-bridge-mex.com` | Publicado (6-nov) |
| 10 | **Cuenta de SendGrid** pagada, con Inbound Parse incluido | Plan de pago con la tarjeta de la empresa, antes del 24-nov | Carlos confirmó el pago (4-nov); falta hacerlo |
| 11 | **Quién atiende a los interesados** | Reparto automático entre Carlos, Fabián y Mich (§6) | Prendido (6-nov) |
| 12 | **Varias campañas con los mismos contactos** (agua y tratamiento de maquinaria) | Cada campaña con sus 3 correos; los límites se cuentan por persona y campaña; una serie a la vez; «me interesa» en una frena las demás (§4) | Decidido por Fabián (9-nov), en producción (`00053-4wf`) |

## 2. Audiencia

**De dónde sale:** los contactos de Carlos entran por la importación CSV del CRM (o uno por uno), una persona revisa y
confirma cada fila (duplicados contra la base y contra el archivo) y un administrador o supervisor los manda a la fila
de automatización con su campaña: hoy son dos servicios distintos, agua y tratamiento de maquinaria, y la misma
persona puede ir a las dos. La automatización no crea prospectos por su cuenta. La base de ejemplo se borró el 6-nov.

**Quién entra a la fila** (control `D-06`): solo quien tiene giro, tamaño y un correo usable, no está en baja ni en la
lista de supresión, tiene menos de 3 correos en 6 meses **en esa campaña**, no tiene una espera abierta en ella, no está ya en esa
campaña y no le interesó otra. Los demás regresan con su motivo.

**Cómo se certifica:** la [auditoría de datos](PROCEDIMIENTO_AUDITORIA.md) (§5 del reporte) da, por campaña, cuántos
prospectos están listos y por qué no los demás (desactivado, sin giro, sin tamaño, sin correo utilizable, en baja o
ya con 3 correos o con un «no interesado» de hace menos de 6 meses), y cuántos tienen un giro que el score no reconoce
o un correo de área. Esa tabla, corrida después de cargar la lista, es la certificación. El orden seguro para cargar y
certificar sin que salga ningún correo está en [Carga de la lista de Carlos](CARGA_DE_LA_LISTA.md).

| Campaña | En espera | Listos | Fuera, y por qué |
|---|---|---|---|
| ⏳ Agua | Se llena cuando Carlos cargue sus contactos | | |
| ⏳ Tratamiento de maquinaria | Se llena cuando Carlos cargue sus contactos | | |

**Lo que hace falta para que un contacto de Carlos pueda entrar:**
- **Tamaño de la empresa.** La lista no lo trae y sin él nadie entra a la fila. Se le pide a Carlos.
- **Giros escritos como los reconoce el sistema.** El score solo da puntos a los giros de su tabla (sin acentos ni
  mayúsculas), y las plantillas por giro solo se usan si el giro coincide. Uno escrito distinto vale 0 puntos
  ([evaluación del modelo](EVALUACION_DEL_MODELO.md), §7).
- **Correo de persona:** los de área (`info@`, `ventas@`) quedaron fuera al inicio (decisión 8).

La plantilla de Excel para Carlos («Lista de prospectos para el piloto.xlsx», 6-nov) trae listas para giro y tamaño y
cuenta lo que falta; cómo pasarla a CSV está en [Carga de la lista](CARGA_DE_LA_LISTA.md) §2, paso 5. Si Carlos manda
una lista por campaña, se importa cada una con su campaña.

## 3. Mensaje

- **Tres correos por persona y campaña:** el inicial y dos recordatorios. Se escriben en el CRM (Administración →
  Correos de prospección) y la API se los da armados a n8n. Hay tres **generales**, y desde el 9-nov cada campaña puede
  tener los **suyos** (botón «Campañas»): el número que una campaña no tenga propio sale con el general. Al mandar a
  una campaña sin correos propios, el CRM avisa que saldrán los generales. El pie es uno para todas.
- **Datos del prospecto en el texto:** el nombre de la persona, de la empresa y el giro, que el CRM pone en la
  plantilla. El texto **no** lo escribe la IA.
- **Pie:** domicilio y aviso de privacidad, en la misma sección del CRM, y la línea «¿Ya no quieres recibir estos
  correos? Darte de baja». El enlace lleva a una página del CRM, en español, con el botón «Confirmar baja»: la baja
  ocurre al apretar el botón, no al abrir la página (desde el 13-nov; antes era el enlace de SendGrid, que daba de baja
  con solo abrirlo y los filtros de seguridad de Microsoft 365 lo abrían solos).
- **Respuestas:** cada correo lleva su propia dirección de respuesta (`r+<prospecto>@respuestas.contacto…`), así que
  cada respuesta se liga a su prospecto y detiene sus recordatorios.
- **Remitente:** desde el subdominio `contacto.nano-bridge-mex.com`, verificado en SendGrid desde el 29-sep, para no
  afectar la reputación del correo normal de la empresa.
- **Idioma:** los correos van marcados como español desde el 3-nov (`00046-vrm`); antes Gmail ofrecía traducirlos
  del inglés.

**Riesgo abierto:** los correos de prueba caen en la pestaña **Promociones** de Gmail desde el molde del 22-oct.
Quitar el logo no bastó y el HTML sencillo se probó y se revirtió el 29-oct. Una persona que no ve el correo no
responde, así que el resultado del piloto depende de esto (T2).

## 4. Secuencia y límites

| Regla | Valor | Control |
|---|---|---|
| Correos por persona | Máximo 3 cada 6 meses **en cada campaña**; una serie a la vez | `D-03`, `590-varias-campanas` |
| Espera entre correos | 5 días hábiles, a la misma hora; el recordatorio sale el día hábil siguiente al vencimiento | `D-03` |
| Días hábiles | Lunes a viernes, sin los feriados de la Ley Federal del Trabajo | `215-dia-habil-mx` |
| Tope diario de correos | 20 al encender (incluye recordatorios, que van primero) | `D-05` |
| Nuevos por día | Hasta 10, sin pasar del tope | `D-05` |
| Solo prospectos validados | Uno sin validar no recibe correo | `D-04` |
| Campaña | Varias pueden estar activas; pausar una = esperar (nadie pierde su lugar) | `230-recordatorios` |

**Una persona en varias campañas** (desde el 9-nov, `00053-4wf`):
- Los 3 correos y los 6 meses de un «no interesado» se cuentan **dentro de cada campaña**: a quien dijo que no al
  servicio de agua sí se le puede escribir del de maquinaria.
- **Una serie a la vez:** si la persona tiene otra campaña en curso (le salió un correo en los últimos 6 meses y no ha
  terminado, o PT1 la acaba de tomar), el primer correo de la nueva espera en la fila. Arranca cuando la otra termina:
  al contestar la persona o al marcarla inactiva PT4 después del tercero.
- **«Me interesa» en una campaña frena las demás:** sale de la fila de las otras, se les cierra la espera (PT4 ya no
  manda su recordatorio) y no puede volver a entrar a ellas. Ya la atiende un vendedor.
- **La baja es de la persona:** vale para todas las campañas.
- **Mandar a otra campaña** a quien ya espera en la fila de una: el CRM pregunta «Agregar también a esta campaña» o
  «Cambiar a esta campaña». A quien ya pasó por otra se le crea un prospecto nuevo para la nueva campaña.

**Cuánto cabe antes del cierre (9-dic).** Con la regla de días hábiles del sistema, cada recordatorio sale el día
hábil siguiente a 5 días hábiles del anterior. Para que una persona reciba los 3 correos antes del cierre, el primero
tiene que salir **a más tardar el viernes 20-nov** (segundo el 30-nov y tercero el 8-dic). Lo que empiece después
mide sobre todo la respuesta al primer correo.

## 5. Exclusiones

A nadie de esta lista le sale un correo, aunque esté en la campaña:

| Quién | Por qué | Control |
|---|---|---|
| Persona en la lista de supresión | Pidió la baja, marcó spam o su correo rebotó | `D-01` |
| Persona en baja | Se le dio de baja por respuesta o por evento de SendGrid; no se deshace | `D-02` |
| Prospecto cerrado | `interesado`, `no_interesado`, `descartado`, `excluido` o `inactivo` | `230-recordatorios` |
| Sin correo utilizable | No hay a dónde escribir | `D-06` |
| Ya con 3 correos en 6 meses en esta campaña, o con una espera abierta en ella | Límite de contacto | `D-03` |
| Dijo «no interesado» a esta campaña hace menos de 6 meses | Decisión de Carlos (decisión 7) | `578-no-interesado-seis-meses` |
| Le interesó otra campaña | Ya lo atiende un vendedor | `590-varias-campanas` |
| Tiene una serie en curso en otra campaña | Solo espera el primer correo; sale cuando la otra termine | `590-varias-campanas` |
| Respondió | Su respuesta cierra la espera y detiene los recordatorios | `200-respuestas-recibidas` |

## 6. Registros y vigilancia

**Qué queda escrito:** cada envío (`envios`), cada respuesta y su clasificación (`respuestas`), cada baja
(`lista_supresion`), cada cambio con el antes y el después (Registro de cambios) y cada falla de un flujo (incidencias y
procesos fallidos). Nada de esto se borra.

**Durante el piloto:**
- **Auditoría de datos diaria** (procedimiento §1), con atención a los dos controles rojos: personas con más de 3
  correos en 6 meses y medios activos que están en la lista de supresión. Cualquiera de los dos **detiene la campaña**.
- **Freno automático del dominio** (desde el 5-nov): con 2 quejas de spam o 5 rebotes en 7 días se pausa toda la
  prospección y se avisa a administradores y supervisores; nadie pierde su lugar. Se revisa la lista y un
  administrador reanuda en Administración.
- **Correos que no salieron:** si SendGrid rechaza uno, se reintenta hasta 3 veces sin gastar el contacto de la persona.
  Administración marca los que llevan más de una hora sin confirmar.
- **Avisos automáticos:** B4 avisa por correo de cualquier falla de un flujo, y Cloud Monitoring avisa si la API se
  cae (revisión cada 5 minutos).
- **Respuestas:** cada una cae en la cola de clasificación; una persona la clasifica (la IA solo sugiere). Un
  «interesado» crea la tarea «Contactar prospecto interesado», que vence al final del siguiente día hábil (si nadie
  la toma en un día hábil, sube a urgente y se avisa a los supervisores). Desde la
  cola, «Responder ahora» deja contestarle de inmediato, y quien lo hace se queda con la tarea.
- **Reparto de interesados** (en producción desde el 3-nov, `00046-vrm`, **apagado**): prendido, la tarea le toca al
  vendedor de la lista con menos interesados abiertos; si empatan, al que lleva más tiempo sin recibir uno. Si la
  empresa ya es de un vendedor activo, va con él. Quien la recibe queda como responsable de la empresa y le llega el
  aviso. Apagado, la tarea queda sin asignar y un supervisor la reparte. Empieza apagado a propósito, para que ningún
  interesado real le caiga a una cuenta de prueba.
- **Métricas del modelo** M1 a M5 ([evaluación del modelo](EVALUACION_DEL_MODELO.md), §4), para el reporte del piloto.

## 7. Modo de prueba

Hasta el 6-nov **todo estuvo en modo de prueba**: `MODO_PRUEBAS` encendido en PT1 y PT4, y solo salían correos a una
lista corta de buzones del equipo. Desde esa fecha está apagado. Así se probó en vivo:

| Fecha | Prueba | Resultado |
|---|---|---|
| 6-oct | Recordatorios (PT4) | Llegaron |
| 8-oct | Baja por el link del pie | El prospecto quedó en baja y su correo en «no contactar» |
| 13-oct | Tercer correo (PT4) | Llegaron los 3, con el link de baja; nada a los dados de baja |
| 16-oct | Un prospecto de la fila pasa por PT1 | Validado, score 47, el correo llegó a Gmail |
| 19-oct | Respuesta tardía con sugerencia de la IA | La cola la mostró con su sugerencia |
| 29-oct | Página de baja en español | Funciona |

**Faltan en vivo:** una respuesta automática (fuera de oficina), un correo sin firma y un rebote.

## 8. Lista de encendido

La lista completa, con los comandos, está en el [RUNBOOK](../RUNBOOK_DEPLOY.md), §10. Se recorre entera el día de
encender, después de la autorización. Resumen al 3-nov:

| Paso | Estado |
|---|---|
| Textos aprobados y domicilio en el pie y en el remitente | ✅ Hecho (6-nov) |
| SendGrid pagado con Inbound Parse | ⏳ Dirección, antes del 24-nov |
| Datos de ejemplo borrados | ✅ Hecho (6-nov) |
| Contactos de Carlos cargados en una campaña activa | ⏳ Carlos |
| Pruebas en vivo: fuera de oficina y firma incorrecta | ✅ Hecho (6-nov) |
| Primer rebote y primer recordatorio real de PT4 | ⏳ Revisar cuando ocurran |
| Prompts de n8n para usar el correo de la API y confirmar cada envío (`docs/n8n/confirmacion-envios/`) | ✅ Hecho (6-nov) |
| Avisos de PT2 y B4 a las personas correctas | ✅ Hecho (6-nov) |
| Equipo de ventas dado de alta y reparto de interesados prendido | ✅ Hecho (6-nov) |
| Tope diario a 20 | ✅ Hecho (6-nov) |
| Horario de PT1a y PT4 | ✅ Hecho (6-nov) |
| Apagar `MODO_PRUEBAS` en PT1 y PT4 | ✅ Hecho (6-nov) |
| Link y página de baja, respaldos, feriados, PT5, botón «Mandar a automatización» | ✅ Hechos |

## 9. Cómo se detiene

- **Una campaña:** Prospectos → Campañas → Pausar. Nadie pierde su lugar: al reanudar, los recordatorios salen
  repartidos por el tope diario.
- **Todo:** volver a encender `MODO_PRUEBAS` en PT1 y PT4, o quitar el horario de PT1a y PT4 en n8n.
- **Una persona:** una baja (por su link, por su respuesta o desde la cola de clasificación) detiene todo lo suyo de
  inmediato y cancela sus seguimientos.

## 10. Para pasar a v1.0

1. Certificación de audiencia por campaña con los contactos de Carlos cargados (§2).
2. Correos propios de cada campaña escritos y aprobados por Carlos, o la decisión de usar los generales (§3).
3. El pago de SendGrid antes del 24-nov (decisión 10).
4. El primer rebote y el primer recordatorio real de PT4 revisados (§7).
5. Qué se hará con lo de Promociones (§3).
