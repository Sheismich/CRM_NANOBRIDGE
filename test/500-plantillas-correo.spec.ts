import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { auditoria, envios, plantillasCorreo, prospectos } from "../src/database/schema.js";
import { armarCorreo, enlacesInvalidos, ETIQUETA_BAJA, variablesDesconocidas } from "../src/shared/plantillas.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Plantillas de correo editables (etapa 1 de las mejoras, 19-oct-2026).
// n8n deja de tener texto propio: POST /automatizacion/envios regresa el
// correo ya armado con la plantilla del número de contacto que toca.
describe("armarCorreo (función pura)", () => {
  const plantilla = { asunto: "Una propuesta para {{empresa}}", cuerpo: "Hola {{primer_nombre}},\n\nSomos de NANOBRIDGE.\nGiro: {{giro}}.\n\nSaludos" };

  it("cambia las variables y arma texto y html con un <p> por párrafo", () => {
    const correo = armarCorreo(plantilla, { nombre: "Ana María López", empresa: "Moldes del Bajío", giro: "Manufactura" }, "");
    expect(correo.asunto).toBe("Una propuesta para Moldes del Bajío");
    expect(correo.texto).toBe("Hola Ana,\n\nSomos de NANOBRIDGE.\nGiro: Manufactura.\n\nSaludos");
    expect(correo.html).toContain("<p>Hola Ana,</p><p>Somos de NANOBRIDGE.<br>Giro: Manufactura.</p><p>Saludos</p>");
  });

  it("un dato vacío se quita limpio, con todo y el espacio de antes", () => {
    const correo = armarCorreo({ asunto: "Hola", cuerpo: "Hola {{primer_nombre}}, ¿cómo está?" }, { nombre: "  ", empresa: "X" }, "");
    expect(correo.texto).toBe("Hola, ¿cómo está?");
  });

  it("escapa el html (un nombre con < o & no rompe el correo)", () => {
    const correo = armarCorreo({ asunto: "A", cuerpo: "Para {{empresa}}" }, { empresa: "Tom & <Jerry>" }, "");
    expect(correo.html).toContain("<p>Para Tom &amp; &lt;Jerry&gt;</p>");
    expect(correo.texto).toBe("Para Tom & <Jerry>");
  });

  it("agrega el pie al final, si hay", () => {
    const correo = armarCorreo({ asunto: "A", cuerpo: "Texto" }, {}, "Calle 1, León\nAviso de privacidad");
    expect(correo.texto).toBe("Texto\n\nCalle 1, León\nAviso de privacidad");
    expect(correo.html).toContain("<p>Texto</p>");
    expect(correo.html).toContain("Calle 1, León<br>Aviso de privacidad</p>");
  });

  it("formato básico: **negrita**, *cursiva* y [enlace](https://…), en html y en texto", () => {
    const correo = armarCorreo({ asunto: "A", cuerpo: "Somos **NANOBRIDGE**, *con gusto*.\nVea [nuestro sitio](https://nano-bridge-mex.com/?a=1&b=2)." }, {}, "");
    expect(correo.html).toContain('<p>Somos <strong>NANOBRIDGE</strong>, <em>con gusto</em>.<br>Vea <a href="https://nano-bridge-mex.com/?a=1&amp;b=2">nuestro sitio</a>.</p>');
    expect(correo.texto).toBe("Somos NANOBRIDGE, con gusto.\nVea nuestro sitio (https://nano-bridge-mex.com/?a=1&b=2).");
  });

  it("un enlace cuyo texto es la misma dirección sale una sola vez en el texto", () => {
    const correo = armarCorreo({ asunto: "A", cuerpo: "[https://a.mx](https://a.mx)" }, {}, "");
    expect(correo.texto).toBe("https://a.mx");
  });

  it("los datos del prospecto no meten formato (una empresa con asteriscos se queda igual)", () => {
    const correo = armarCorreo({ asunto: "A", cuerpo: "Para **{{empresa}}** y {{nombre}}" }, { empresa: "*Tienda* [X](https://malo.test)", nombre: "**Ana**" }, "");
    expect(correo.html).toContain("<p>Para <strong>*Tienda* [X](https://malo.test)</strong> y **Ana**</p>");
    expect(correo.texto).toBe("Para *Tienda* [X](https://malo.test) y **Ana**");
  });

  it("un enlace que no es http(s) no se vuelve enlace", () => {
    const html = armarCorreo({ asunto: "A", cuerpo: "[clic](javascript:alert(1))" }, {}, "").html;
    expect(html).toContain("<p>[clic](javascript:alert(1))</p>");
    expect(html).not.toContain('href="javascript');
    expect(enlacesInvalidos("[clic](javascript:alert(1)) y [bien](https://a.mx) y [mal](www.a.mx)")).toEqual(["clic", "mal"]);
  });

  it("molde (opción A, 22-oct): firma con logo, pie separado, link de baja y cita, en ese orden", () => {
    const correo = armarCorreo({ asunto: "A", cuerpo: "Hola." }, {}, "Domicilio", {
      firma: "Ana <López>",
      linkDeBaja: true,
      cita: { encabezado: "El 21 de octubre, Daniel escribió:", contenido: "¿Precio?\nGracias" }
    });
    expect(correo.texto).toBe(`Hola.\n\nAna <López>\nNANOBRIDGE\n\nDomicilio\n\n¿Ya no quiere recibir estos correos? Darte de baja: ${ETIQUETA_BAJA}\n\nEl 21 de octubre, Daniel escribió:\n> ¿Precio?\n> Gracias`);
    const h = correo.html;
    expect(h).toContain("https://crm-prospeccion-outbound.web.app/logo-n.png");
    expect(h).toContain("Ana &lt;López&gt;");
    const orden = ["<p>Hola.</p>", "logo-n.png", "Domicilio", `<a href="${ETIQUETA_BAJA}"`, "<blockquote", "¿Precio?<br>Gracias"].map((t) => h.indexOf(t));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("sin linkDeBaja no hay etiqueta, y sin firma la firma dice solo NANOBRIDGE", () => {
    const correo = armarCorreo({ asunto: "A", cuerpo: "Hola." }, {}, "");
    expect(correo.texto).toBe("Hola.");
    expect(correo.html).not.toContain(ETIQUETA_BAJA);
    expect(correo.html).toContain("NANOBRIDGE");
    expect(correo.html).toContain("nanobridge-mex.com");
  });

  it("detecta variables que no existen", () => {
    expect(variablesDesconocidas("Hola {{nombre}} de {{ empresa }}")).toEqual([]);
    expect(variablesDesconocidas("Hola {{apellido}} y {{Nombre}}")).toEqual(["apellido", "Nombre"]);
  });
});

describe("plantillas de correo", () => {
  let app: INestApplication;
  let admin: string[];
  let supervisor: string[];
  let agente: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function prospectoValidado(giro: string, nombre = "Laura Gómez") {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Plantillas ${randomUUID().slice(0, 8)}`, giro, tamano: "mediana" },
      contacto: { nombre, correo: `plantillas.${randomUUID()}@prospeccion.test` }
    });
    expect(res.status).toBe(201);
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, res.body.id));
    return res.body.id as number;
  }

  const registrarEnvio = (prospectoId: number, executionId = randomUUID()) =>
    api().post("/api/v1/automatizacion/envios").set("X-API-Key", API_KEY).send({ execution_id: executionId, prospecto_id: prospectoId, canal: "correo" });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await ensureSeedAdmin(app);
    const correoSup = `sup.plantillas.${randomUUID()}@test.local`;
    const crear = await api().post("/api/v1/usuarios").set("Cookie", admin).send({ nombre: "Supervisora Plantillas", correo: correoSup, password: "password_sup_1", rol: "supervisor" });
    expect(crear.status).toBe(201);
    supervisor = await loginAs(app, correoSup, "password_sup_1");
    agente = await crearAgente(app, admin, `agente.plantillas.${randomUUID()}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("GET trae las 3 generales sembradas, el pie y las variables", async () => {
    const res = await api().get("/api/v1/plantillas").set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body.plantillas.map((p: { numero: number; giro: string }) => [p.numero, p.giro])).toEqual([[1, ""], [2, ""], [3, ""]]);
    expect(res.body.plantillas[0].asunto.length).toBeGreaterThan(0);
    expect(res.body.plantillas[0].cuerpo).toContain("{{");
    expect(typeof res.body.pie.texto).toBe("string");
    expect(res.body.variables.map((v: { clave: string }) => v.clave)).toEqual(["nombre", "primer_nombre", "empresa", "giro"]);
  });

  it("un agente no ve ni cambia las plantillas", async () => {
    expect((await api().get("/api/v1/plantillas").set("Cookie", agente)).status).toBe(403);
    expect((await api().put("/api/v1/plantillas/1").set("Cookie", agente).send({ asunto: "X", cuerpo: "Hola, texto." })).status).toBe(403);
    expect((await api().put("/api/v1/plantillas/pie").set("Cookie", agente).send({ texto: "X" })).status).toBe(403);
  });

  it("una variable desconocida no se guarda: 400 PLANTILLA_VARIABLE_DESCONOCIDA", async () => {
    const res = await api().put("/api/v1/plantillas/1").set("Cookie", admin).send({ asunto: "Hola {{apellido}}", cuerpo: "Texto de prueba suficiente." });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PLANTILLA_VARIABLE_DESCONOCIDA");
    expect(res.body.message).toContain("apellido");
  });

  it("un enlace que no empieza con http(s) no se guarda: 400 PLANTILLA_ENLACE_INVALIDO", async () => {
    const res = await api().put("/api/v1/plantillas/1").set("Cookie", admin).send({ asunto: "Asunto", cuerpo: "Vea [el sitio](www.nano-bridge-mex.com)." });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PLANTILLA_ENLACE_INVALIDO");
    expect(res.body.message).toContain("el sitio");
    expect((await api().put("/api/v1/plantillas/pie").set("Cookie", admin).send({ texto: "[Aviso](aviso.pdf)" })).body.code).toBe("PLANTILLA_ENLACE_INVALIDO");
  });

  it("el número va de 1 a 3", async () => {
    expect((await api().put("/api/v1/plantillas/4").set("Cookie", admin).send({ asunto: "Asunto", cuerpo: "Texto de prueba suficiente." })).status).toBe(400);
  });

  it("el supervisor edita una plantilla y queda en el Registro de cambios (configuración) con antes y después", async () => {
    const antes = (await api().get("/api/v1/plantillas").set("Cookie", admin)).body.plantillas[1];
    const res = await api().put("/api/v1/plantillas/2").set("Cookie", supervisor).send({ asunto: "Seguimiento para {{empresa}}", cuerpo: "Hola {{primer_nombre}},\n\nSolo para dar seguimiento." });
    expect(res.status).toBe(200);
    expect(res.body.asunto).toBe("Seguimiento para {{empresa}}");
    expect(res.body.actualizado_por.nombre).toBe("Supervisora Plantillas");

    const filas = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "plantilla_correo"), eq(auditoria.entidadId, antes.id)));
    const ultima = filas[filas.length - 1]!;
    expect(ultima.accion).toBe("editar");
    expect(ultima.antes).toEqual({ numero: 2, asunto: antes.asunto, cuerpo: antes.cuerpo });
    expect(ultima.despues).toEqual({ numero: 2, asunto: "Seguimiento para {{empresa}}", cuerpo: "Hola {{primer_nombre}},\n\nSolo para dar seguimiento." });

    const registro = await api().get("/api/v1/admin/registro-cambios?tipo=configuracion").set("Cookie", admin);
    expect(registro.status).toBe(200);
    const enRegistro = registro.body.data.find((f: { registro: { entidad: string; id: number } }) => f.registro.entidad === "plantilla_correo" && f.registro.id === antes.id);
    expect(enRegistro.texto).toBe("Supervisora Plantillas editó el correo de prospección «Recordatorio 1».");
    expect(enRegistro.cambios.map((c: { etiqueta: string }) => c.etiqueta)).toEqual(["Asunto", "Texto"]);
  });

  it("guardar lo mismo no deja otra fila de auditoría", async () => {
    const actual = (await api().get("/api/v1/plantillas").set("Cookie", admin)).body.plantillas[1];
    const contar = async () => (await db.select().from(auditoria).where(and(eq(auditoria.entidad, "plantilla_correo"), eq(auditoria.entidadId, actual.id)))).length;
    const n = await contar();
    expect((await api().put("/api/v1/plantillas/2").set("Cookie", admin).send({ asunto: actual.asunto, cuerpo: actual.cuerpo })).status).toBe(200);
    expect(await contar()).toBe(n);
  });

  it("el pie se edita, se audita y sale en el Registro de cambios", async () => {
    const res = await api().put("/api/v1/plantillas/pie").set("Cookie", admin).send({ texto: "NANOBRIDGE · Calle Falsa 123, León, Gto." });
    expect(res.status).toBe(200);
    expect(res.body.texto).toBe("NANOBRIDGE · Calle Falsa 123, León, Gto.");
    expect((await api().get("/api/v1/plantillas").set("Cookie", admin)).body.pie.texto).toBe("NANOBRIDGE · Calle Falsa 123, León, Gto.");

    const registro = await api().get("/api/v1/admin/registro-cambios?tipo=configuracion").set("Cookie", admin);
    const fila = registro.body.data.find((f: { registro: { entidad: string } }) => f.registro.entidad === "pie_correo");
    expect(fila.texto).toBe("Admin Semilla editó el pie de los correos de prospección.");
  });

  it("vista previa con datos de ejemplo, o con los de un prospecto", async () => {
    const ejemplo = await api().post("/api/v1/plantillas/vista-previa").set("Cookie", supervisor).send({ asunto: "Para {{empresa}}", cuerpo: "Hola {{primer_nombre}}." });
    expect(ejemplo.status).toBe(200);
    expect(ejemplo.body.asunto).toBe("Para Moldes del Bajío");
    expect(ejemplo.body.texto).toBe(`Hola Daniela.\n\nNANOBRIDGE · Calle Falsa 123, León, Gto.\n\n¿Ya no quiere recibir estos correos? Darte de baja: ${ETIQUETA_BAJA}`);
    // En la pantalla el link de baja no lleva a ningún lado (SendGrid pone la URL al mandar).
    expect(ejemplo.body.html).toContain('<a href="#"');
    expect(ejemplo.body.html).not.toContain(ETIQUETA_BAJA);

    const prospectoId = await prospectoValidado("Alimentos", "Ramiro Sánchez");
    const real = await api().post("/api/v1/plantillas/vista-previa").set("Cookie", supervisor).send({ asunto: "Giro {{giro}}", cuerpo: "Hola {{nombre}}.", pie: "", prospecto_id: prospectoId });
    expect(real.status).toBe(200);
    expect(real.body.asunto).toBe("Giro Alimentos");
    expect(real.body.texto).toBe(`Hola Ramiro Sánchez.\n\n¿Ya no quiere recibir estos correos? Darte de baja: ${ETIQUETA_BAJA}`);

    const mala = await api().post("/api/v1/plantillas/vista-previa").set("Cookie", supervisor).send({ asunto: "{{precio}}", cuerpo: "Hola." });
    expect(mala.status).toBe(400);
    expect(mala.body.code).toBe("PLANTILLA_VARIABLE_DESCONOCIDA");
    expect((await api().post("/api/v1/plantillas/vista-previa").set("Cookie", agente).send({ asunto: "A", cuerpo: "B" })).status).toBe(403);
  });

  it("POST /automatizacion/envios regresa el correo armado con la plantilla que toca y guarda cuál salió", async () => {
    await api().put("/api/v1/plantillas/1").set("Cookie", admin).send({ asunto: "Propuesta para {{empresa}}", cuerpo: "Hola {{primer_nombre}},\n\nPrimer correo." });
    const prospectoId = await prospectoValidado("Logística", "Ernesto Ruiz");

    const executionId = randomUUID();
    const primero = await registrarEnvio(prospectoId, executionId);
    expect(primero.status).toBe(201);
    expect(primero.body.correo.asunto).toMatch(/^Propuesta para Plantillas /);
    expect(primero.body.correo.texto).toBe(`Hola Ernesto,\n\nPrimer correo.\n\nNANOBRIDGE · Calle Falsa 123, León, Gto.\n\n¿Ya no quiere recibir estos correos? Darte de baja: ${ETIQUETA_BAJA}`);
    expect(primero.body.correo.html).toContain("<p>Hola Ernesto,</p><p>Primer correo.</p>");
    // Molde del 22-oct (opción A): firma con logo y link de baja dentro del
    // pie; PT1b le dice a SendGrid que cambie la etiqueta por la URL.
    expect(primero.body.correo.html).toContain("logo-n.png");
    expect(primero.body.correo.html).toContain(`<a href="${ETIQUETA_BAJA}"`);

    const [envio] = await db.select().from(envios).where(eq(envios.id, primero.body.id));
    const generales = (await api().get("/api/v1/plantillas").set("Cookie", admin)).body.plantillas;
    expect(envio!.plantillaId).toBe(generales[0].id);
    expect(envio!.asunto).toBe(primero.body.correo.asunto);

    // Reintento de n8n con el mismo execution_id: mismo correo.
    const reintento = await registrarEnvio(prospectoId, executionId);
    expect(reintento.body.ya_existia).toBe(true);
    expect(reintento.body.correo).toEqual(primero.body.correo);

    // Se vence la ventana: el siguiente es el recordatorio 1 (plantilla 2).
    await db.update(envios).set({ ventanaVenceEn: new Date(Date.now() - 60_000) }).where(eq(envios.id, primero.body.id));
    const segundo = await registrarEnvio(prospectoId);
    expect(segundo.status).toBe(201);
    expect(segundo.body.numero_en_ciclo).toBe(2);
    expect(segundo.body.correo.asunto).toMatch(/^Seguimiento para Plantillas /);
    const [envio2] = await db.select().from(envios).where(eq(envios.id, segundo.body.id));
    expect(envio2!.plantillaId).toBe(generales[1].id);
  });

  it("si hay una plantilla para el giro del prospecto, esa manda; si no, la general", async () => {
    const [creada] = await db.insert(plantillasCorreo).values({ giro: "Construcción", numero: 1, asunto: "Para constructoras", cuerpo: "Hola {{primer_nombre}}, texto del giro." });
    try {
      const delGiro = await registrarEnvio(await prospectoValidado("Construcción", "Pedro Luna"));
      expect(delGiro.body.correo.asunto).toBe("Para constructoras");
      const [envio] = await db.select().from(envios).where(eq(envios.id, delGiro.body.id));
      expect(envio!.plantillaId).toBe(creada.insertId);

      const general = await registrarEnvio(await prospectoValidado("Textil", "Pedro Luna"));
      expect(general.body.correo.asunto).toMatch(/^Propuesta para /);
    } finally {
      await db.delete(plantillasCorreo).where(eq(plantillasCorreo.id, creada.insertId));
    }
  });

  it("las rutas piden sesión", async () => {
    expect((await api().get("/api/v1/plantillas")).status).toBe(401);
  });
});
