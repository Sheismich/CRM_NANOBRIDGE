import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { auditoria, campanas, contactos, empresas, envios, prospectos, respuestas, tareas, usuarios } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// «Detener seguimiento» (pendiente #1 de la revisión del 20-nov-2026, decidido
// por Fabián el 23-nov): la persona ya habla con ventas por teléfono, WhatsApp
// u otro correo y la automatización deja de escribirle. Lo hace el botón de la
// ficha (POST /contactos/:id/detener-seguimiento) y la creación de una
// oportunidad con esa persona.
describe("detener seguimiento de quien ya habla con ventas", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let campanaA: number;
  let campanaB: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);

  async function campana(nombre: string) {
    const [c] = await db.insert(campanas).values({ nombre: `${nombre} ${randomUUID().slice(0, 8)}`, canal: "correo", estado: "activa" });
    return c.insertId;
  }

  // Un prospecto de la persona (mismo correo = misma persona) en una campaña.
  async function prospecto(correo: string, campanaId: number | null, estado = "validado") {
    const res = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Detener ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona Detener", correo }
    });
    expect(res.status).toBeLessThan(300);
    const id = res.body.id as number;
    await db.update(prospectos).set({ campanaId, estado, executionId: null }).where(eq(prospectos.id, id));
    return id;
  }

  // Un correo ya enviado; con diasAtras >= 7 su ventana ya venció (la reclama PT4).
  async function sembrarEnvio(prospectoId: number, numeroContacto: number, diasAtras: number) {
    const enviadoEn = new Date(Date.now() - diasAtras * 86_400_000);
    const [r] = await db.insert(envios).values({ prospectoId, canal: "correo", numeroContacto, ventanaEstado: "abierta", ventanaVenceEn: new Date(enviadoEn.getTime() + 7 * 86_400_000), executionId: randomUUID(), enviadoEn, estado: "enviado" });
    return r.insertId;
  }

  async function fila(prospectoId: number) {
    await db.update(prospectos).set({ estado: "en_fila", filaDesde: new Date(), filaEstadoPrevio: "capturado" }).where(eq(prospectos.id, prospectoId));
  }

  const persona = () => `detener.${randomUUID()}@destino.test`;
  async function de(prospectoId: number) {
    const [p] = await db.select().from(prospectos).where(eq(prospectos.id, prospectoId));
    const [c] = await db.select({ empresaId: contactos.empresaId }).from(contactos).where(eq(contactos.id, p!.contactoId));
    return { prospecto: p!, contactoId: p!.contactoId, empresaId: c!.empresaId };
  }
  // motivo null = la petición va sin motivo.
  const detener = (contactoId: number, cookie = adminCookie, motivo: string | null = "Ya habla por WhatsApp con el vendedor") =>
    api().post(`/api/v1/contactos/${contactoId}/detener-seguimiento`).set("Cookie", cookie).send(motivo === null ? {} : { motivo });
  const ventana = async (envioId: number) => (await db.select({ v: envios.ventanaEstado }).from(envios).where(eq(envios.id, envioId)))[0]!.v;

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const correoAgente = `agente.detener.${randomUUID().slice(0, 8)}@test.local`;
    agenteCookie = await crearAgente(app, adminCookie, correoAgente);
    agenteId = (await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.correo, correoAgente)))[0]!.id;
    campanaA = await campana("Agua");
    campanaB = await campana("Maquinaria");
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("el botón de la ficha", () => {
    it("con serie en curso: pasa a interesado, cierra su ventana, PT4 ya no la trae y no crea tarea", async () => {
      const correo = persona();
      const enA = await prospecto(correo, campanaA);
      const envio = await sembrarEnvio(enA, 1, 10);
      const { contactoId } = await de(enA);
      const tareasAntes = (await db.select().from(tareas).where(and(eq(tareas.prospectoId, enA), eq(tareas.titulo, "Contactar prospecto interesado")))).length;
      const respuestasAntes = (await db.select().from(respuestas).where(eq(respuestas.prospectoId, enA))).length;

      const res = await detener(contactoId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ contacto_id: contactoId, como: "serie", prospecto_id: enA });

      expect((await de(enA)).prospecto.estado).toBe("interesado");
      expect(await ventana(envio)).toBe("cerrada");
      const vencidas = await conLlave(api().get("/api/v1/automatizacion/envios/vencidas")).query({ limit: 200 });
      expect(vencidas.status).toBe(200);
      expect((vencidas.body.data as { prospecto_id: number }[]).some((f) => f.prospecto_id === enA)).toBe(false);
      // Ventas ya lo atiende: sin tarea nueva; y los reportes (que cuentan respuestas) no cambian.
      expect((await db.select().from(tareas).where(and(eq(tareas.prospectoId, enA), eq(tareas.titulo, "Contactar prospecto interesado")))).length).toBe(tareasAntes);
      expect((await db.select().from(respuestas).where(eq(respuestas.prospectoId, enA))).length).toBe(respuestasAntes);

      const [a] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, enA), eq(auditoria.accion, "detener_seguimiento")));
      expect(a).toBeDefined();
      expect(a!.usuarioId).not.toBeNull();
      expect(a!.despues).toMatchObject({ estado: "interesado", motivo: "Ya habla por WhatsApp con el vendedor" });
    });

    it("también frena sus otras campañas: sale de la fila de una y se cierra la ventana de otra", async () => {
      const correo = persona();
      const enA = await prospecto(correo, campanaA);
      await sembrarEnvio(enA, 1, 2);
      const enB = await prospecto(correo, campanaB);
      await fila(enB);
      const { contactoId } = await de(enA);

      expect((await detener(contactoId)).status).toBe(200);
      expect((await de(enA)).prospecto.estado).toBe("interesado");
      const b = (await de(enB)).prospecto;
      expect(b.estado).toBe("capturado");
      expect(b.filaDesde).toBeNull();
      // No puede volver a entrar a otra campaña mientras siga en interesado.
      const mandar = await api().post("/api/v1/prospectos/automatizacion").set("Cookie", adminCookie).send({ prospectoIds: [enB], campanaId: campanaB });
      expect(mandar.status).toBe(200);
      expect((await de(enB)).prospecto.estado).toBe("capturado");
    });

    it("sin serie en curso, si solo esperaba en la fila, solo sale de la fila", async () => {
      const correo = persona();
      const enA = await prospecto(correo, campanaA, "capturado");
      await fila(enA);
      const { contactoId } = await de(enA);

      const res = await detener(contactoId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ como: "fila", prospecto_ids: [enA] });
      expect((await de(enA)).prospecto.estado).toBe("capturado");
    });

    it("sin nada en automatización responde 409 y no cambia nada", async () => {
      const correo = persona();
      const enA = await prospecto(correo, campanaA, "inactivo");
      await sembrarEnvio(enA, 1, 40);
      const { contactoId } = await de(enA);

      const res = await detener(contactoId);
      expect(res.status).toBe(409);
      expect((await de(enA)).prospecto.estado).toBe("inactivo");
    });

    it("a quien está en baja no le hace nada (la baja ya detuvo todo)", async () => {
      const correo = persona();
      const enA = await prospecto(correo, campanaA);
      await sembrarEnvio(enA, 1, 2);
      const { contactoId } = await de(enA);
      expect((await api().post(`/api/v1/contactos/${contactoId}/baja`).set("Cookie", adminCookie).send({ motivo: "Lo pidió por teléfono" })).status).toBe(200);

      expect((await detener(contactoId)).status).toBe(409);
      expect((await de(enA)).prospecto.estado).toBe("baja");
    });

    it("el motivo es obligatorio", async () => {
      const enA = await prospecto(persona(), campanaA);
      await sembrarEnvio(enA, 1, 2);
      const { contactoId } = await de(enA);
      expect((await detener(contactoId, adminCookie, null)).status).toBe(400);
      expect((await detener(contactoId, adminCookie, " ")).status).toBe(400);
      expect((await de(enA)).prospecto.estado).toBe("validado");
    });

    it("lo puede usar el agente dueño de la empresa; uno ajeno recibe 404", async () => {
      const enA = await prospecto(persona(), campanaA);
      await sembrarEnvio(enA, 1, 2);
      const { contactoId, empresaId } = await de(enA);

      expect((await detener(contactoId, agenteCookie)).status).toBe(404);
      expect((await de(enA)).prospecto.estado).toBe("validado");

      await db.update(empresas).set({ propietarioId: agenteId }).where(eq(empresas.id, empresaId));
      expect((await detener(contactoId, agenteCookie)).status).toBe(200);
      expect((await de(enA)).prospecto.estado).toBe("interesado");
    });

    it("la ficha dice a quién se le puede detener (en_automatizacion)", async () => {
      const enA = await prospecto(persona(), campanaA);
      await sembrarEnvio(enA, 1, 2);
      const { contactoId, empresaId } = await de(enA);
      const contactoEnFicha = async () => {
        const ficha = await api().get(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);
        expect(ficha.status).toBe(200);
        return (ficha.body.contactos as { id: number; en_automatizacion: boolean }[]).find((c) => c.id === contactoId)!;
      };

      expect((await contactoEnFicha()).en_automatizacion).toBe(true);
      expect((await detener(contactoId)).status).toBe(200);
      expect((await contactoEnFicha()).en_automatizacion).toBe(false);
    });

    it("queda en el Historial de la ficha y en el Registro de cambios", async () => {
      const enA = await prospecto(persona(), campanaA);
      await sembrarEnvio(enA, 1, 2);
      const { contactoId, empresaId } = await de(enA);
      expect((await detener(contactoId)).status).toBe(200);

      const historial = await api().get("/api/v1/actividades").set("Cookie", adminCookie).query({ empresaId });
      expect(historial.status).toBe(200);
      const evento = (historial.body.data as { tipo: string; resultado: string | null; detalle: { prospecto_id?: number; motivo?: string } }[])
        .find((e) => e.tipo === "cambio_estado_prospecto" && e.detalle.prospecto_id === enA);
      expect(evento).toMatchObject({ resultado: "interesado", detalle: { motivo: "Ya habla por WhatsApp con el vendedor" } });

      const registro = await api().get("/api/v1/admin/registro-cambios").set("Cookie", adminCookie).query({ accion: "prospecto:detener_seguimiento" });
      expect(registro.status).toBe(200);
      expect(JSON.stringify(registro.body)).toContain("detuvo el seguimiento automático");
    });
  });

  describe("al crear una oportunidad", () => {
    const oportunidad = (body: object) => api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ titulo: `Venta ${randomUUID().slice(0, 6)}`, ...body });

    it("con el contacto: su serie en curso se detiene", async () => {
      const enA = await prospecto(persona(), campanaA);
      const envio = await sembrarEnvio(enA, 1, 2);
      const { contactoId, empresaId } = await de(enA);

      expect((await oportunidad({ empresaId, contactoId })).status).toBe(201);
      expect((await de(enA)).prospecto.estado).toBe("interesado");
      expect(await ventana(envio)).toBe("cerrada");
      const [a] = await db.select().from(auditoria).where(and(eq(auditoria.entidadId, enA), eq(auditoria.accion, "detener_seguimiento")));
      expect(String((a!.despues as { motivo: string }).motivo)).toMatch(/^Se creó la oportunidad «Venta /);
    });

    it("con el prospecto: ese prospecto se detiene", async () => {
      const enA = await prospecto(persona(), campanaA);
      await sembrarEnvio(enA, 1, 2);
      const { empresaId } = await de(enA);

      expect((await oportunidad({ empresaId, prospectoId: enA })).status).toBe(201);
      expect((await de(enA)).prospecto.estado).toBe("interesado");
    });

    it("sin contacto ni prospecto (de la empresa) no frena a nadie", async () => {
      const enA = await prospecto(persona(), campanaA);
      await sembrarEnvio(enA, 1, 2);
      const { empresaId } = await de(enA);

      expect((await oportunidad({ empresaId })).status).toBe(201);
      expect((await de(enA)).prospecto.estado).toBe("validado");
    });

    it("si la persona no tenía nada en automatización, la oportunidad se crea igual", async () => {
      const enA = await prospecto(persona(), campanaA, "inactivo");
      const { contactoId, empresaId } = await de(enA);

      expect((await oportunidad({ empresaId, contactoId })).status).toBe(201);
      expect((await de(enA)).prospecto.estado).toBe("inactivo");
    });
  });
});
