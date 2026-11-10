# Carga de los contactos de Carlos

**Para:** quien cargue contactos a las campañas en producción (Datos, o un supervisor o administrador).
**Versión:** 1.1 · 10 de noviembre de 2026. La 1.0 (6-nov) planeaba la carga para la semana 12, antes de autorizar el
piloto; el encendido se adelantó al 6-nov con autorización escrita de Carlos y la base de ejemplo ya se borró ese día.

Cómo meter los contactos de Carlos a sus campañas (hoy, agua y tratamiento de maquinaria) y certificar la audiencia de
cada una. **Ojo: las campañas ya están activas y el modo de prueba está apagado.** Quien entre a la fila de una campaña
activa puede recibir su primer correo en la siguiente corrida de PT1a (10:00, de lunes a viernes).

## 1. Antes: qué pedirle a Carlos

| Dato | Por qué | Si no viene |
|---|---|---|
| **Tamaño de cada empresa** (micro, pequeña, mediana o grande) | Sin tamaño nadie entra a la fila | Esas personas se cargan, pero no se pueden mandar a la automatización |
| **Giro con una de estas palabras:** tecnología, manufactura, logística, financiero, servicios, salud, construcción, agroindustria, comercio, educación u otro | El score solo reconoce esas (sin importar acentos ni mayúsculas). «Industria manufacturera», «Servicios financieros» o «Distribución» valen 0 de hasta 30 puntos | Se cargan igual; la auditoría los cuenta (§5, «Calidad de la audiencia»). Conviene corregirlos en el archivo antes de subirlo |
| **Región** (columna aparte, por ejemplo «Bajío» o «Norte») | Da +10 en el score. El estado y la ciudad no cuentan como región | Todos pierden esos 10 por igual; no cambia el orden entre ellos |
| **Un correo de persona** mejor que uno de área | `info@`, `ventas@` o `compras@` responden menos y no son una persona | Fuera al inicio: solo correos de persona (decisión del 6-nov, flujo de campaña §1); la auditoría dice cuántos hay |

## 2. En producción, en este orden

La limpieza de la base de ejemplo (pasos con `limpiar-datos-prueba.mjs` y respaldo previo) ya se hizo el 6-nov.

1. **Preparar el archivo:** pasar la lista de Carlos a la plantilla (Prospectos → Importaciones → «Descargar
   plantilla»), con los nombres de columna exactos. Guardarlo desde Excel como **CSV separado por comas** (UTF-8 o el
   normal) o separado por punto y coma: los tres sirven desde el 6-nov. Si Carlos usó la plantilla de Excel que se le
   mandó el 6-nov («Lista de prospectos para el piloto.xlsx», con listas para giro, tamaño y canal y una revisión de lo
   que falta), basta con abrir la hoja «Lista» y Guardar como → «CSV UTF-8»: Excel guarda solo esa hoja, ya con los
   nombres de columna del CRM (probado: las filas vacías del final se ignoran). **Un archivo por campaña.**
2. **Importar** cada archivo con su campaña. Revisar las filas «Con errores» y «Duplicada» (Manual de datos §2) y
   luego «Confirmar todas las pendientes».
3. **Auditoría** (`auditar-datos.mjs`) antes de mandarlos: §2 y §3 (giro, tamaño, correos de área, duplicados). Lo que
   haya que corregir se corrige ahora, en las fichas.
4. **Mandar a automatización** a cada grupo con su campaña. Los que no están listos regresan con su motivo (casi
   siempre, sin tamaño). Si una persona ya espera en otra campaña, el CRM pregunta «Agregar también» o «Cambiar».
   Para revisar con calma antes de que salgan correos, hacerlo después de las 10:00 o pausar la campaña mientras
   tanto (con la campaña pausada PT1 no toma a nadie; comprobado en el ensayo).
5. **Auditoría otra vez.** Su §5 es la **certificación de audiencia** por campaña: cuántos hay en espera, cuántos están
   listos y por qué no los demás (incluye a quien espera que termine otra campaña), más cuántos tienen un giro que el
   score no reconoce o un correo de área. Copiar esa tabla al [flujo de campaña](FLUJO_DE_CAMPANA.md) §2 y al
   [reporte final de T1](REPORTE_FINAL_T1.md) §3 y §5 (es la medición que cuenta para T1.1 y T1.2).

## 3. Lo que hace el CRM con la lista (comprobado)

- **Acentos:** el archivo puede venir en UTF-8 o como lo guarda Excel en Windows; el CRM reconoce los dos.
- **La misma empresa escrita distinto** («Moldes, S.A. de C.V.» y «MOLDES»): «Confirmar todas» las junta en una.
  Si una fila no trae tamaño pero su empresa ya lo tiene, se queda con el de la empresa.
- **La misma persona dos veces** (mismo correo, aunque cambien las mayúsculas o haya espacios): la segunda sale
  «Duplicada».
- **Un correo mal escrito** o un canal que no sea correo, teléfono o WhatsApp («email»): la fila sale «Con errores» con
  el motivo en español.
- **Un conmutador compartido** (dos personas con el mismo teléfono): el teléfono se le queda a la primera; la segunda
  entra solo con su correo. No es un error.
- **Teléfonos con y sin +52** («81 1234 5678», «+52 81 1234 5678», «+52 1 81…») se guardan igual, y la extensión del
  final («ext 12») se quita (desde el 6-nov, migración 041). La extensión se pierde: si importa, va en observaciones.

## 4. El ensayo (6-nov-2026, antes del encendido)

En una copia local de la base, con una lista inventada de 26 filas que trae los problemas de arriba:

| Paso | Resultado |
|---|---|
| Limpieza de 5 empresas (una con correos que parecen reales, una cotización mandada por correo y su tarea de seguimiento) | Se borró todo; quedaron la lista de supresión y los usuarios. La versión anterior del script **fallaba** con las cotizaciones mandadas por correo y no reconocía las de ejemplo que parecen reales: se corrigió (`correos_cotizacion`, tareas por cotización y `--de-ejemplo`) |
| Importar | 23 por revisar, 1 duplicada (el mismo correo con otras mayúsculas) y 2 con errores (correo mal escrito y «email») |
| Confirmar todas | 23 personas en 12 empresas (las dos formas de «Moldes» se juntaron) |
| Mandar a automatización | 17 en la fila; 6 regresaron por no tener tamaño |
| Campaña pausada | PT1 tomó 0 |
| Certificación (auditoría §5) | 17 en espera, 17 listos; 6 con un giro que el score no reconoce y 8 con correo de área |
| «No interesado» hace menos de 6 meses | La auditoría lo saca de «Listos» y la API lo rechaza con el mismo motivo |

La lista del ensayo y su script están fuera del repositorio (eran datos inventados).
