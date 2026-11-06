# Carga de la lista de Carlos · semana 12

**Para:** quien haga la carga en producción (Datos, con Automatización para la limpieza).
**Versión:** 1.0 · 6 de noviembre de 2026, después de ensayarla completa en una base local (§4).

Es el paso que convierte la base de ejemplo en la base del piloto: borrar lo de ejemplo, cargar la lista, revisarla y
sacar la certificación de audiencia para G5. **Nada de esto manda correos**, siempre que se siga el orden del §2.

## 1. Antes: qué pedirle a Carlos

| Dato | Por qué | Si no viene |
|---|---|---|
| **Tamaño de cada empresa** (micro, pequeña, mediana o grande) | Sin tamaño nadie entra a la fila | Esas personas se cargan, pero no se pueden mandar a la automatización |
| **Giro con una de estas palabras:** tecnología, manufactura, logística, financiero, servicios, salud, construcción, agroindustria, comercio, educación u otro | El score solo reconoce esas (sin importar acentos ni mayúsculas). «Industria manufacturera», «Servicios financieros» o «Distribución» valen 0 de hasta 30 puntos | Se cargan igual; la auditoría los cuenta (§5, «Calidad de la audiencia»). Conviene corregirlos en el archivo antes de subirlo |
| **Región** (columna aparte, por ejemplo «Bajío» o «Norte») | Da +10 en el score. El estado y la ciudad no cuentan como región | Todos pierden esos 10 por igual; no cambia el orden entre ellos |
| **Un correo de persona** mejor que uno de área | `info@`, `ventas@` o `compras@` responden menos y no son una persona | Entran; la auditoría dice cuántos son. Decidir con Carlos si se dejan |

## 2. En producción, en este orden

1. **Respaldo del día** confirmado (RUNBOOK §9).
2. **Ver qué se borraría** (sin `--borrar`): `limpiar-datos-prueba.mjs` lista las empresas que reconoce como de prueba y
   las que **no** parecen de prueba. Revisar las dos listas con T2.
3. **Borrar:** las de prueba con `--empresas=<ids>` y las de ejemplo que no lo parecen (como la 5) con
   `--de-ejemplo=<ids>`, más `--borrar` y `LIMPIEZA_CONFIRMO=borrar-datos-de-prueba`. Todo o nada: si algo falla, no
   borra nada. La lista de supresión, la bitácora, campañas y usuarios no se tocan.
4. **Auditoría** (`auditar-datos.mjs`): §6 «Datos de prueba» en 0 y 0 empresas.
5. **Preparar el archivo:** pasar la lista de Carlos a la plantilla (Prospectos → Importaciones → «Descargar
   plantilla»), con los nombres de columna exactos. Guardarlo desde Excel como **CSV separado por comas** (UTF-8 o el
   normal) o separado por punto y coma: los tres sirven desde el 6-nov. Si Carlos usó la plantilla de Excel que se le
   mandó el 6-nov («Lista de prospectos para el piloto.xlsx», con listas para giro, tamaño y canal y una revisión de lo
   que falta), basta con abrir la hoja «Lista» y Guardar como → «CSV UTF-8»: Excel guarda solo esa hoja, ya con los
   nombres de columna del CRM (probado: las filas vacías del final se ignoran).
6. **Campaña del piloto:** Prospectos → Campañas → crearla y **activarla**.
7. **Importar** el archivo con esa campaña. Revisar las filas «Con errores» y «Duplicada» (Manual de datos §2) y
   luego «Confirmar todas las pendientes».
8. **Mandar a automatización** a todos. Los que no están listos regresan con su motivo (casi siempre, sin tamaño).
9. **Pausar la campaña de inmediato.** Con la campaña pausada, PT1 no toma a nadie (comprobado en el ensayo); nadie
   pierde su lugar en la fila.
10. **Auditoría otra vez.** Su §5 es la **certificación de audiencia** para G5: cuántos hay en espera, cuántos están
    listos y por qué no los demás, más cuántos tienen un giro que el score no reconoce o un correo de área. Copiar esa
    tabla al [flujo de campaña](FLUJO_DE_CAMPANA.md) §2 y al [reporte final de T1](REPORTE_FINAL_T1.md) §3 y §5 (es la
    medición que cuenta para T1.1 y T1.2).

La campaña se reactiva hasta que haya autorización escrita de G5 y se haya recorrido la lista de encendido del
RUNBOOK §10.

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

## 4. El ensayo (6-nov-2026)

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
