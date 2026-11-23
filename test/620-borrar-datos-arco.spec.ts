import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin, SEED_ADMIN } from "./support/seed.js";
import {
  actividades, auditoria, campanas, contactos, correosRespuesta, envios, eventosPendientes, eventosSendgrid, incidencias,
  listaSupresion, notificaciones, oportunidades, procesosFallidos, prospectos, resultadosScoring, tareas, usuarios
} from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Borrar los datos de una persona por solicitud ARCO (pendiente #9 de la revisión
// del 20-nov-2026, decidido por Fabián el 23-nov): se anonimiza en todo el CRM y
// solo quedan su correo y su teléfono en la lista de supresión.
describe("borrar los datos de una persona (ARCO)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  let campanaId: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);

  // Una persona con rastros en todas partes: nombre, correo y teléfono únicos para
  // poder buscarlos después en toda la base.
  async function personaConRastros() {
    const marca = randomUUID().slice(0, 8);
    const nombre = `Zacarías Únicoarco ${marca}`;
    const correo = `arco.${marca}@destino.test`;
    const digitos = String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));
    const telefono = `${digitos.slice(0, 3)} ${digitos.slice(3, 6)} ${digitos.slice(6)}`;

    const reg = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Empresa ARCO ${marca}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre, correo, telefono }
    });
    expect(reg.status).toBeLessThan(300);
    const prospectoId = reg.body.id as number;
    await db.update(prospectos).set({ campanaId, estado: "validado", fuenteUrl: `https://www.linkedin.com/in/${marca}` }).where(eq(prospectos.id, prospectoId));
    const [p] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, prospectoId));
    const contactoId = p!.contactoId;
    const [c] = await db.select({ empresaId: contactos.empresaId }).from(contactos).where(eq(contactos.id, contactoId));
    const empresaId = c!.empresaId;

    const [e] = await db.insert(envios).values({ prospectoId, canal: "correo", numeroContacto: 1, ventanaEstado: "abierta", ventanaVenceEn: new Date(Date.now() + 5 * 86_400_000), executionId: randomUUID(), enviadoEn: new Date(), estado: "enviado", destinatario: correo, asunto: `Hola ${nombre}` });
    await db.insert(eventosSendgrid).values({ sgEventId: randomUUID(), evento: "delivered", correo, prospectoId, envioId: e.insertId, ocurrioEn: new Date(), resultado: "ignorado" });

    const resp = await conLlave(api().post("/api/v1/automatizacion/respuestas")).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo", contenido: `Soy ${nombre}, llámenme al ${telefono}` });
    expect(resp.status).toBe(201);
    const respuestaId = resp.body.id as number;

    await db.insert(correosRespuesta).values({ respuestaId, prospectoId, usuarioId: adminId, contactoId, para: correo, copia: [], asunto: `Re: hola ${nombre}`, texto: `Gracias ${nombre}`, usoIa: "sin_ia", estado: "enviado" });
    await db.insert(actividades).values({ empresaId, contactoId, tipo: "llamada", responsableId: adminId, ocurridaEn: new Date(), comentario: `Hablé con ${nombre} al ${telefono}` });
    const [t] = await db.insert(tareas).values({ tipo: "seguimiento", titulo: `Llamar a ${nombre}`, descripcion: `Su correo es ${correo}`, estado: "pendiente", prioridad: "media", empresaId, contactoId });
    await db.insert(notificaciones).values({ usuarioId: adminId, tipo: "respuesta_conversacion", titulo: `${nombre} te contestó`, cuerpo: `Soy ${nombre}`, entidad: "respuesta", entidadId: respuestaId, correoEstado: "no_aplica" });
    await db.insert(incidencias).values({ prospectoId, tipo: "prueba_arco", severidad: "baja", mensaje: "Incidencia de prueba", estado: "abierta", detalle: { correo } });
    await db.insert(procesosFallidos).values({ tipo: "prueba_arco", payload: { correo, telefono }, mensaje: "Proceso de prueba", estado: "abierto" });
    await db.insert(eventosPendientes).values({ eventoUuid: randomUUID(), tipo: "prueba_arco", entidadTipo: "prospecto", entidadId: prospectoId, payload: { nombre, correo }, estado: "pendiente", intentos: 0 });
    await db.insert(resultadosScoring).values({ executionId: randomUUID(), prospectoId, score: "50.00", metodo: "reglas", detalle: { razon: `Perfil de ${nombre}` } });
    await db.insert(auditoria).values({ usuarioId: adminId, entidad: "otra_cosa", entidadId: 1, accion: "prueba_arco", despues: { menciona: correo } });

    // Una importación con la misma persona: queda «duplicado» con sus datos.
    const csv = `empresaNombreLegal,contactoNombre,correo,telefono,canalInicial\nEmpresa ARCO ${marca},${nombre},${correo},${telefono},correo\n`;
    const imp = await api().post("/api/v1/prospectos/importaciones").set("Cookie", adminCookie).attach("archivo", Buffer.from(csv, "utf8"), "arco.csv");
    expect(imp.status).toBe(201);

    // Una venta de la empresa con esa persona: se queda.
    const op = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, contactoId, titulo: `Venta ${marca}` });
    expect(op.status).toBe(201);

    return { nombre, correo, telefono, digitos, contactoId, empresaId, prospectoId, respuestaId, tareaId: t.insertId, oportunidadId: op.body.id as number };
  }

  // Busca un texto en TODAS las columnas de texto y JSON de la base, menos la
  // lista de supresión. Devuelve dónde quedó.
  async function dondeAparece(texto: string) {
    const [cols] = (await db.execute(sql`SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND data_type IN ('varchar', 'char', 'text', 'mediumtext', 'longtext', 'json')
        AND table_name NOT IN ('lista_supresion', 'schema_migrations')`)) as unknown as [{ t: string; c: string }[]];
    const encontrado: string[] = [];
    for (const { t, c } of cols) {
      const [filas] = (await db.execute(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(t)} WHERE CAST(${sql.identifier(c)} AS CHAR) LIKE ${`%${texto}%`}`)) as unknown as [{ n: number }[]];
      if (Number(filas[0]!.n) > 0) encontrado.push(`${t}.${c}`);
    }
    return encontrado;
  }

  const borrar = (contactoId: number, confirmacion: string | null, cookie = adminCookie) =>
    api().post(`/api/v1/contactos/${contactoId}/borrar-datos`).set("Cookie", cookie).send(confirmacion === null ? {} : { confirmacion });

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = (await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.correo, SEED_ADMIN.correo)))[0]!.id;
    const [c] = await db.insert(campanas).values({ nombre: `ARCO ${randomUUID().slice(0, 8)}`, canal: "correo", estado: "activa" });
    campanaId = c.insertId;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("después de borrar, su nombre, correo y teléfono no aparecen en ninguna tabla salvo la lista de supresión", async () => {
    const p = await personaConRastros();
    // Antes sí aparecen (la prueba de verdad busca).
    expect((await dondeAparece(p.correo)).length).toBeGreaterThan(5);

    const res = await borrar(p.contactoId, p.nombre);
    expect(res.status).toBe(200);
    expect(res.body.contacto_id).toBe(p.contactoId);

    expect(await dondeAparece(p.correo)).toEqual([]);
    expect(await dondeAparece(p.digitos)).toEqual([]);
    expect(await dondeAparece(p.nombre)).toEqual([]);

    // Lo único que queda: su correo y su teléfono en la lista de supresión.
    const supresion = await db.select({ tipo: listaSupresion.tipo }).from(listaSupresion).where(sql`${listaSupresion.valorNormalizado} IN (${p.correo}, ${p.digitos})`);
    expect(supresion.map((s) => s.tipo).sort()).toEqual(["correo", "telefono"]);
  });

  it("la persona queda desactivada, en baja y no se le puede volver a mandar a automatización", async () => {
    const p = await personaConRastros();
    expect((await borrar(p.contactoId, p.nombre)).status).toBe(200);

    const [c] = await db.select().from(contactos).where(eq(contactos.id, p.contactoId));
    expect(c).toMatchObject({ nombre: "Persona eliminada", activo: false, puesto: null });
    expect((await db.select().from(prospectos).where(eq(prospectos.id, p.prospectoId)))[0]!.estado).toBe("baja");

    const mandar = await api().post("/api/v1/prospectos/automatizacion").set("Cookie", adminCookie).send({ prospectoIds: [p.prospectoId], campanaId });
    expect(mandar.status).toBe(200);
    expect((await db.select().from(prospectos).where(eq(prospectos.id, p.prospectoId)))[0]!.estado).toBe("baja");

    // Si alguien la vuelve a importar, la lista de supresión manda: no se le escribe.
    const v = await conLlave(api().get("/api/v1/automatizacion/supresion")).query({ tipo: "correo", valor: p.correo });
    expect(v.status).toBe(200);
    expect(v.body.en_supresion).toBe(true);
  });

  it("la venta de la empresa y los envíos se quedan (sin sus datos)", async () => {
    const p = await personaConRastros();
    expect((await borrar(p.contactoId, p.nombre)).status).toBe(200);

    const [op] = await db.select().from(oportunidades).where(eq(oportunidades.id, p.oportunidadId));
    expect(op).toMatchObject({ contactoId: p.contactoId, empresaId: p.empresaId });
    const [envio] = await db.select().from(envios).where(eq(envios.prospectoId, p.prospectoId));
    expect(envio).toMatchObject({ destinatario: null, asunto: null, estado: "enviado" });
    const [t] = await db.select().from(tareas).where(eq(tareas.id, p.tareaId));
    expect(t).toMatchObject({ titulo: "Tarea de una persona eliminada", descripcion: null });
  });

  it("si iba en copia de un correo a otra persona, solo se quita ella de la copia", async () => {
    const p = await personaConRastros();
    const otra = await personaConRastros();
    const [cr] = await db.insert(correosRespuesta).values({
      respuestaId: otra.respuestaId, prospectoId: otra.prospectoId, usuarioId: adminId, contactoId: otra.contactoId,
      para: otra.correo, copia: [p.correo, "compras@destino.test"], asunto: "Re: cotización", texto: "Va la cotización", usoIa: "sin_ia", estado: "enviado"
    });

    expect((await borrar(p.contactoId, p.nombre)).status).toBe(200);
    const [fila] = await db.select().from(correosRespuesta).where(eq(correosRespuesta.id, cr.insertId));
    expect(fila).toMatchObject({ para: otra.correo, copia: ["compras@destino.test"], texto: "Va la cotización" });
  });

  it("queda en la auditoría sin datos personales", async () => {
    const p = await personaConRastros();
    expect((await borrar(p.contactoId, p.nombre)).status).toBe(200);
    const filas = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "contacto"), eq(auditoria.entidadId, p.contactoId), eq(auditoria.accion, "borrar_datos_arco")));
    expect(filas).toHaveLength(1);
    expect(filas[0]!.usuarioId).toBe(adminId);
    expect(filas[0]!.despues).toEqual({ motivo: "Datos borrados por solicitud ARCO" });
  });

  it("hay que escribir su nombre; solo el administrador; no se repite", async () => {
    const p = await personaConRastros();
    expect((await borrar(p.contactoId, null)).status).toBe(400);
    expect((await borrar(p.contactoId, "Otro Nombre")).status).toBe(400);

    const agente = await crearAgente(app, adminCookie, `agente.arco.${randomUUID().slice(0, 8)}@test.local`);
    expect((await borrar(p.contactoId, p.nombre, agente)).status).toBe(403);
    expect((await db.select().from(contactos).where(eq(contactos.id, p.contactoId)))[0]!.nombre).toBe(p.nombre);

    // Sin importar mayúsculas ni espacios de más.
    expect((await borrar(p.contactoId, `  ${p.nombre.toUpperCase()} `)).status).toBe(200);
    expect((await borrar(p.contactoId, "Persona eliminada")).status).toBe(409);
  });

  it("sirve también para un contacto ya desactivado", async () => {
    const p = await personaConRastros();
    expect((await api().delete(`/api/v1/contactos/${p.contactoId}`).set("Cookie", adminCookie)).status).toBe(204);
    expect((await borrar(p.contactoId, p.nombre)).status).toBe(200);
    expect(await dondeAparece(p.correo)).toEqual([]);
  });

  it("un contacto que no existe da 404", async () => {
    expect((await borrar(999_999_999, "Nadie")).status).toBe(404);
  });

  it("queda en el Registro de cambios", async () => {
    const p = await personaConRastros();
    expect((await borrar(p.contactoId, p.nombre)).status).toBe(200);
    const registro = await api().get("/api/v1/admin/registro-cambios").set("Cookie", adminCookie).query({ accion: "contacto:borrar_datos_arco" });
    expect(registro.status).toBe(200);
    expect(JSON.stringify(registro.body)).toContain("borró los datos de una persona por solicitud ARCO");
  });
});
