# Plan · Prospectos desde el DENUE del INEGI

**Para:** el equipo del CRM (Datos y Automatización) y Carlos, que decide cuándo se hace.
**Versión:** 0.1 · 18 de noviembre de 2026. **Estado: en pausa.** Se decidió esperar a ver cómo se sigue comportando
el CRM con las campañas actuales antes de construirlo (§9).

## 1. Qué se quiere

Carlos quiere una campaña para ofrecer **automatización con IA y desarrollo de CRM**. Hace falta de dónde sacar
empresas nuevas. La idea es conectar la API del CRM con la **API del DENUE** (Directorio Estadístico Nacional de
Unidades Económicas del INEGI) para buscar empresas por estado, municipio, giro y tamaño, y que terminen en esa campaña.

## 2. Qué trae el DENUE y qué no

**Trae, de cada establecimiento:** nombre y razón social, actividad (clave SCIAN), tamaño por número de empleados
(«estrato»), domicilio y, a veces, teléfono, correo y sitio web. Es información pública y gratuita; la API pide un token
que se saca con un registro en el sitio del INEGI.

**No trae personas.** El CRM no deja crear un prospecto sin el nombre de alguien
(`contactoNombre` en `src/crm/dto/prospecto.schema.ts`), y el correo del DENUE casi siempre es el general
(`contacto@`, `ventas@`). Desde el 6-nov la prospección solo escribe a correos de persona (flujo de campaña, decisión
8). Por eso **no puede ser 100 % automático**: alguien tiene que poner a la persona.

**LinkedIn no se conecta.** No tiene una API abierta para buscar personas o empresas, y sacar datos con un robot va
contra sus condiciones de uso. A la persona se la busca a mano.

## 3. La forma elegida: plantilla con el DENUE

Se descartaron dos alternativas:

| Opción | Por qué no |
|---|---|
| Que las empresas del DENUE entren solas al CRM y la persona se agregue después en la ficha | Más trabajo, las empresas entran sin la revisión de la importación y el CRM no detecta empresas repetidas por nombre |
| Usar el correo general con un nombre como «Contacto general» | Va contra la decisión del 6-nov; los correos dirían «Hola Contacto general»; los generales responden menos y sus rebotes pueden activar el freno del dominio y pausar todas las campañas |

**Cómo se usaría:**

1. En Prospectos → Importaciones, botón **«Buscar en el DENUE»** (solo administrador y supervisor).
2. Se eligen estado, municipio, giro y tamaño. El CRM dice cuántas empresas hay y muestra una muestra.
3. **«Descargar plantilla»:** sale la plantilla de siempre con las empresas ya llenas (nombre, giro con las palabras del
   score, tamaño, ciudad y estado, sitio web). Las columnas de la persona quedan vacías.
4. Alguien completa nombre, puesto y correo de la persona desde LinkedIn o el sitio de la empresa. Las filas que no se
   completan se borran.
5. Se importa con la campaña nueva y sigue el camino de siempre: revisión, duplicados, «Confirmar todas»,
   auditoría y «Mandar a automatización».

Así todo pasa por los controles que ya existen (C-03, D-01 a D-06) y no cambia la base de datos.

## 4. Lo que hay que construir

**API**

- Secreto `DENUE_TOKEN` en Secret Manager y variable opcional en `src/config/env.ts`. Sin token, el botón no aparece
  y la API responde que el DENUE no está configurado. El token nunca llega al navegador.
- `GET /api/v1/prospectos/denue/buscar` (administrador y supervisor): recibe estado, municipio, actividad (sector,
  subsector o rama SCIAN) y tamaño; llama a `BuscarAreaActEstr` del DENUE; regresa las empresas ya traducidas (§5) y
  un total (`Cuantificar`). Marca las que tienen el mismo nombre que una empresa del CRM (la misma comparación de
  `src/shared/empresas-parecidas.ts`).
- `POST /api/v1/prospectos/denue/plantilla`: con los mismos filtros, regresa el CSV con las columnas exactas de
  `COLUMNAS_CSV`, hasta 2,000 filas (el máximo de una importación).
  - `contactoNombre`, `contactoPuesto` y `correo` vacíos; `canalInicial` = `correo`.
  - El teléfono y el correo generales van en `observaciones`, **no** en `telefono` ni `correo`. Si fueran en
    `telefono`, todas las personas de esa empresa compartirían el conmutador.
  - En `observaciones`, también la clave del DENUE y la actividad, para poder rastrear de dónde salió cada empresa.
- Llamadas al DENUE desde el servidor, por bloques (por ejemplo, de 100 en 100), con tiempo límite y reintento corto.

**Pantalla**

- Diálogo «Buscar en el DENUE» en Importaciones: filtros, total, muestra y «Descargar plantilla».

**Pruebas**

- Las equivalencias de giro y tamaño (§5).
- Los dos endpoints con el DENUE simulado: las pruebas nunca llaman al INEGI de verdad.
- Permisos: un agente no puede usarlos.
- Que la plantilla descargada se importe sin errores en las columnas de la empresa.

**Documentos**

- Manual de datos (cómo usar el botón), guía de carga, diccionario si cambia algo, RUNBOOK (la variable y su secreto),
  inventario de accesos (quién tiene el token) y bitácora.

Esfuerzo estimado: de uno a dos días de trabajo, más la prueba en producción.

## 5. Equivalencias

**Tamaño** (estrato del DENUE → `empresaTamano`). Regla simplificada; la oficial de la Secretaría de Economía cambia
según el sector.

| Estrato | Personas | Tamaño en el CRM |
|---|---|---|
| 1 | 0 a 5 | micro |
| 2 | 6 a 10 | micro |
| 3 | 11 a 30 | pequena |
| 4 | 31 a 50 | pequena |
| 5 | 51 a 100 | mediana |
| 6 | 101 a 250 | mediana |
| 7 | 251 y más | grande |

**Giro** (sector SCIAN, los dos primeros dígitos → una palabra que el score reconoce).

| Sector SCIAN | Giro en el CRM |
|---|---|
| 11 | agroindustria |
| 23 | construcción |
| 31, 32, 33 | manufactura |
| 43, 46 | comercio |
| 48, 49 | logística |
| 51 (y la rama 5415, consultoría en computación) | tecnología |
| 52 | financiero |
| 53, 54, 55, 56, 71, 72, 81 | servicios |
| 61 | educación |
| 62 | salud |
| 21, 22 y los demás | otro |
| 93 (gobierno) | no se incluye |

## 6. A quién buscar (propuesta para Carlos)

Empresas **pequeñas y medianas** (estratos 3 a 6) de Aguascalientes, de giros con muchas solicitudes de clientes o
muchos procesos repetitivos: distribuidoras (43), logística (48-49), clínicas y consultorios (62), escuelas
particulares (61), inmobiliarias (53), servicios profesionales (54) y manufactura mediana (31-33). La lista final de
giros y municipios la decide Carlos.

## 7. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Correos de persona mal adivinados o viejos: rebotes | Solo se cargan correos que se encontraron, no que se adivinaron. Con 5 rebotes en 7 días el freno del dominio pausa **todas** las campañas |
| Datos del DENUE desactualizados (empresas cerradas o que cambiaron) | Revisar el sitio web antes de completar a la persona |
| Empresas repetidas por nombre | El CRM avisa al importar; un administrador puede fusionar |
| Límites de uso de la API del DENUE | La página del INEGI no los dice: probarlos con búsquedas chicas y llamar por bloques |
| Datos personales (LFPDPPP) | Del DENUE solo salen datos de empresas. Los datos de la persona se buscan a mano en fuentes públicas; los correos llevan aviso de privacidad y link de baja |

## 8. Lo que no dice la documentación del DENUE (confirmar al construir)

- Los textos exactos del estrato para 11 a 30, 51 a 100, 101 a 250 y 251 y más (la página solo muestra ejemplos de 0
  a 5, 6 a 10 y 31 a 50).
- Cuántos registros caben en una sola petición y si hay límite diario.
- Si las rutas distinguen mayúsculas (la página usa `BuscarAreaActEstr` y también minúsculas en sus ejemplos).

Referencia: `https://www.inegi.org.mx/servicios/api_denue.html`. Ruta base:
`https://www.inegi.org.mx/app/api/denue/v1/consulta/`.

## 9. Cuándo retomarlo

Cuando el CRM lleve al menos dos semanas estable con las campañas actuales:

- Sin incidentes nuevos (como las bajas falsas del 11 y 12-nov o las caídas del 17-nov) y con el primer rebote y el
  primer recordatorio real revisados.
- Rebotes debajo de 2 % y quejas debajo de 0.1 %.
- Saber cómo responde el dominio con 75 nuevos al día (desde el 17-nov; antes salían 10).

**Para arrancar:**

1. Carlos aprueba los giros, los municipios y los textos de los 3 correos de la campaña.
2. Se saca el token del DENUE y se guarda en Secret Manager.
3. Se construye y se prueba (§4).
4. Se despliega y se hace una búsqueda de prueba en Aguascalientes.

Por fechas: con el cierre el 9-dic, una campaña que arranque después del 20-nov solo alcanza a medir la respuesta al
primer correo dentro del proyecto. Si se hace después del cierre, este plan se entrega como parte de la
transferencia (OB-07).
