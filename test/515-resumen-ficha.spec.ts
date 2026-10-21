import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { actividades, usoIa } from "../src/database/schema.js";
import { IA_SERVICE } from "../src/integraciones/ia.types.js";
import type { IaFalsaDriver } from "../src/integraciones/ia-falsa.driver.js";

// Etapa 4 de las mejoras: "Resumir con IA" en la ficha del cliente. La IA lee
// lo que esa persona puede ver de la empresa (historial, oportunidades,
// cotizaciones y tareas abiertas) y regresa un resumen corto y el siguiente
// paso. Se guarda el último por empresa y por persona.
describe("resumen con IA en la ficha", () => {
  let app: INestApplication;
  let admin: string[];
  let agente: string[];
  let otroAgente: string[];
  let agenteId: number;
  let otroAgenteId: number;
  let ia: IaFalsaDriver;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const yo = async (cookie: string[]) => (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body as { id: number };
  const ver = (cookie: string[], empresaId: number) => api().get(`/api/v1/empresas/${empresaId}/resumen-ia`).set("Cookie", cookie);
  const resumir = (cookie: string[], empresaId: number) => api().post(`/api/v1/empresas/${empresaId}/resumen-ia`).set("Cookie", cookie).send({});
  const ultimaPregunta = () => ia.preguntas.at(-1)!.texto;

  // Una empresa del agente con una llamada y una oportunidad suya.
  async function empresaDelAgente() {
    const nombre = `Resumen ${randomUUID().slice(0, 8)}`;
    const res = await api().post("/api/v1/empresas").set("Cookie", agente).send({ nombreLegal: nombre, giro: "Manufactura", contactos: [{ nombre: "Ana Ruiz", correo: `ana.${randomUUID()}@cliente.test` }] });
    expect(res.status).toBe(201);
    const empresaId = res.body.id as number;
    expect((await api().post("/api/v1/actividades").set("Cookie", agente).send({ empresaId, tipo: "llamada", resultado: "Pidió la ficha técnica" })).status).toBe(201);
    const op = await api().post("/api/v1/oportunidades").set("Cookie", agente).send({ empresaId, titulo: "Moldes de inyección 2027", valorEstimado: 450000 });
    expect(op.status).toBe(201);
    return { empresaId, nombre, oportunidadId: op.body.id as number };
  }

  beforeAll(async () => {
    app = await createTestApp();
    ia = app.get(IA_SERVICE);
    admin = await ensureSeedAdmin(app);
    agente = await crearAgente(app, admin, `agente.resumen.${randomUUID()}@test.local`);
    agenteId = (await yo(agente)).id;
    otroAgente = await crearAgente(app, admin, `otro.resumen.${randomUUID()}@test.local`);
    otroAgenteId = (await yo(otroAgente)).id;
  });

  beforeEach(() => {
    ia.fallar = false;
    ia.respuesta = { resumen: "Ana pidió la ficha técnica y hay una oportunidad abierta de $450,000.", siguiente_paso: "Mandarle la ficha técnica y agendar una llamada." };
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("sin sesión, 401", async () => {
    expect((await api().get("/api/v1/empresas/1/resumen-ia")).status).toBe(401);
  });

  it("un agente con una empresa ajena no la ve (404), ni para leer ni para resumir", async () => {
    const { empresaId } = await empresaDelAgente();
    expect((await ver(otroAgente, empresaId)).status).toBe(404);
    expect((await resumir(otroAgente, empresaId)).status).toBe(404);
  });

  it("sin resumen todavía: lo dice, y que se puede generar; la IA está apagada en pruebas", async () => {
    const { empresaId } = await empresaDelAgente();
    const res = await ver(agente, empresaId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resumen: null, desactualizado: false, ia_activa: false, puede_generar: true, motivo: null });
  });

  it("genera el resumen con el historial y la oportunidad, lo guarda y el GET lo regresa", async () => {
    const { empresaId, nombre } = await empresaDelAgente();
    const res = await resumir(agente, empresaId);
    expect(res.status).toBe(201);
    expect(res.body.resumen).toEqual(expect.objectContaining({ texto: "Ana pidió la ficha técnica y hay una oportunidad abierta de $450,000.", siguiente_paso: "Mandarle la ficha técnica y agendar una llamada." }));
    expect(res.body.desactualizado).toBe(false);

    const texto = ultimaPregunta();
    expect(texto).toContain(nombre);
    expect(texto).toContain("Pidió la ficha técnica");
    expect(texto).toContain("Moldes de inyección 2027");
    expect(texto).toContain("$450,000");

    const leido = await ver(agente, empresaId);
    expect(leido.body.resumen).toEqual(res.body.resumen);
  });

  it("es por persona: otro usuario de la misma empresa no ve el resumen ajeno", async () => {
    const { empresaId } = await empresaDelAgente();
    expect((await resumir(agente, empresaId)).status).toBe(201);
    expect((await ver(admin, empresaId)).body.resumen).toBeNull();
  });

  it("un agente solo le manda a la IA sus oportunidades y cotizaciones, no las de otro agente en la misma empresa", async () => {
    const { empresaId, oportunidadId } = await empresaDelAgente();
    // El admin le crea al otro agente una oportunidad en la misma empresa (la empresa sigue siendo del primero).
    const ajena = await api().post("/api/v1/oportunidades").set("Cookie", admin).send({ empresaId, titulo: "Oportunidad del otro agente", responsableId: otroAgenteId });
    expect(ajena.status).toBe(201);
    const cot = await api().post("/api/v1/cotizaciones").set("Cookie", agente).send({ empresaId, oportunidadId, partidas: [{ descripcion: "Molde de 4 cavidades", cantidad: 2, precioUnitario: 168500 }] });
    expect(cot.status).toBe(201);

    expect((await resumir(agente, empresaId)).status).toBe(201);
    const texto = ultimaPregunta();
    expect(texto).not.toContain("Oportunidad del otro agente");
    expect(texto).toContain(`#${cot.body.id}`);
    expect(texto).toContain("$337,000");

    // El admin sí la ve.
    expect((await resumir(admin, empresaId)).status).toBe(201);
    expect(ultimaPregunta()).toContain("Oportunidad del otro agente");
    void agenteId;
  });

  it("no le manda a la IA correos ni teléfonos que vengan dentro de los textos", async () => {
    const { empresaId } = await empresaDelAgente();
    expect((await api().post("/api/v1/actividades").set("Cookie", agente).send({ empresaId, tipo: "comentario", comentario: "Escribirle a ana.ruiz@moldes.mx o llamarle al 442 123 4567" })).status).toBe(201);
    expect((await resumir(agente, empresaId)).status).toBe(201);
    const texto = ultimaPregunta();
    expect(texto).not.toContain("ana.ruiz@moldes.mx");
    expect(texto).not.toContain("442 123 4567");
    expect(texto).toContain("[correo]");
    expect(texto).toContain("[teléfono]");
  });

  it("solo mira los últimos 12 meses", async () => {
    const { empresaId } = await empresaDelAgente();
    const vieja = await api().post("/api/v1/actividades").set("Cookie", agente).send({ empresaId, tipo: "comentario", comentario: "Esto pasó hace mucho" });
    expect(vieja.status).toBe(201);
    await db.update(actividades).set({ ocurridaEn: sql`NOW() - INTERVAL 14 MONTH` }).where(eq(actividades.id, vieja.body.id));
    expect((await resumir(agente, empresaId)).status).toBe(201);
    expect(ultimaPregunta()).not.toContain("Esto pasó hace mucho");
  });

  it("si hay movimientos nuevos después del resumen, sale desactualizado", async () => {
    const { empresaId } = await empresaDelAgente();
    const generado = await resumir(agente, empresaId);
    expect(generado.status).toBe(201);
    const nueva = await api().post("/api/v1/actividades").set("Cookie", agente).send({ empresaId, tipo: "whatsapp", resultado: "Confirmó la llamada" });
    expect(nueva.status).toBe(201);
    // Un minuto adelante para que sea claramente posterior a todo lo que entró al resumen.
    await db.update(actividades).set({ ocurridaEn: sql`NOW() + INTERVAL 1 MINUTE` }).where(eq(actividades.id, nueva.body.id));
    expect((await ver(agente, empresaId)).body.desactualizado).toBe(true);
  });

  it("recién hecho no sale desactualizado aunque el último movimiento traiga la hora de la API un poco adelantada", async () => {
    const { empresaId } = await empresaDelAgente();
    // La hora de las actividades la pone la API y la del resumen MySQL; pueden no coincidir.
    await db.update(actividades).set({ ocurridaEn: sql`NOW() + INTERVAL 3 SECOND` }).where(eq(actividades.empresaId, empresaId));
    const res = await resumir(agente, empresaId);
    expect(res.status).toBe(201);
    expect(res.body.desactualizado).toBe(false);
    expect((await ver(agente, empresaId)).body.desactualizado).toBe(false);
  });

  it("sin historial ni oportunidades no se puede resumir (409 SIN_INFORMACION)", async () => {
    const res = await api().post("/api/v1/empresas").set("Cookie", agente).send({ nombreLegal: `Vacía ${randomUUID().slice(0, 8)}`, contactos: [{ nombre: "Nadie", correo: `nadie.${randomUUID()}@cliente.test` }] });
    expect(res.status).toBe(201);
    const leido = await ver(agente, res.body.id);
    expect(leido.body).toEqual(expect.objectContaining({ puede_generar: false, motivo: "Todavía no hay suficiente información para resumir." }));
    const intento = await resumir(agente, res.body.id);
    expect(intento.status).toBe(409);
    expect(intento.body.code).toBe("SIN_INFORMACION");
  });

  it("si la IA falla o no regresa resumen: 502 y no se guarda nada", async () => {
    const { empresaId } = await empresaDelAgente();
    ia.fallar = true;
    expect((await resumir(agente, empresaId)).status).toBe(502);
    ia.fallar = false;
    ia.respuesta = {};
    expect((await resumir(agente, empresaId)).status).toBe(502);
    expect((await ver(agente, empresaId)).body.resumen).toBeNull();
  });

  it("máximo 20 resúmenes por persona al día (429)", async () => {
    const { empresaId } = await empresaDelAgente();
    const filas = Array.from({ length: 20 }, () => ({ usuarioId: otroAgenteId, tipo: "resumen_ficha", empresaId, resultado: "{}" }));
    await db.insert(usoIa).values(filas);
    // Los 20 son del otro agente: al dueño no le cuentan.
    expect((await resumir(agente, empresaId)).status).toBe(201);
    const empresa2 = await api().post("/api/v1/empresas").set("Cookie", otroAgente).send({ nombreLegal: `Otra ${randomUUID().slice(0, 8)}`, contactos: [{ nombre: "Luis", correo: `luis.${randomUUID()}@cliente.test` }] });
    expect((await api().post("/api/v1/actividades").set("Cookie", otroAgente).send({ empresaId: empresa2.body.id, tipo: "llamada", resultado: "Sin respuesta" })).status).toBe(201);
    const res = await resumir(otroAgente, empresa2.body.id);
    expect(res.status).toBe(429);
    expect(res.body.message).toContain("20");
  });
});
