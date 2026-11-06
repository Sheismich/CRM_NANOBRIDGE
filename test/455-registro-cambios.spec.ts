import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq, sql } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, SEED_ADMIN } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { binario, textoDelPdf } from "./support/pdf.js";
import { auditoria } from "../src/database/schema.js";
import { parseCsv } from "../src/shared/csv.js";
import { RegistroCambiosService } from "../src/admin/registro-cambios.service.js";
import { tipoDeFila } from "../src/admin/registro-cambios.catalogo.js";

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

  // Filtros de la pantalla (6-nov-2026): sacar el registro de un día, de una
  // persona o de una cosa hecha; el PDF y el CSV traen exactamente lo mismo.
  describe("filtros por fecha, persona y acción", () => {
    const DIA = "2026-03-10";
    let adminId: number;
    let otroId: number;
    // Una fila de auditoría en un instante UTC exacto (México = UTC-6 en marzo).
    const fila = (usuarioId: number, accion: string, creadoEn: string, giro: string) =>
      db.insert(auditoria).values({ usuarioId, entidad: "empresa", entidadId: empresaId, accion, antes: { giro: `antes ${giro}` }, despues: { giro }, creadoEn: sql`${creadoEn}` });
    const exportar = (query: Record<string, unknown>) => api().get("/api/v1/admin/registro-cambios/export").set("Cookie", adminCookie).query(query);
    const giros = (filas: Fila[]) => filas.flatMap((f) => f.cambios.map((c) => c.despues));

    beforeAll(async () => {
      adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;
      otroId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
      await fila(agenteId, "actualizar", "2026-03-10 05:59:59", "fin del dia 9"); // 9-mar 23:59:59 en México
      await fila(agenteId, "actualizar", "2026-03-10 06:00:00", "inicio del dia 10"); // 10-mar 00:00:00
      await fila(adminId, "crear", "2026-03-10 18:00:00", "alta del admin"); // 10-mar 12:00
      await fila(agenteId, "crear", "2026-03-11 02:00:00", "alta de la tarde"); // 10-mar 20:00, ya es 11 en UTC
      await fila(adminId, "actualizar", "2026-03-11 05:59:59", "fin del dia 10"); // 10-mar 23:59:59
      await fila(agenteId, "actualizar", "2026-03-11 06:00:00", "inicio del dia 11"); // 11-mar 00:00:00
    });

    it("un solo día es el día de México, de las 00:00 a las 23:59:59", async () => {
      const { data, total } = await registro({ desde: DIA, hasta: DIA, tipo: "ediciones" });
      expect(total).toBe(4);
      expect(giros(data)).toEqual(["fin del dia 10", "alta de la tarde", "alta del admin", "inicio del dia 10"]);
    });

    it("filtra por persona, dentro del rango", async () => {
      expect(giros((await registro({ desde: DIA, hasta: DIA, usuarioId: agenteId })).data)).toEqual(["alta de la tarde", "inicio del dia 10"]);
      expect(giros((await registro({ desde: DIA, hasta: DIA, usuarioId: adminId })).data)).toEqual(["fin del dia 10", "alta del admin"]);
      expect((await registro({ desde: DIA, hasta: DIA, usuarioId: otroId })).total).toBe(0);
    });

    it("filtra por acción (entidad y verbo juntos, no solo el verbo)", async () => {
      const ediciones = await registro({ desde: DIA, hasta: DIA, accion: "empresa:actualizar" });
      expect(giros(ediciones.data)).toEqual(["fin del dia 10", "inicio del dia 10"]);
      expect(ediciones.data.every((f) => f.registro.entidad === "empresa" && f.accion === "actualizar")).toBe(true);

      // "usuario:crear" tiene el mismo verbo que "empresa:crear" y no debe traerla.
      expect((await registro({ desde: DIA, hasta: DIA, accion: "usuario:crear" })).total).toBe(0);
      const altas = (await registro({ q: marca, accion: "usuario:crear" })).data;
      expect(altas.length).toBeGreaterThan(0);
      expect(altas.every((f) => f.registro.entidad === "usuario" && f.accion === "crear")).toBe(true);
    });

    it("una acción que no está en el catálogo se rechaza, y no abre lo que el registro deja fuera", async () => {
      expect((await api().get("/api/v1/admin/registro-cambios").set("Cookie", adminCookie).query({ accion: "tarea:cerrar" })).status).toBe(400);
      expect((await exportar({ formato: "csv", accion: "tarea:cerrar" })).status).toBe(400);
    });

    it("la baja de un prospecto hecha por una persona se filtra como acción, venga del verbo que venga", async () => {
      await db.insert(auditoria).values({ usuarioId: agenteId, entidad: "prospecto", entidadId: 999_999, accion: "clasificar", despues: { estado: "baja" }, creadoEn: sql`'2026-03-12 18:00:00'` });
      await db.insert(auditoria).values({ usuarioId: agenteId, entidad: "prospecto", entidadId: 999_999, accion: "clasificar", despues: { estado: "interesado" }, creadoEn: sql`'2026-03-12 18:00:00'` });
      const { data } = await registro({ desde: "2026-03-12", hasta: "2026-03-12", accion: "prospecto:baja" });
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ tipo: "borrados", registro: { entidad: "prospecto" } });
    });

    it("combina los filtros: día, persona, acción y tipo", async () => {
      const { data } = await registro({ desde: DIA, hasta: DIA, usuarioId: agenteId, accion: "empresa:crear", tipo: "ediciones" });
      expect(giros(data)).toEqual(["alta de la tarde"]);
      // Una acción de otro tipo no trae nada: los filtros se suman, no se pisan.
      expect((await registro({ desde: DIA, hasta: DIA, accion: "empresa:crear", tipo: "borrados" })).total).toBe(0);
    });

    it("el CSV trae exactamente lo mismo que la pantalla, y la exportación guarda los filtros", async () => {
      const filtros = { desde: DIA, hasta: DIA, usuarioId: agenteId, accion: "empresa:actualizar" };
      const res = await exportar({ formato: "csv", ...filtros });
      expect(res.status).toBe(200);
      const { filas } = parseCsv(res.text);
      const enPantalla = (await registro(filtros)).data;
      expect(filas.map((f) => f.accion)).toEqual(enPantalla.map((f) => f.texto));
      expect(filas.map((f) => f.despues)).toEqual(["Giro: inicio del dia 10"]);
      expect(filas[0]!.fecha).toBe("2026-03-10 00:00");

      const [ultima] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "registro_cambios"), eq(auditoria.accion, "exportar"))).orderBy(desc(auditoria.id)).limit(1);
      expect(ultima!.despues).toMatchObject({ formato: "csv", renglones: 1, filtros });
    });

    it("el archivo de un solo día se llama con ese día; el de un rango, con los dos", async () => {
      expect((await exportar({ formato: "csv", desde: DIA, hasta: DIA })).headers["content-disposition"]).toContain(`filename="registro-de-cambios-${DIA}.csv"`);
      expect((await exportar({ formato: "csv", desde: DIA, hasta: "2026-03-11" })).headers["content-disposition"]).toContain(`filename="registro-de-cambios-${DIA}-a-2026-03-11.csv"`);
    });

    it("el PDF trae solo lo filtrado y dice en el encabezado qué filtros lleva", async () => {
      const res = await exportar({ formato: "pdf", desde: DIA, hasta: DIA, usuarioId: agenteId, accion: "empresa:crear" }).buffer(true).parse(binario);
      expect(res.status).toBe(200);
      const texto = (await textoDelPdf(res.body as Buffer)).join(" ");
      expect(texto).toContain("El 10 mar 2026");
      expect(texto).toContain(`Persona: ${agenteNombre}`);
      expect(texto).toContain("Acción: Alta de empresa");
      expect(texto).toContain("dio de alta la empresa");
      expect(texto).not.toContain("editó la empresa");
    });

    it("sin fecha de inicio, los 30 días cuentan hacia atrás desde la fecha final", async () => {
      const { filas } = parseCsv((await exportar({ formato: "csv", hasta: DIA, usuarioId: agenteId, accion: "empresa:actualizar" })).text);
      expect(filas.map((f) => f.despues)).toEqual(["Giro: inicio del dia 10", "Giro: fin del dia 9"]);
    });

    it("las opciones de los filtros: todas las acciones con nombre, y las personas incluyen a las desactivadas", async () => {
      const inactivo = await api().post("/api/v1/usuarios").set("Cookie", adminCookie).send({ nombre: `Ex ${marca}`, correo: `ex.${randomUUID()}@test.local`, password: "password_agente_1", rol: "agente" });
      expect(inactivo.status).toBe(201);
      expect((await api().delete(`/api/v1/usuarios/${inactivo.body.id}`).set("Cookie", adminCookie)).status).toBe(204);

      const res = await api().get("/api/v1/admin/registro-cambios/filtros").set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      const { acciones, personas } = res.body as { acciones: { clave: string; etiqueta: string; tipo: string }[]; personas: { id: number; nombre: string; activo: boolean }[] };

      expect(new Set(acciones.map((a) => a.clave)).size).toBe(acciones.length);
      expect(acciones.every((a) => a.etiqueta.length > 0)).toBe(true);
      expect(acciones.find((a) => a.clave === "prospecto:baja")).toMatchObject({ tipo: "borrados" });
      expect(acciones.find((a) => a.clave === "empresa:crear")).toEqual({ clave: "empresa:crear", etiqueta: "Alta de empresa", tipo: "ediciones" });
      // Cada acción del catálogo cae en el tipo que dice ser.
      for (const a of acciones) {
        const [entidad, accion] = a.clave.split(":") as [string, string];
        expect(tipoDeFila(entidad, accion, a.clave === "prospecto:baja" ? { estado: "baja" } : null), a.clave).toBe(a.tipo);
      }

      expect(personas.find((p) => p.id === agenteId)).toEqual({ id: agenteId, nombre: agenteNombre, activo: true });
      expect(personas.find((p) => p.id === inactivo.body.id)).toMatchObject({ nombre: `Ex ${marca}`, activo: false });
      const nombres = personas.map((p) => p.nombre);
      expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, "es")));

      expect((await api().get("/api/v1/admin/registro-cambios/filtros").set("Cookie", agenteCookie)).status).toBe(403);
    });
  });
});
