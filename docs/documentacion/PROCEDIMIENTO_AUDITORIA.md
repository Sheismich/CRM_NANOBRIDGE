# Procedimiento de auditoría y actualización de datos · CRM NANOBRIDGE

**Entregable:** procedimiento periódico de actualización y auditoría de datos (T1, semana 11 del programa).
**Dueño:** T1 · **Revisión:** T2 y Dirección General. **Versión:** 1.0 · 28 de octubre de 2026.

Qué revisar, cuándo, cómo y qué hacer con cada hallazgo, para que la base se mantenga dentro de las reglas del
[diccionario de datos](DICCIONARIO_DE_DATOS.md) y de los [controles](REPORTE_DE_CONTROLES.md).

## 1. Cuándo se audita

| Momento | Por qué | Qué mirar primero |
|---|---|---|
| **Cada semana** (antes de la revisión con Dirección) | Medir T1.1 y T1.2 y llevar la tendencia | Resumen y §2 Completitud |
| **Después de cargar una lista** (importación CSV) | Ver que entró limpia antes de mandarla a automatización | §3 Duplicados y §5 Audiencia |
| **Antes de G5** (semana 13) | Certificar la audiencia y las exclusiones de la campaña | §5 Audiencia por campaña |
| **Cada día del piloto** (semana 14) | Detectar a tiempo un correo que no debió salir | Los dos controles rojos de §4 |
| **Antes del cierre** | Reporte final de T1 | Todo |

## 2. Cómo se corre

El script [`auditar-datos.mjs`](auditar-datos.mjs) **solo lee** la base y escribe un reporte con fecha en
[`auditorias/`](auditorias/). No incluye datos personales: solo cantidades e IDs del CRM. Nunca sobrescribe un
reporte anterior (si ya hay uno del día, crea `calidad-<fecha>-2.md`).

**Desde la compu de T1, en PowerShell** (abre la IP solo mientras corre y la cierra al final aunque algo falle):

```powershell
cd "C:\Users\desto\OneDrive\Desktop\NANO\CRM_NANOBRIDGE\CRM_NANOBRIDGE"
$g = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$p = "crm-prospeccion-outbound"
$ip = Invoke-RestMethod "https://api.ipify.org"
& $g sql instances patch nanobridge-db --authorized-networks="$ip/32" --project=$p --quiet
try {
  $ipdb = & $g sql instances describe nanobridge-db --project=$p --format="value(ipAddresses[0].ipAddress)"
  $url = (& $g secrets versions access latest --secret=DATABASE_URL --project=$p) -replace '@localhost/', "@${ipdb}:3306/" -replace '\?socketPath=.*', ''
  $env:AUDITORIA_DB_URL = $url
  node docs/documentacion/auditar-datos.mjs
} finally {
  Remove-Item Env:AUDITORIA_DB_URL -ErrorAction SilentlyContinue
  $url = $null
  & $g sql instances patch nanobridge-db --clear-authorized-networks --project=$p --quiet
}
```

Si gcloud pide iniciar sesión: `& $g auth login`. También se le puede pedir a Claude Code que la corra; usa el mismo procedimiento.

**Reglas de seguridad:** no escribir la contraseña en ningún comando, no pegar en un chat la salida de
`gcloud secrets`, y comprobar al terminar que la base no tiene redes autorizadas:
`& $g sql instances describe nanobridge-db --project=$p --format="value(settings.ipConfiguration.authorizedNetworks)"` (debe salir vacío).

## 3. Después de correrla

1. Abrir el reporte nuevo en `auditorias/` y escribir arriba una sección **«Conclusiones»** con lo que significa y las
   acciones, cada una con dueño y fecha (ver el [reporte del 28-oct](auditorias/calidad-2026-10-28.md) como ejemplo).
2. Corregir lo que toque (§4) y, si hubo correcciones, volver a correrla para dejar evidencia.
3. Subir el reporte al repositorio (`git add docs/documentacion/auditorias`). Es la evidencia del KPI C3 (trazabilidad).
4. Pasar T1.1 y T1.2 a la ficha semanal de KPI. Se usa la columna **«Sin datos de prueba»** mientras quede alguno.

## 4. Qué hacer con cada hallazgo

**Semáforo:** T1.1 y T1.2 de **95 % o más** está bien; entre 90 % y 95 %, corregir esa semana; **menos de 90 %**, avisar a
Dirección con un plan. Los dos controles **rojos** detienen la campaña sin esperar a la revisión.

| Hallazgo | Qué significa | Qué hacer | Dónde |
|---|---|---|---|
| 🔴 **Personas con más de 3 correos en 6 meses** | Se rompió el límite de contacto | **Detener la campaña** (pausarla), avisar a T2 y a Dirección, revisar el flujo antes de reanudar | Prospectos → Campañas → Pausar |
| 🔴 **Medio activo que está en la lista de supresión** | El dato está mal: alguien que pidió su baja aparece como contactable. La API no le escribe (la lista manda), pero no debería pasar | Avisar a T2 y a Dirección; T2 revisa cómo volvió a quedar activo y lo corrige con un cambio revisado (desde el CRM no se marca «no contactar» a mano: solo lo hace una baja) | — |
| Empresa activa sin giro o sin tamaño | La automatización no le escribe | Completarlos en la ficha, o desactivarla si no sirve | Ficha → Editar |
| Contacto sin ningún medio | No se le puede contactar | Agregar correo o teléfono, o desactivarlo | Ficha → Contactos |
| Correo o teléfono mal formado o mal normalizado | Entró por un camino que se saltó la validación | Corregirlo y avisar a T2 (no debería pasar) | Ficha → Contactos |
| Prospecto en estado inválido | Un valor que no está en la lista del diccionario (§6) | Avisar a T2: lo escribió un flujo | — |
| Empresas con el mismo nombre | Posible duplicado (la base no lo impide; el CRM avisa al capturar desde el 29-oct) | Revisar las dos fichas. Si son la misma empresa, un administrador **fusiona** la repetida en la que se queda (G-05). **No desactivar** una a mano: sus contactos y correos se quedarían apartados en la desactivada | Ficha de la repetida → Fusionar (administrador) |
| Contactos con el mismo nombre en la misma empresa | Posible duplicado | Revisar; si es la misma persona, desactivar uno (sus medios siguen apartados) | Ficha |
| Mismo teléfono con distinto formato / Gmail con puntos o «+» | La misma persona con dos medios | Dejar uno y borrar el valor del otro en la ficha (queda como «obsoleto», no se pierde) | Ficha → Contactos → Editar |
| Persona con varios prospectos abiertos | Varias entradas al embudo a la vez | Dejar el más reciente y cerrar o descartar los demás | Prospectos |
| Filas importadas «duplicado» sin resolver | Nadie decidió si se usa el contacto existente | Confirmar (usando el existente) o rechazar | Prospectos → Importaciones |
| Audiencia: prospectos en espera que no están listos | No recibirán correo aunque estén en la campaña | Corregir el motivo (giro, tamaño, correo) o sacarlos de la fila | Prospectos → filtro por campaña |
| Datos de prueba | Se mezclan con los reales y ensucian los KPI | Borrarlos antes de cargar la lista real (Manual de datos §8) | — |

## 5. Actualización de la estructura

Cuando una migración nueva cambia la base:

1. Aplicarla antes de desplegar la API (RUNBOOK §6).
2. **Regenerar el diccionario** con [`generar-diccionario.mjs`](generar-diccionario.mjs) y completar las descripciones de los
   campos nuevos que salgan con ⚠.
3. Si la migración agrega una regla de datos, sumarla al [reporte de controles](REPORTE_DE_CONTROLES.md) con su prueba.
4. Si cambia algo que la auditoría revisa (un estado nuevo, un campo obligatorio), ajustar `auditar-datos.mjs`.

## 6. Registro

| Fecha | Momento | T1.1 (sin prueba) | T1.2 (sin prueba) | Reporte |
|---|---|---|---|---|
| 28-oct-2026 | Línea base para G4 | 96.6 % | 96.6 % | [calidad-2026-10-28](auditorias/calidad-2026-10-28.md) |
