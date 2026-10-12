import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, SEED_ADMIN } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { binario, textoDelPdf } from "./support/pdf.js";
import { auditoria } from "../src/database/schema.js";
import { parseCsv } from "../src/shared/csv.js";
import { RegistroCambiosService } from "../src/admin/registro-cambios.service.js";

// Registro de cambios de Administración (12-oct-2026; punto 53): "quién movió
// qué", solo administrador. Cinco filtros (usuarios y roles, ediciones,
// borrados, descargas, configuración); el trabajo del día (tareas,
// clasificar) y lo que hace la automatización sola NO entran: eso está en
// Reportes · Día. Cada fila trae la frase ya armada y el antes → después con
// nombres en vez de ids, igual en pantalla, PDF y CSV.
describe("administración: registro de cambios", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let agenteNombre: string;
  let empresaId: number;
  let empresaNombre: string;
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  type Fila = { id: number; tipo: string; accion: string; texto: string; usuario: { id: number; nombre: string }; registro: { entidad: string; id: number; nombre: string | null }; cambios: { campo: string; etiqueta: string; antes: string; despues: string }[]; antes: unknown };

  async function registro(query: Record<string, unknown> = {}) {
    const res = await api().get("/api/v1/admin/registro-cambios").set("Cookie", adminCookie).query({ limit: 100, ...query });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { page: number; limit: number; total: number; data: Fila[] };
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);

    // Usuarios y roles: alta de una agente y luego su cambio de rol.
    const correo = `registro.${randomUUID()}@test.local`;
    agenteNombre = `Tania ${marca}`;
    const alta = await api().post("/api/v1/usuarios").set("Cookie", adminCookie).send({ nombre: agenteNombre, correo, password: "password_agente_1", rol: "agente" });
    expect(alta.status).toBe(201);
    agenteId = alta.body.id;

    // Ediciones: empresa nueva, se le cambia el giro, y al darle una
    // oportunidad a la agente la empresa pasa a ser suya (sin asignar → ella).
    empresaNombre = `Moldes ${marca} SA`;
    const emp = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: empresaNombre, giro: "Manufactura", contactos: [{ nombre: `Juan ${marca}`, correo: `juan.${randomUUID()}@test.local` }] });
    expect(emp.status).toBe(201);
    empresaId = emp.body.id;
    expect((await api().patch(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie).send({ giro: "Plásticos" })).status).toBe(200);
    expect((await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo: `Op ${marca}`, responsableId: agenteId })).status).toBe(201);

    // Borrados: se da de baja el contacto.
    const contactoId = (await api().get(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie)).body.contactos[0].id;
    expect((await api().delete(`/api/v1/empresas/${empresaId}/contactos/${contactoId}`).set("Cookie", adminCookie)).status).toBe(204);

    // Configuración: una campaña nueva.
    expect((await api().post("/api/v1/campanas").set("Cookie", adminCookie).send({ nombre: `Campaña ${marca}`, canal: "correo" })).status).toBe(201);

    // Descargas: un CSV de reportes (ahora queda auditado).
    expect((await api().get("/api/v1/reportes/export/tareas").set("Cookie", adminCookie)).status).toBe(200);

    // El cambio de rol al final, para que sea lo más nuevo.
    expect((await api().patch(`/api/v1/usuarios/${agenteId}`).set("Cookie", adminCookie).send({ rol: "supervisor" })).status).toBe(200);
    expect((await api().patch(`/api/v1/usuarios/${agenteId}`).set("Cookie", adminCookie).send({ rol: "agente" })).status).toBe(200);
    agenteCookie = await crearAgente(app, adminCookie, `registro.otra.${Date.now()}@test.local`);

    // Trabajo del día y automatización: NO deben salir.
    await db.insert(auditoria).values({ usuarioId: null, entidad: "empresa", entidadId: empresaId, accion: "actualizar", antes: { giro: "x" }, despues: { giro: "y" } });
    const tarea = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: `Tarea ${marca}`, responsableId: agenteId, tipo: "seguimiento" });
    expect(tarea.status).toBe(201);
    await db.insert(auditoria).values({ usuarioId: agenteId, entidad: "tarea", entidadId: tarea.body.id, accion: "cerrar", despues: { resultado: "hecho" } });
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("usuarios y roles: alta y cambio de rol, con el antes → después", async () => {
    const { data } = await registro({ tipo: "usuarios_roles", entidad: "usuario", entidadId: agenteId });
    expect(data.map((f) => f.accion)).toEqual(["actualizar", "actualizar", "crear"]);
    expect(data.every((f) => f.tipo === "usuarios_roles")).toBe(true);
    expect(data[1]).toMatchObject({ texto: `${SEED_ADMIN.nombre} cambió el rol de ${agenteNombre}.`, cambios: [{ campo: "rol", etiqueta: "Rol", antes: "Agente", despues: "Supervisor" }] });
    expect(data[2]!.texto).toBe(`${SEED_ADMIN.nombre} dio de alta a ${agenteNombre} como Agente.`);
    expect(data[2]!.usuario.nombre).toBe(SEED_ADMIN.nombre);
  });

  it("ediciones: cambios con nombre de campo y nombres en vez de ids (sin asignar → la agente)", async () => {
    const { data } = await registro({ tipo: "ediciones", entidad: "empresa", entidadId: empresaId });
    const edicion = data.find((f) => f.accion === "actualizar")!;
    expect(edicion).toMatchObject({ texto: `${SEED_ADMIN.nombre} editó la empresa ${empresaNombre}.`, cambios: [{ campo: "giro", etiqueta: "Giro", antes: "Manufactura", despues: "Plásticos" }] });
    // Quien la da de alta queda de dueño; la oportunidad se la pasó a la agente.
    const asignacion = data.find((f) => f.accion === "tomar_empresa")!;
    expect(asignacion.cambios).toEqual([{ campo: "propietario_id", etiqueta: "Responsable", antes: SEED_ADMIN.nombre, despues: agenteNombre }]);
    expect(asignacion.texto).toBe(`${SEED_ADMIN.nombre} le dio la empresa ${empresaNombre} a ${agenteNombre}.`);

    // Sin dueño antes: "sin asignar".
    const adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;
    await db.insert(auditoria).values({ usuarioId: adminId, entidad: "empresa", entidadId: empresaId, accion: "tomar_empresa", antes: { propietario_id: null }, despues: { propietario_id: agenteId, origen: "tarea" } });
    const [ultima] = (await registro({ tipo: "ediciones", entidad: "empresa", entidadId: empresaId, limit: 1 })).data;
    expect(ultima!.cambios).toEqual([{ campo: "propietario_id", etiqueta: "Responsable", antes: "sin asignar", despues: agenteNombre }]);
    // La edición sin persona detrás (automatización) no sale.
    expect(data.filter((f) => f.accion === "actualizar")).toHaveLength(1);
  });

  it("borrados, configuración y descargas traen lo suyo y no lo de otro filtro", async () => {
    const borrados = (await registro({ tipo: "borrados", q: marca })).data;
    expect(borrados.some((f) => f.registro.entidad === "contacto" && f.texto === `${SEED_ADMIN.nombre} dio de baja el contacto Juan ${marca} de ${empresaNombre}.`)).toBe(true);
    expect(borrados.every((f) => f.tipo === "borrados")).toBe(true);
    // El "ver cómo estaba": el antes crudo.
    expect(borrados.find((f) => f.registro.entidad === "contacto")!.antes).toEqual({ activo: true });

    const config = (await registro({ tipo: "configuracion", q: `Campaña ${marca}` })).data;
    expect(config.map((f) => f.texto)).toEqual([`${SEED_ADMIN.nombre} creó la campaña Campaña ${marca}.`]);

    const descargas = (await registro({ tipo: "descargas", usuarioId: (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id })).data;
    expect(descargas.some((f) => f.registro.entidad === "reporte" && f.texto === `${SEED_ADMIN.nombre} exportó el reporte de tareas (CSV).`)).toBe(true);
    expect(descargas.every((f) => f.tipo === "descargas")).toBe(true);
  });

  it("el trabajo del día no entra al registro", async () => {
    const { data } = await registro({ q: marca });
    expect(data.some((f) => f.registro.entidad === "tarea")).toBe(false);
    expect(data.every((f) => f.usuario != null)).toBe(true);
  });

  it("busca por nombre de quien lo hizo o del registro, filtra por días de México y pagina", async () => {
    const porEmpresa = (await registro({ q: `Moldes ${marca}` })).data;
    expect(porEmpresa.length).toBeGreaterThan(0);
    expect(porEmpresa.every((f) => f.registro.nombre?.includes(marca) || f.texto.includes(marca))).toBe(true);
    const porPersona = (await registro({ q: agenteNombre })).data;
    expect(porPersona.some((f) => f.registro.entidad === "usuario" && f.registro.id === agenteId)).toBe(true);

    expect((await registro({ q: marca, desde: "2020-01-01", hasta: "2020-01-31" })).total).toBe(0);
    const pagina = await registro({ q: marca, limit: 2, page: 1 });
    expect(pagina.data).toHaveLength(2);
    expect(pagina.total).toBeGreaterThan(2);
  });

  describe("exportar", () => {
    it("CSV con todas las filas del filtro, y la exportación misma queda en el registro", async () => {
      const res = await api().get("/api/v1/admin/registro-cambios/export").set("Cookie", adminCookie).query({ formato: "csv", q: marca });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment; filename=\"registro-de-cambios-");
      expect(res.text.startsWith("﻿")).toBe(true);
      const { encabezados, filas } = parseCsv(res.text);
      expect(encabezados).toEqual(["fecha", "quien", "accion", "registro", "antes", "despues"]);
      expect(filas.length).toBe((await registro({ q: marca })).total);
      expect(filas.some((f) => f.antes === "Giro: Manufactura" && f.despues === "Giro: Plásticos")).toBe(true);

      const [exportacion] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "registro_cambios"), eq(auditoria.accion, "exportar"))).orderBy(auditoria.id);
      expect(exportacion).toBeDefined();
    });

    it("PDF en hoja carta con el molde: varias hojas con encabezado, y aviso cuando pasa del tope", async () => {
      const res = await api().get("/api/v1/admin/registro-cambios/export").set("Cookie", adminCookie).query({ formato: "pdf", q: marca }).buffer(true).parse(binario);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      const hojas = await textoDelPdf(res.body as Buffer);
      expect(hojas[0]).toContain("Registro de cambios");
      expect(hojas[0]).toContain("QUÉ PASÓ");
      expect(hojas.join(" ")).toContain(`cambió el rol de ${agenteNombre}`);

      // Tope chico directo en el servicio: no se espera a tener 2,000 filas.
      const servicio = app.get(RegistroCambiosService);
      const { contenido } = await servicio.exportar({ formato: "pdf", tipo: "todo", q: marca }, { id: 1, nombre: SEED_ADMIN.nombre, correo: "", rol: "administrador" }, { tope: 3 });
      const corto = (await textoDelPdf(contenido as Buffer)).join(" ");
      expect(corto).toMatch(/Se muestran 3 de \d+ cambios; para verlos todos use el CSV\./);
    });

    it("sin fechas son los últimos 30 días, y es solo del administrador", async () => {
      await db.insert(auditoria).values({ usuarioId: agenteId, entidad: "usuario", entidadId: agenteId, accion: "actualizar", antes: { nombre: `Viejo ${marca}` }, despues: { nombre: `Nuevo ${marca}` }, creadoEn: new Date(Date.now() - 45 * 86_400_000) });
      const res = await api().get("/api/v1/admin/registro-cambios/export").set("Cookie", adminCookie).query({ formato: "csv", q: marca });
      expect(res.text).not.toContain(`Viejo ${marca}`);
      // En pantalla no hay rango por omisión: ahí sí sale.
      expect((await registro({ usuarioId: agenteId, tipo: "usuarios_roles" })).data.some((f) => f.cambios.some((c) => c.antes === `Viejo ${marca}`))).toBe(true);

      expect((await api().get("/api/v1/admin/registro-cambios").set("Cookie", agenteCookie)).status).toBe(403);
      expect((await api().get("/api/v1/admin/registro-cambios/export").set("Cookie", agenteCookie)).status).toBe(403);
    });
  });
});
