"""Datos de ejemplo para las capturas del manual del vendedor (4-nov-2026).

Solo contra un CRM LOCAL con una base vacía: crea el primer administrador
(pasante@local.test / pasante12345) con /auth/bootstrap y luego empresas,
contactos, prospectos, oportunidades, una cotización, tareas, una respuesta
con sugerencia de la IA, una importación y un documento. Nada es real.
LLAVE es la CRM_CALLBACK_API_KEY de la API local.
"""
import json, urllib.request, http.cookiejar, uuid, datetime
A = "http://localhost:3000/api/v1"
LLAVE = "local_crm_callback_api_key_0001"
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def pedir(metodo, ruta, cuerpo=None, llave=False, crudo=None, tipo=None):
    datos = crudo if crudo is not None else (json.dumps(cuerpo, ensure_ascii=False).encode("utf-8") if cuerpo is not None else None)
    h = {"Content-Type": tipo or "application/json; charset=utf-8"}
    if llave: h["X-API-Key"] = LLAVE
    req = urllib.request.Request(A + ruta, data=datos, method=metodo, headers=h)
    try:
        with op.open(req) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"null")
def multipart(campos, archivo):
    b = uuid.uuid4().hex
    partes = []
    for k, v in campos.items():
        partes.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
    nombre, tipo, contenido = archivo
    partes.append(f'--{b}\r\nContent-Disposition: form-data; name="archivo"; filename="{nombre}"\r\nContent-Type: {tipo}\r\n\r\n'.encode("utf-8") + contenido + b"\r\n")
    partes.append(f"--{b}--\r\n".encode())
    return b"".join(partes), f"multipart/form-data; boundary={b}"

print("bootstrap", pedir("POST", "/auth/bootstrap", {"nombre": "Mich (pasante)", "correo": "pasante@local.test", "password": "pasante12345"})[0])
print("login", pedir("POST", "/auth/login", {"correo": "pasante@local.test", "password": "pasante12345"})[0])
yo = pedir("GET", "/auth/me")[1]["id"]
s, e1 = pedir("POST", "/empresas", {"nombreLegal": "Aceros del Norte (ejemplo)", "giro": "manufactura", "tamano": "mediana", "ciudad": "León",
    "contactos": [{"nombre": "Ana López", "puesto": "Compras", "correo": "ana.lopez@ejemplo.test", "telefono": "477 123 4567"},
                  {"nombre": "Luis Pérez", "correo": "luis.perez@ejemplo.test"}]})
print("empresa Aceros", s, e1)
contactos = pedir("GET", f"/contactos?empresaId={e1['id']}")[1]["data"]
ana = next(c["id"] for c in contactos if c["nombre"] == "Ana López")
print("prospecto de Ana", pedir("POST", "/prospectos/desde-contacto", {"contactoId": ana}))
print("tarea", pedir("POST", "/tareas", {"tipo": "seguimiento", "titulo": "Llamarle a Ana", "responsableId": yo, "empresaId": e1["id"], "contactoId": ana}))
print("empresa Moldes 1", pedir("POST", "/empresas", {"nombreLegal": "Moldes del Bajío, S.A. de C.V.", "giro": "manufactura", "tamano": "pequena",
    "contactos": [{"nombre": "Rosa Díaz", "correo": "rosa.diaz@ejemplo.test"}]}))
def contacto(emp, nombre): return next(c["id"] for c in pedir("GET", f"/contactos?empresaId={emp}")[1]["data"] if c["nombre"] == nombre)

_, p = pedir("POST", "/empresas", {"nombreLegal": "Plásticos Querétaro", "giro": "manufactura", "tamano": "grande", "estado": "Querétaro", "ciudad": "Querétaro",
    "contactos": [{"nombre": "Carlos Méndez", "puesto": "Director de operaciones", "correo": "carlos.mendez@ejemplo.test", "telefono": "442 555 0101"}]})
_, l = pedir("POST", "/empresas", {"nombreLegal": "Logística Express del Centro", "giro": "logistica", "tamano": "mediana", "ciudad": "Celaya",
    "contactos": [{"nombre": "Sofía Ramírez", "puesto": "Gerente de compras", "correo": "sofia.ramirez@ejemplo.test"}]})
print("empresas", p, l)
luis, carlos, sofia = contacto(2, "Luis Pérez"), contacto(p["id"], "Carlos Méndez"), contacto(l["id"], "Sofía Ramírez")
pl = pedir("POST", "/prospectos/desde-contacto", {"contactoId": luis})[1]
print("prospectos", pl, pedir("POST", "/prospectos/desde-contacto", {"contactoId": carlos})[0], pedir("POST", "/prospectos/desde-contacto", {"contactoId": sofia})[0])

ana = contacto(2, "Ana López")
_, o1 = pedir("POST", "/oportunidades", {"empresaId": 2, "contactoId": ana, "titulo": "Mantenimiento de líneas de corte", "valorEstimado": 480000, "fechaCierreEstimada": "2026-12-15"})
_, o2 = pedir("POST", "/oportunidades", {"empresaId": p["id"], "contactoId": carlos, "titulo": "Automatización de inyectoras", "valorEstimado": 1280000})
_, o3 = pedir("POST", "/oportunidades", {"empresaId": l["id"], "contactoId": sofia, "titulo": "Monitoreo de flotilla", "valorEstimado": 150000})
print("oportunidades", o1, o2, o3)
print("etapas", pedir("PATCH", f"/oportunidades/{o1['id']}/etapa", {"etapaClave": "propuesta"})[0], pedir("PATCH", f"/oportunidades/{o2['id']}/etapa", {"etapaClave": "negociacion"})[0])
print("cotización", pedir("POST", "/cotizaciones", {"empresaId": 2, "oportunidadId": o1["id"], "contactoId": ana,
    "partidas": [{"descripcion": "Mantenimiento preventivo trimestral", "cantidad": 4, "precioUnitario": 85000}, {"descripcion": "Refacciones de arranque", "cantidad": 1, "precioUnitario": 140000}]}))

hoy = datetime.datetime.now(datetime.timezone.utc)
print("tareas", pedir("POST", "/tareas", {"tipo": "seguimiento", "titulo": "Mandar catálogo a Carlos", "responsableId": yo, "empresaId": p["id"], "contactoId": carlos, "prioridad": "alta", "fechaLimite": (hoy + datetime.timedelta(hours=5)).isoformat()})[0],
      pedir("POST", "/tareas", {"tipo": "seguimiento", "titulo": "Confirmar visita con Sofía", "responsableId": yo, "empresaId": l["id"], "contactoId": sofia, "fechaLimite": (hoy + datetime.timedelta(days=2)).isoformat()})[0])

_, r = pedir("POST", "/automatizacion/respuestas", {"execution_id": f"ejemplo-{uuid.uuid4()}", "prospecto_id": pl["id"], "canal": "correo",
    "contenido": "Hola, gracias por escribir. Sí nos interesa revisar lo del mantenimiento. ¿Podemos platicar el jueves en la mañana?\n\nSaludos,\nLuis", "crear_tarea_clasificacion": True}, llave=True)
print("respuesta", r)
print("sugerencia", pedir("POST", "/automatizacion/respuestas/sugerencia", {"execution_id": f"sug-{uuid.uuid4()}", "respuesta_id": r["id"], "clasificacion": "interesado", "confianza": 94, "motivo": "Pide una llamada para revisar el servicio."}, llave=True))

csv = "empresaNombreLegal,empresaGiro,empresaTamano,contactoNombre,correo,canalInicial\r\nAceros del Norte (ejemplo),manufactura,mediana,Marta Gil,marta.gil@ejemplo.test,correo\r\nTextiles San Juan,manufactura,pequena,Pedro Luna,pedro.luna@ejemplo.test,correo\r\nMoldes del Bajío,manufactura,pequena,Rosa Díaz,rosa.diaz@ejemplo.test,correo\r\n".encode("utf-8")
cuerpo, tipo = multipart({}, ("lista-ejemplo.csv", "text/csv", csv))
print("importación", pedir("POST", "/prospectos/importaciones", crudo=cuerpo, tipo=tipo))

pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
cuerpo, tipo = multipart({"empresaId": "2", "oportunidadId": str(o1["id"])}, ("constancia-fiscal-ejemplo.pdf", "application/pdf", pdf))
print("documento", pedir("POST", "/documentos", crudo=cuerpo, tipo=tipo))
