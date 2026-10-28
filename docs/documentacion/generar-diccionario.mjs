// Genera DICCIONARIO_DE_DATOS.md a partir de la base REAL (information_schema)
// y de los comentarios de src/database/schema.ts, más las descripciones de
// negocio de este archivo. Correrlo después de cada migración nueva:
//
//   DICCIONARIO_DB_URL="mysql://usuario:contraseña@127.0.0.1:33306/<base migrada>" node docs/documentacion/generar-diccionario.mjs
//
// La base tiene que tener todas las migraciones aplicadas (npm run migrate).
// Solo lee; no imprime la URL. Si una tabla o campo nuevo no tiene
// descripción aquí, sale marcado con ⚠ para completarlo.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const require = createRequire(join(RAIZ, "package.json"));
const mysql = require("mysql2/promise");

// --- Descripciones de negocio --------------------------------------------------
// modulo, para qué sirve, quién la escribe (fuente) y cómo cambia (actualización).
const FUENTE = {
  crm: "CRM (pantallas, con sesión)",
  csv: "Importación CSV del CRM",
  n8n: "n8n (API /automatizacion, llave X-API-Key)",
  sistema: "La API sola (trabajos programados o efectos de otra acción)",
  semilla: "Migración (valores iniciales)"
};
const TABLAS = {
  empresas: ["Clientes y prospección", "Empresa (persona moral o negocio) con la que se trata. Es la ficha del cliente.", ["crm", "csv", "n8n"], "Se edita desde la ficha. No se borra: se desactiva (activo = 0) y deja de aparecer."],
  contactos: ["Clientes y prospección", "Persona dentro de una empresa. Todo contacto pertenece a una empresa.", ["crm", "csv", "n8n"], "Se edita desde la ficha o Contactos. No se borra: se desactiva."],
  medios_contacto: ["Clientes y prospección", "Correos, teléfonos, WhatsApp, LinkedIn o sitio web de un contacto o de una empresa (exactamente uno de los dos, ver chk_medio_un_dueno). Es la base de la deduplicación.", ["crm", "csv", "n8n"], "Se agrega o se marca no_contactar / obsoleto; no se borra. Una baja o un rebote lo pasa a no_contactar."],
  prospectos: ["Clientes y prospección", "Un contacto dentro del proceso de prospección (una 'entrada' al embudo). La misma persona puede tener varios prospectos en el tiempo (ciclos de 6 meses).", ["crm", "csv", "n8n"], "El estado lo cambian n8n (validación, scoring, envíos, respuestas) y el CRM (clasificación, fila de automatización). Cada cambio de estado deja registro en auditoria."],
  borradores_captura: ["Clientes y prospección", "Área de carga (staging): cada fila de una importación CSV o de un alta manual antes de volverse empresa + contacto + prospecto. Separa la carga del maestro.", ["csv", "crm"], "Una persona confirma o rechaza cada fila. Las no confirmadas expiran a los 30 días (trabajo programado)."],
  campanas: ["Campañas y correo", "Campaña de prospección: agrupa prospectos y tiene vigencia y estado.", ["crm"], "Administración la crea, pausa o finaliza."],
  plantillas_correo: ["Campañas y correo", "Texto de los 3 correos de prospección (1 = inicial, 2 y 3 = recordatorios). giro vacío = general.", ["crm", "semilla"], "Administrador o supervisor la edita en Administración → Correos de prospección."],
  parametros_automatizacion: ["Campañas y correo", "Parámetros de la automatización que lee n8n (ej. pie de los correos).", ["crm", "semilla"], "Se edita en Administración."],
  envios: ["Campañas y correo", "Cada correo de prospección que salió (inicial o recordatorio) y su ventana de espera de respuesta.", ["n8n"], "n8n lo registra al enviar; la ventana pasa a vencida o cerrada (al responder). No se borra."],
  respuestas: ["Campañas y correo", "Respuesta de un prospecto a un correo (entra por SendGrid Inbound Parse → n8n). Incluye su clasificación.", ["n8n", "crm"], "n8n la registra y propone una clasificación; una persona puede clasificarla o corregirla en el CRM."],
  correos_respuesta: ["Campañas y correo", "Correo que un vendedor le contestó a un prospecto desde el CRM (etapa 3), en el mismo hilo.", ["crm"], "Se crea al mandar; pasa de enviando a enviado o fallido. No se edita."],
  lista_supresion: ["Campañas y correo", "Correos, teléfonos o WhatsApp a los que nunca se les escribe (bajas, rebotes, quejas).", ["n8n", "crm", "sistema"], "Solo se agrega. Pesa más que cualquier otra regla."],
  resultados_scoring: ["Automatización (n8n)", "Cada calificación (score 0-100) que n8n calculó para un prospecto, con Gemini o reglas.", ["n8n"], "Solo se inserta (historial). El score vigente se copia a prospectos."],
  incidencias: ["Automatización (n8n)", "Problemas que reporta n8n durante una corrida (dato faltante, servicio caído).", ["n8n"], "Se registra abierta y se marca resuelta."],
  procesos_fallidos: ["Automatización (n8n)", "Fallas que requieren revisión humana (errores críticos de un flujo o eventos que no se pudieron entregar).", ["n8n", "sistema"], "Se revisa y se marca resuelto en Administración."],
  eventos_pendientes: ["Automatización (n8n)", "Bandeja de salida (patrón outbox): avisos de la API hacia n8n que se reintentan hasta entregarse.", ["sistema"], "El despachador la procesa sola: pendiente → enviado o fallido."],
  oportunidades: ["Ventas", "Posible venta con una empresa: etapa del embudo, valor estimado y fecha de cierre.", ["crm"], "Avanza de etapa (cada cambio queda en historial_etapa_oportunidad); se cierra ganada o perdida."],
  historial_etapa_oportunidad: ["Ventas", "Cada cambio de etapa de una oportunidad, con quién y por qué (motivo si se perdió).", ["sistema"], "Solo se inserta."],
  cotizaciones: ["Ventas", "Cotización de una oportunidad. Cada versión es una fila; las anteriores quedan obsoletas (historial inmutable).", ["crm"], "Borrador → enviada → aceptada / rechazada / vencida. Cambiar una enviada crea una versión nueva."],
  cotizacion_partidas: ["Ventas", "Renglones (conceptos) de una cotización.", ["crm"], "Se guardan con su versión; no se editan después."],
  documentos: ["Documentos", "Archivos del expediente (PDF, DOCX, XLSX, PNG, JPG) guardados en Google Cloud Storage; aquí van sus datos. Cada versión es una fila.", ["crm"], "Se sube versión nueva; se aprueba o rechaza con motivo; se archiva. No se borra físicamente al desactivar."],
  catalogo_tipo_documento: ["Documentos", "Tipos de documento (contrato, constancia fiscal…) y si son obligatorios en el expediente.", ["semilla", "crm"], "Administración marca cuáles son obligatorios."],
  tareas: ["Seguimiento", "Pendientes de una persona (llamar, clasificar una respuesta, corregir un documento). Las crea una persona o la automatización.", ["crm", "n8n", "sistema"], "pendiente → en_progreso → cerrada / cancelada. Responsable vacío = 'Sin asignar'."],
  actividades: ["Seguimiento", "Lo que ya pasó y se anotó a mano: llamadas, WhatsApp y comentarios.", ["crm"], "Solo se inserta (bitácora)."],
  notificaciones: ["Seguimiento", "Avisos para cada usuario («Lo nuevo para ti») y, si aplica, su correo.", ["sistema"], "Se marca leída; el correo pasa de pendiente a enviado o fallido."],
  uso_ia: ["Seguimiento", "Cada uso de la IA desde el CRM (borradores de respuesta y resúmenes de ficha), para límites diarios y trazabilidad.", ["crm"], "Solo se inserta."],
  catalogo_etapa_embudo: ["Catálogos", "Etapas del embudo de ventas con su probabilidad y orden.", ["semilla"], "Fijo; cambia solo por migración."],
  catalogo_motivo_perdida: ["Catálogos", "Motivos por los que se pierde una oportunidad.", ["semilla"], "Fijo; cambia solo por migración."],
  metricas_comerciales_diarias: ["Reportes", "Foto diaria de las métricas comerciales (pipeline, ganado, perdido) para las gráficas históricas.", ["sistema"], "Un trabajo diario inserta o recalcula la fila del día."],
  usuarios: ["Usuarios y seguridad", "Personas que usan el CRM y su rol.", ["crm", "semilla"], "Solo administración los crea, edita o desactiva."],
  roles: ["Usuarios y seguridad", "Roles: administrador, supervisor y agente (vendedor).", ["semilla"], "Fijo."],
  sesiones: ["Usuarios y seguridad", "Sesiones abiertas. Se guarda el hash del token, nunca el token.", ["sistema"], "Se crean al entrar y se borran al salir, al expirar (12 h) o al desactivar al usuario."],
  login_fallos: ["Usuarios y seguridad", "Intentos fallidos de entrar por correo, para bloquear 15 minutos tras 10 fallos.", ["sistema"], "Se limpia sola con un trabajo programado."],
  auditoria: ["Usuarios y seguridad", "Registro de cambios: quién cambió qué, con el antes y el después (JSON). Es la bitácora de cambios del maestro.", ["sistema"], "Solo se inserta; no se edita ni se borra."],
  schema_migrations: ["Sistema", "Qué migraciones ya se aplicaron a esta base.", ["sistema"], "Lo escribe npm run migrate."]
};
const ORDEN_MODULOS = ["Clientes y prospección", "Campañas y correo", "Automatización (n8n)", "Ventas", "Documentos", "Seguimiento", "Reportes", "Catálogos", "Usuarios y seguridad", "Sistema"];

// Campos que se repiten en muchas tablas.
const COMUNES = {
  id: "Identificador interno, autonumérico.",
  creado_en: "Cuándo se creó el registro.",
  actualizado_en: "Última modificación.",
  activo: "1 = vigente; 0 = desactivado (se oculta, no se borra).",
  execution_id: "Identificador de la corrida de n8n que lo creó. Único: si n8n reintenta, no se duplica (idempotencia).",
  empresa_id: "Empresa a la que pertenece.",
  contacto_id: "Contacto al que pertenece.",
  prospecto_id: "Prospecto relacionado.",
  oportunidad_id: "Oportunidad relacionada.",
  usuario_id: "Usuario relacionado.",
  responsable_id: "Usuario responsable.",
  linkedin_url: "Perfil de LinkedIn (solo http/https).",
  facebook_url: "Página de Facebook (solo http/https).",
  instagram_url: "Perfil de Instagram (solo http/https).",
  nombre: "Nombre.",
  titulo: "Título.",
  asunto: "Asunto del correo.",
  texto: "Texto del correo.",
  cuerpo: "Texto del mensaje.",
  mensaje: "Descripción del problema.",
  descripcion: "Descripción.",
  comentario: "Comentario de quien lo registró.",
  observaciones: "Notas libres.",
  error: "Error, si falló.",
  ultimo_error: "Último error al intentar.",
  canal: "Canal: correo o WhatsApp (WhatsApp todavía no se usa).",
  tipo: "Tipo (valores en Formato).",
  estado: "Estado (valores en Formato).",
  severidad: "Gravedad (valores en Formato).",
  orden: "Orden en que se muestra.",
  detalle: "Detalle adicional.",
  payload: "Datos completos del evento (JSON).",
  clave: "Clave fija que usa el código.",
  probabilidad: "Probabilidad de cierre, en porcentaje.",
  workflow: "Flujo de n8n donde ocurrió.",
  nodo: "Nodo del flujo de n8n.",
  endpoint: "Ruta de la API que se estaba llamando.",
  codigo_http: "Código HTTP de la respuesta, si hubo.",
  score: "Calificación 0-100.",
  prioridad: "Prioridad (valores en Formato).",
  confianza: "Confianza (valores en Formato).",
  remitente: "Dirección «De» del correo recibido.",
  message_id: "Identificador del correo, para contestar en el mismo hilo.",
  resultado: "Resultado (texto, o JSON según el uso).",
  version: "Número de versión (1, 2, 3…).",
  motivo_rechazo: "Por qué se rechazó (valores en Formato).",
  motivo_rechazo_detalle: "Explicación del rechazo (obligatoria con el motivo «otro»).",
  motivo_perdida_detalle: "Explicación de la pérdida (obligatoria en los motivos que la piden).",
  creado_por: "Quién lo creó (vacío = la automatización).",
  creada_por: "Quién la creó (vacío = la automatización).",
  actualizado_por: "Quién lo cambió por última vez.",
  subido_por: "Quién lo subió.",
  respuesta_id: "Respuesta relacionada.",
  envio_id: "Envío al que responde.",
  campana_id: "Campaña relacionada.",
  documento_id: "Documento relacionado.",
  evento_id: "Evento de la bandeja de salida relacionado.",
  entidad: "Tipo de registro al que se refiere (empresa, tarea…).",
  entidad_tipo: "Tipo de registro al que se refiere.",
  entidad_id: "Identificador de ese registro.",
  puesto: "Puesto de la persona.",
  area: "Área o departamento.",
  ciudad: "Ciudad. Texto libre.",
  correo: "Correo electrónico."
};
// Campos del área de carga que copian uno del maestro.
const COPIA_BORRADOR = { empresa_: "empresas.", contacto_: "contactos.", correo: "medios_contacto (correo)", telefono: "medios_contacto (teléfono)", confianza: "prospectos.confianza", prioridad: "prospectos.prioridad", score: "prospectos.score", fuente_url: "prospectos.fuente_url", observaciones: "una actividad de comentario" };
function descripcionPorNombre(t, c, tipo) {
  if (t === "borradores_captura") {
    for (const [prefijo, destino] of Object.entries(COPIA_BORRADOR)) {
      if (c === prefijo) return `Como venía en la fila; al confirmarla pasa a ${destino}.`;
      if (prefijo.endsWith("_") && c.startsWith(prefijo)) return `Como venía en la fila; al confirmarla pasa a \`${destino}${c.slice(prefijo.length)}\`.`;
    }
  }
  if (/_(en|hasta)$/.test(c) && /^(datetime|date)/.test(tipo)) return `Fecha: ${c.replace(/_/g, " ")}.`;
  return null;
}
// Campos de negocio que no se explican solos.
const CAMPOS = {
  "empresas.nombre_legal": "Razón social o nombre con el que se registró. Obligatorio, 2-255 caracteres.",
  "empresas.nombre_comercial": "Nombre con el que se le conoce; si existe, se muestra en lugar del legal.",
  "empresas.giro": "Industria. Texto libre (sin catálogo) ⚠. Sin giro, la automatización no le escribe.",
  "empresas.tamano": "Tamaño de la empresa. Sin tamaño, la automatización no le escribe.",
  "empresas.region": "Región (ej. Bajío). Texto libre.",
  "empresas.estado": "Estado de la República. Texto libre.",
  "empresas.pais": "País, clave ISO de 2 letras. Por omisión MX.",
  "empresas.sitio_web": "Sitio web (solo http/https).",
  "empresas.propietario_id": "Vendedor dueño de la cuenta. Un agente solo ve sus empresas. Vacío = sin responsable.",
  "contactos.nombre": "Nombre de la persona. Obligatorio, 2-160 caracteres.",
  "medios_contacto.tipo": "Qué es: correo, teléfono, WhatsApp, LinkedIn o sitio web.",
  "medios_contacto.valor": "Como se capturó (para mostrarlo).",
  "medios_contacto.valor_normalizado": "Versión para comparar: correo en minúsculas y sin espacios; teléfono solo dígitos. Único por tipo en toda la base.",
  "medios_contacto.es_principal": "El medio que se usa primero de ese tipo.",
  "medios_contacto.estado_contacto": "activo = se le puede escribir; no_contactar = baja, rebote o queja; obsoleto = ya no sirve.",
  "prospectos.estado": "Etapa en la prospección. Texto (no ENUM) ⚠: los valores válidos están en la sección «Estados del prospecto».",
  "prospectos.score": "Calificación 0-100 de la automatización (última de resultados_scoring).",
  "prospectos.prioridad": "Prioridad que asigna el scoring.",
  "prospectos.confianza": "Qué tan confiable es el dato de origen.",
  "prospectos.fuente_url": "De dónde salió el dato (página, directorio). Solo http/https.",
  "prospectos.campana_id": "Campaña en la que va.",
  "prospectos.fila_desde": "Cuándo se mandó a la fila de automatización (botón «Mandar a automatización»).",
  "prospectos.fila_por": "Quién lo mandó a la fila.",
  "prospectos.fila_tomado_en": "Cuándo lo tomó n8n de la fila.",
  "prospectos.fila_execution_id": "Corrida de n8n que lo tomó de la fila.",
  "prospectos.fila_estado_previo": "Estado que tenía antes de entrar a la fila (para regresarlo si se saca).",
  "borradores_captura.lote_id": "Identificador del archivo o lote importado.",
  "borradores_captura.fuente": "De dónde vino la fila (archivo CSV o alta manual).",
  "borradores_captura.fila_numero": "Número de renglón en el archivo.",
  "borradores_captura.fila_original": "La fila tal como venía, para revisarla.",
  "borradores_captura.correo_normalizado": "Correo normalizado, para detectar duplicados.",
  "borradores_captura.telefono_normalizado": "Teléfono normalizado (solo dígitos), para detectar duplicados.",
  "borradores_captura.canal_inicial": "Por dónde se le contactará primero. Debe tener su medio en la misma fila.",
  "borradores_captura.estado": "pendiente_revision = lista para confirmar; duplicado = ya existe esa persona; importado; rechazado; expirado (30 días sin confirmar).",
  "borradores_captura.match_contacto_id": "Contacto existente con el que coincidió (si es duplicado).",
  "borradores_captura.match_motivo": "Por qué coincidió: mismo correo o, si no trae correo, mismo teléfono.",
  "borradores_captura.errores": "Errores de validación de la fila (JSON), en español.",
  "borradores_captura.expira_en": "Fecha en que la fila expira si nadie la confirma.",
  "campanas.estado": "borrador, activa, pausada o finalizada. Solo una campaña vigente manda correos.",
  "envios.numero_contacto": "1 = correo inicial; 2 y 3 = recordatorios. Máximo 3 por persona cada 6 meses.",
  "envios.ventana_vence_en": "Hasta cuándo se espera respuesta antes del siguiente recordatorio (5 días hábiles).",
  "envios.ventana_estado": "abierta = esperando; vencida = toca recordatorio; cerrada = ya respondió o terminó.",
  "envios.enviado_en": "Cuándo salió el correo.",
  "envios.asunto": "Asunto con el que salió.",
  "respuestas.contenido": "Texto de la respuesta del prospecto.",
  "respuestas.tardia": "Llegó después de cerrada la ventana.",
  "respuestas.estado": "pendiente_clasificacion o clasificada.",
  "respuestas.clasificacion": "Decisión final (persona o n8n). invalido y reagendar solo los pone una persona.",
  "respuestas.confianza_sugerida": "Confianza 0-100 de la sugerencia de la IA.",
  "respuestas.motivo_sugerencia": "Por qué la IA propuso esa clasificación.",
  "correos_respuesta.para": "Destinatario: siempre el remitente de la respuesta original (no se puede cambiar).",
  "correos_respuesta.uso_ia": "sin_ia, tal_cual (borrador de la IA sin cambios) o editado.",
  "correos_respuesta.proveedor_id": "Identificador del correo en SendGrid.",
  "lista_supresion.valor_normalizado": "Correo o teléfono normalizado. Único por tipo.",
  "lista_supresion.motivo": "Por qué se suprimió (baja, rebote, queja…).",
  "resultados_scoring.metodo": "gemini = lo calculó la IA; reglas = respaldo sin IA.",
  "resultados_scoring.detalle": "Desglose del cálculo (JSON).",
  "oportunidades.etapa_id": "Etapa actual del embudo (catalogo_etapa_embudo).",
  "oportunidades.valor_estimado": "Monto esperado en MXN.",
  "oportunidades.cerrada": "1 = ganada o perdida.",
  "oportunidades.motivo_perdida_id": "Motivo del catálogo si se perdió.",
  "cotizaciones.cotizacion_raiz_id": "Primera versión de esta cotización (agrupa sus versiones).",
  "cotizaciones.version": "Número de versión (1, 2, 3…).",
  "cotizaciones.moneda": "Siempre MXN.",
  "cotizaciones.total": "subtotal − descuento + impuestos, en MXN (DECIMAL, sin redondeos de punto flotante).",
  "cotizaciones.estado": "borrador, enviada, aceptada, rechazada, vencida u obsoleta (versión reemplazada).",
  "cotizacion_partidas.importe": "cantidad × precio_unitario.",
  "documentos.documento_raiz_id": "Primera versión de este documento.",
  "documentos.storage_key": "Ruta del archivo en el almacenamiento (Google Cloud Storage). No se expone.",
  "documentos.estado": "vigente, obsoleto (hay versión nueva) o archivado.",
  "documentos.revision": "por_revisar, aprobado o rechazado (de esta versión).",
  "documentos.alertado_en": "Cuándo se avisó que seguía sin revisar.",
  "tareas.tipo": "seguimiento, clasificacion (de una respuesta), revision_documento u otro.",
  "tareas.fecha_limite": "Para cuándo. Vencida si pasó y sigue abierta.",
  "tareas.clasificacion": "Clasificación elegida al cerrar una tarea de clasificación.",
  "tareas.resultado": "Qué pasó al cerrarla.",
  "actividades.tipo": "llamada, whatsapp o comentario.",
  "actividades.ocurrida_en": "Cuándo pasó (puede ser antes de anotarlo).",
  "actividades.proxima_accion": "Qué sigue, si se anotó.",
  "usuarios.correo": "Correo para entrar. Único.",
  "usuarios.password_hash": "Contraseña cifrada con Argon2id. Nunca se guarda la contraseña.",
  "auditoria.entidad": "Qué tipo de registro cambió (empresa, prospecto…).",
  "auditoria.accion": "Qué se hizo (crear, editar, cambiar estado…).",
  "auditoria.antes": "Valores antes del cambio (JSON).",
  "auditoria.despues": "Valores después del cambio (JSON).",
  "eventos_pendientes.payload": "Datos del aviso para n8n (JSON).",
  "eventos_pendientes.intentos": "Cuántas veces se intentó entregar (reintentos a los 5 s, 30 s y 120 s).",
  "metricas_comerciales_diarias.fecha": "Día de la foto (clave).",
  "parametros_automatizacion.clave": "Nombre del parámetro (clave).",
  "parametros_automatizacion.valor": "Valor (JSON).",
  "campanas.fecha_inicio": "Desde cuándo manda correos. Vacía = desde que se activa.",
  "campanas.fecha_fin": "Hasta cuándo manda correos. Vacía = sin fin.",
  "plantillas_correo.giro": "Giro al que aplica; vacío = la general.",
  "plantillas_correo.numero": "1 = correo inicial; 2 y 3 = recordatorios.",
  "plantillas_correo.cuerpo": "Texto del correo. Admite {{primer_nombre}}, {{empresa}} y enlaces [texto](https://…).",
  "envios.plantilla_id": "Plantilla con la que salió (para rearmarlo si n8n reintenta).",
  "respuestas.execution_id_clasificacion": "Corrida de n8n que la clasificó (única).",
  "respuestas.execution_id_sugerencia": "Corrida de n8n que hizo la sugerencia.",
  "respuestas.recibido_en": "Cuándo llegó.",
  "eventos_pendientes.evento_uuid": "Identificador único del evento (n8n lo usa para no procesarlo dos veces).",
  "eventos_pendientes.proximo_intento_en": "Cuándo se vuelve a intentar entregarlo.",
  "cotizaciones.subtotal": "Suma de los importes de las partidas, en MXN.",
  "cotizaciones.descuento": "Descuento en MXN.",
  "cotizaciones.impuestos": "IVA en MXN.",
  "cotizaciones.fecha_emision": "Fecha del documento.",
  "cotizaciones.fecha_envio": "Cuándo se marcó enviada al cliente.",
  "cotizaciones.fecha_esperada_cierre": "Vigencia: hasta cuándo es válida; después pasa a vencida.",
  "cotizaciones.probabilidad": "Probabilidad de que la acepten, en porcentaje.",
  "cotizacion_partidas.cantidad": "Cantidad.",
  "cotizacion_partidas.precio_unitario": "Precio por unidad en MXN.",
  "oportunidades.fecha_cierre_estimada": "Cuándo se espera cerrar. Vencida si pasó y sigue abierta.",
  "catalogo_tipo_documento.solo_con_factura": "Solo se pide si la venta lleva factura.",
  "catalogo_etapa_embudo.es_cierre": "La etapa cierra la oportunidad (ganada o perdida).",
  "catalogo_etapa_embudo.es_ganada": "La etapa es «ganada».",
  "catalogo_motivo_perdida.requiere_explicacion": "Pide escribir la explicación al elegirlo.",
  "documentos.nombre_original": "Nombre del archivo como se subió.",
  "documentos.mime_type": "Tipo de archivo (PDF, DOCX, XLSX, PNG o JPG; se revisa el contenido real).",
  "documentos.tamano_bytes": "Tamaño en bytes (máximo 25 MB).",
  "documentos.storage_driver": "Dónde se guarda: gcs (Google Cloud Storage) o local (pruebas).",
  "documentos.politica_retencion": "Política de conservación, si se definió.",
  "notificaciones.enlace": "A qué pantalla lleva el aviso.",
  "notificaciones.leida_en": "Cuándo la leyó (vacío = no leída).",
  "notificaciones.correo_estado": "Si además salió por correo: no_aplica, pendiente, enviado o fallido.",
  "notificaciones.correo_intentos": "Intentos de mandar el correo.",
  "uso_ia.tipo": "borrador_respuesta (etapa 3) o resumen_ficha (etapa 4).",
  "uso_ia.resultado": "Lo que regresó la IA (JSON), para mostrar el último resumen.",
  "metricas_comerciales_diarias.oportunidades_abiertas": "Oportunidades abiertas ese día.",
  "metricas_comerciales_diarias.valor_pipeline": "Valor de las oportunidades abiertas, en MXN.",
  "metricas_comerciales_diarias.oportunidades_ganadas": "Ganadas ese día.",
  "metricas_comerciales_diarias.ingresos_cerrados": "Valor ganado ese día, en MXN.",
  "metricas_comerciales_diarias.oportunidades_perdidas": "Perdidas ese día.",
  "metricas_comerciales_diarias.valor_perdido": "Valor perdido ese día, en MXN.",
  "login_fallos.correo": "Correo con el que se intentó entrar (clave).",
  "login_fallos.fallos": "Intentos fallidos dentro de la ventana de 15 minutos.",
  "sesiones.id": "Hash SHA-256 del token de sesión (nunca el token).",
  "sesiones.expira_en": "Cuándo vence (12 horas).",
  "usuarios.avisos_por_correo": "Si recibe los avisos también por correo.",
  "schema_migrations.version": "Archivo de migración aplicado (clave).",
  "lista_supresion.tipo": "Qué se suprime: correo, teléfono o WhatsApp.",
  "notificaciones.correo_error": "Error de SendGrid si el correo del aviso falló.",
  "login_fallos.ventana_inicio": "Inicio de la ventana de 15 minutos en que se cuentan los fallos.",
  "schema_migrations.applied_at": "Cuándo se aplicó.",
  "tareas.responsable_id": "Quién la atiende. Vacío = «Sin asignar» (así llegan las que crea la automatización).",
  "tareas.creada_por": "Quién la creó. Vacío = la automatización (n8n).",
  "tareas.respuesta_id": "Respuesta que originó una tarea de clasificación; vacío en las demás.",
  "tareas.documento_id": "Documento rechazado de una tarea «Corregir documento»; vacío en las demás.",
  "tareas.alertado_en": "Cuándo se avisó que estaba vencida.",
  "tareas.cerrada_en": "Cuándo se cerró.",
  "respuestas.clasificado_en": "Cuándo se clasificó.",
  "respuestas.sugerido_en": "Cuándo la IA hizo la sugerencia.",
  "notificaciones.correo_enviado_en": "Cuándo salió el correo del aviso.",
  "correos_respuesta.enviado_en": "Cuándo confirmó SendGrid el envío.",
  "documentos.revisado_en": "Cuándo se aprobó o rechazó.",
  "borradores_captura.procesado_en": "Cuándo se confirmó o rechazó la fila.",
  "metricas_comerciales_diarias.calculado_en": "Cuándo se calculó la fila.",
  "login_fallos.bloqueado_hasta": "Hasta cuándo está bloqueado ese correo (15 minutos tras 10 fallos).",
  "usuarios.ultimo_acceso_en": "Última vez que usó el CRM."
};

// --- Lectura de la base ---------------------------------------------------------
const url = new URL(process.env.DICCIONARIO_DB_URL ?? "");
const conexion = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) });
const esquema = url.pathname.slice(1);
const [columnas] = await conexion.query("SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE tipo, IS_NULLABLE nulo, COLUMN_DEFAULT def, COLUMN_KEY llave, EXTRA extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION", [esquema]);
const [fks] = await conexion.query("SELECT TABLE_NAME t, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL", [esquema]);
const [unicos] = await conexion.query("SELECT TABLE_NAME t, INDEX_NAME i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND NON_UNIQUE = 0 GROUP BY TABLE_NAME, INDEX_NAME", [esquema]);
const [checks] = await conexion.query("SELECT tc.TABLE_NAME t, cc.CONSTRAINT_NAME n, cc.CHECK_CLAUSE regla FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME WHERE cc.CONSTRAINT_SCHEMA = ?", [esquema]);
const [[migracion]] = await conexion.query("SELECT MAX(version) v, COUNT(*) n FROM schema_migrations");
await conexion.end();

// Comentarios de schema.ts (el comentario // justo arriba de un campo).
const comentarios = {};
let tabla = null;
let buffer = [];
for (const linea of readFileSync(join(RAIZ, "src", "database", "schema.ts"), "utf8").split(/\r?\n/)) {
  const t = linea.match(/mysqlTable\("(\w+)"/);
  if (t) { tabla = t[1]; buffer = []; continue; }
  const c = linea.match(/^\s*\/\/\s?(.*)$/);
  if (c) { buffer.push(c[1].trim()); continue; }
  const campo = linea.match(/^\s+\w+:\s*\w+\("(\w+)"/);
  if (campo && tabla && buffer.length) comentarios[`${tabla}.${campo[1]}`] = sinReferenciasTecnicas(buffer.join(" "));
  buffer = [];
}
// "022_clasificacion_manual.sql: la respuesta…" → "La respuesta…": el diccionario
// lo lee Dirección; el número de migración no le dice nada.
function sinReferenciasTecnicas(texto) {
  const limpio = texto
    .replace(/^(Nullable desde )?\d{3}(_[a-z_]+)?(\.sql)?:\s*/i, "")
    .replace(/^Etapa \d+ \(\d+\):\s*/i, "")
    .replace(/\s*\(\d{3}(_[a-z_]+)?(\.sql)?\)/g, "");
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

// --- Formato --------------------------------------------------------------------
function formato(tipo) {
  let m;
  if ((m = tipo.match(/^varchar\((\d+)\)/))) return `texto (máx. ${m[1]})`;
  if ((m = tipo.match(/^char\((\d+)\)/))) return `texto fijo (${m[1]})`;
  if ((m = tipo.match(/^enum\((.*)\)$/))) return `uno de: ${m[1].replace(/'/g, "").replace(/,/g, ", ")}`;
  if ((m = tipo.match(/^decimal\((\d+),(\d+)\)/))) return `número decimal (${m[2]} decimales)`;
  if (tipo === "tinyint(1)") return "sí/no (1/0)";
  if (/^(bigint|int|smallint|tinyint)/.test(tipo)) return "entero";
  if (tipo === "datetime") return "fecha y hora (UTC)";
  if (tipo === "date") return "fecha (AAAA-MM-DD)";
  if (tipo === "json") return "JSON";
  if (/text$/.test(tipo)) return "texto largo";
  return tipo;
}
const celda = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

const porTabla = {};
for (const c of columnas) (porTabla[c.t] ??= []).push(c);
const fkDe = {};
for (const f of fks) fkDe[`${f.t}.${f.c}`] = `${f.rt}.${f.rc}`;
const unicosDe = {};
for (const u of unicos) (unicosDe[u.t] ??= []).push(u);
const checksDe = {};
for (const ch of checks) (checksDe[ch.t] ??= []).push(ch);

const sinDescripcion = [];
const secciones = [];
const tablasPorModulo = {};
for (const t of Object.keys(porTabla)) {
  const meta = TABLAS[t];
  const modulo = meta?.[0] ?? "⚠ Sin módulo";
  (tablasPorModulo[modulo] ??= []).push(t);
}
const modulos = [...ORDEN_MODULOS.filter((m) => tablasPorModulo[m]), ...Object.keys(tablasPorModulo).filter((m) => !ORDEN_MODULOS.includes(m))];

for (const modulo of modulos) {
  secciones.push(`### ${modulo}\n`);
  for (const t of tablasPorModulo[modulo].sort()) {
    const meta = TABLAS[t];
    if (!meta) sinDescripcion.push(`tabla ${t}`);
    const lineas = [];
    lineas.push(`#### \`${t}\`\n`);
    lineas.push(meta ? meta[1] : "⚠ Sin descripción todavía.");
    lineas.push("");
    if (meta) {
      lineas.push(`- **Fuente:** ${meta[2].map((f) => FUENTE[f]).join("; ")}.`);
      lineas.push(`- **Actualización:** ${meta[3]}`);
    }
    const pk = porTabla[t].filter((c) => c.llave === "PRI").map((c) => c.c);
    lineas.push(`- **Identificador:** \`${pk.join(", ")}\`${pk.length > 1 ? " (compuesto)" : ""}.`);
    const uq = (unicosDe[t] ?? []).filter((u) => u.i !== "PRIMARY");
    if (uq.length) lineas.push(`- **Únicos (no se pueden repetir):** ${uq.map((u) => `\`${u.cols.split(",").join(" + ")}\``).join("; ")}.`);
    for (const ch of checksDe[t] ?? []) lineas.push(`- **Regla en la base (\`${ch.n}\`):** \`${ch.regla.replace(/`/g, "")}\``);
    lineas.push("");
    lineas.push("| Campo | Formato | Obligatorio | Descripción |");
    lineas.push("|---|---|---|---|");
    for (const c of porTabla[t]) {
      const clave = `${t}.${c.c}`;
      const partes = [];
      const desc = CAMPOS[clave] ?? comentarios[clave] ?? COMUNES[c.c] ?? descripcionPorNombre(t, c.c, c.tipo);
      if (desc) partes.push(desc);
      else if (!fkDe[clave]) { partes.push("⚠ Sin descripción."); sinDescripcion.push(clave); }
      if (fkDe[clave]) partes.push(`→ \`${fkDe[clave]}\``);
      if (c.def !== null && c.def !== undefined && !/CURRENT_TIMESTAMP/i.test(c.def)) partes.push(`Por omisión: \`${c.def}\`.`);
      if (/CURRENT_TIMESTAMP/i.test(c.def ?? "") && !desc) partes.push("Se llena sola con la hora del momento.");
      const obligatorio = c.extra.includes("auto_increment") ? "auto" : c.nulo === "NO" ? "sí" : "no";
      lineas.push(`| \`${c.c}\` | ${celda(formato(c.tipo))} | ${obligatorio} | ${celda(partes.join(" "))} |`);
    }
    lineas.push("");
    secciones.push(lineas.join("\n"));
  }
}

const totalCampos = columnas.length;
const hoy = new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
const plantilla = readFileSync(join(AQUI, "diccionario.plantilla.md"), "utf8");
const indice = modulos.map((m) => `- **${m}:** ${tablasPorModulo[m].sort().map((t) => `\`${t}\``).join(", ")}`).join("\n");
// Reemplazos con función: así un "$" en una descripción no se lee como patrón de replace().
const valores = {
  FECHA: hoy,
  MIGRACION: migracion.v,
  MIGRACIONES: String(migracion.n),
  TOTALES: `${Object.keys(porTabla).length} tablas y ${totalCampos} campos`,
  INDICE: indice,
  TABLAS: secciones.join("\n"),
  PENDIENTES: sinDescripcion.length ? sinDescripcion.map((s) => `- \`${s}\``).join("\n") : "Ninguno: todas las tablas y campos tienen descripción."
};
const salida = plantilla.replace(/\{\{(FECHA|MIGRACIONES|MIGRACION|TOTALES|INDICE|TABLAS|PENDIENTES)\}\}/g, (_, clave) => valores[clave]);
writeFileSync(join(AQUI, "DICCIONARIO_DE_DATOS.md"), salida);
console.log(`DICCIONARIO_DE_DATOS.md: ${Object.keys(porTabla).length} tablas, ${totalCampos} campos, ${sinDescripcion.length} sin descripción`);
