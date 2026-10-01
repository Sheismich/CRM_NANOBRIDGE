import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq, sql } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, contactos, eventosPendientes, incidencias, mediosContacto, prospectos, respuestas, tareas } from "../src/database/schema.js";
import { CLASIFICACIONES_RESPUESTA } from "../src/shared/clasificaciones.js";
import { recortarTexto } from "../src/shared/texto.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Flujo de B2 (PLAN_N8N_DEFINITIVO.md) desde que llega una respuesta hasta
// que queda clasificada, sea por n8n (POST /automatizacion/respuestas/
// clasificacion) o a mano desde la cola de clasificación del CRM, cuando n8n
// la marcó "ambigua". Ninguno de estos endpoints tenía cobertura propia.
describe("respuestas: clasificación automática y manual", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function registrarProspecto(opciones: { conTelefono?: boolean } = {}) {
    const correo = `respuesta.${randomUUID()}@respuestas.test`;
    const telefono = opciones.conTelefono ? `55${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` : undefined;
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Respuestas ${randomUUID()}` }, contacto: { nombre: "Persona Respuesta", correo, telefono } });
    expect(res.status).toBe(201);
    const [fila] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, res.body.id));
    return { id: res.body.id as number, contactoId: fila!.contactoId, correo, telefono };
  }

  function enSupresion(tipo: "correo" | "telefono", valor: string) {
    return api().get("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).query({ tipo, valor }).then((res) => res.body.en_supresion as boolean);
  }

  async function registrarRespuesta(prospectoId: number, contenido = "Gracias por escribir") {
    const res = await api()
      .post("/api/v1/automatizacion/respuestas")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo", contenido });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function valoresEnum(tabla: string, columna: string) {
    const [filas] = await db.execute(sql`SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tabla} AND COLUMN_NAME = ${columna}`);
    const tipo = (filas as unknown as { tipo: string }[])[0]!.tipo;
    return [...tipo.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  }

  function clasificarAutomatica(respuestaId: number, clasificacion: string) {
    return api()
      .post("/api/v1/automatizacion/respuestas/clasificacion")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion });
  }

  // String.slice corta por unidades UTF-16: un emoji (2 unidades) justo en
  // el límite quedaba partido y la base guardaba un carácter roto.
  describe("recortarTexto", () => {
    it("recorta por caracteres completos, sin partir un emoji en el límite", () => {
      expect(recortarTexto(`${"a".repeat(4)}😀zz`, 5)).toBe("aaaa😀");
      expect(recortarTexto(`${"a".repeat(5)}😀`, 5)).toBe("aaaaa");
      expect(recortarTexto("corto", 500)).toBe("corto");
    });
  });

  describe("tarea de clasificación ligada a su respuesta", () => {
    it("una respuesta 'ambigua' crea una tarea de clasificación que apunta a esa respuesta (respuesta_id)", async () => {
      const prospecto = await registrarProspecto();
      await registrarRespuesta(prospecto.id, "primera respuesta, ya resuelta");
      const respuestaId = await registrarRespuesta(prospecto.id, "¿de qué se trata?");

      const res = await clasificarAutomatica(respuestaId, "ambigua");
      expect(res.status).toBe(201);
      expect(res.body.tarea_id).toEqual(expect.any(Number));

      const tarea = await api().get(`/api/v1/tareas/${res.body.tarea_id}`).set("Cookie", adminCookie);
      expect(tarea.status).toBe(200);
      expect(tarea.body.tipo).toBe("clasificacion");
      expect(tarea.body.prospecto_id).toBe(prospecto.id);
      expect(tarea.body.respuesta_id).toBe(respuestaId);
    });

    it("la cola de clasificación trae la respuesta, la empresa y el contacto de cada tarea", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "¿Me pueden mandar precios?");
      const res = await clasificarAutomatica(respuestaId, "ambigua");
      expect(res.status).toBe(201);

      const cola = await api().get("/api/v1/cola-clasificacion").query({ limit: 100 }).set("Cookie", adminCookie);
      expect(cola.status).toBe(200);
      const item = cola.body.data.find((t: { id: number }) => t.id === res.body.tarea_id);
      expect(item).toMatchObject({
        tipo: "clasificacion",
        empresa_nombre: expect.stringMatching(/^Empresa Respuestas /),
        contacto_nombre: "Persona Respuesta",
        respuesta: { id: respuestaId, canal: "correo", contenido: "¿Me pueden mandar precios?", clasificacion_sugerida: "ambigua" }
      });

      const bandeja = await api().get("/api/v1/tareas").query({ tipo: "clasificacion", limit: 100 }).set("Cookie", adminCookie);
      expect(bandeja.body.data.find((t: { id: number }) => t.id === res.body.tarea_id)?.empresa_nombre).toMatch(/^Empresa Respuestas /);
    });

    // Las tareas de clasificación creadas antes de 022 no tienen
    // respuesta_id; la migración las liga por el execution_id que les pone
    // clasificarRespuesta ("resp-clasif-" + execution_id de la
    // clasificación). Se simula una tarea "vieja" y se corre la sentencia
    // de backfill tal cual está en el archivo de la migración.
    it("el backfill de la migración 022 liga las tareas de clasificación anteriores con su respuesta", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "respuesta de antes de la migración");
      const res = await clasificarAutomatica(respuestaId, "ambigua");
      const tareaId = res.body.tarea_id as number;
      await db.update(tareas).set({ respuestaId: null }).where(eq(tareas.id, tareaId));

      const archivo = await readFile(new URL("../src/database/migrations/022_clasificacion_manual.sql", import.meta.url), "utf8");
      const backfill = archivo.split("-- statement-break").find((s) => /UPDATE\s+tareas/i.test(s));
      expect(backfill).toBeDefined();
      await db.execute(sql.raw(backfill!));

      const [tarea] = await db.select({ respuestaId: tareas.respuestaId }).from(tareas).where(eq(tareas.id, tareaId));
      expect(tarea!.respuestaId).toBe(respuestaId);
    });

    // Las clasificaciones viven en una sola constante (de ella salen los
    // schemas de Zod y el de Drizzle), pero el SQL de las migraciones se
    // escribe a mano: si alguien cambia una lista y no la otra, esto truena.
    it("el ENUM real de respuestas.clasificacion coincide con CLASIFICACIONES_RESPUESTA", async () => {
      expect(await valoresEnum("respuestas", "clasificacion")).toEqual([...CLASIFICACIONES_RESPUESTA]);
    });

    it("respuestas.clasificacion admite los valores que solo usa la clasificación manual (invalido, reagendar)", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id);

      for (const valor of ["invalido", "reagendar"] as const) {
        await db.update(respuestas).set({ clasificacion: valor }).where(eq(respuestas.id, respuestaId));
        const [fila] = await db.select({ clasificacion: respuestas.clasificacion }).from(respuestas).where(eq(respuestas.id, respuestaId));
        expect(fila!.clasificacion).toBe(valor);
      }
    });
  });

  // Antes la API solo cambiaba el estado del prospecto y dejaba a n8n
  // llamar aparte a POST /automatizacion/supresion: una obligación legal
  // dependiendo de un paso que se podía olvidar o fallar por separado.
  describe("clasificación de n8n", () => {
    // Regla del 24-sep-2026: la persona pidió no ser contactada, no dejar
    // un canal -- se suprimen TODOS sus medios (correo, teléfono,
    // WhatsApp), no solo los del canal por el que respondió.
    it("'baja' deja el prospecto en baja y suprime todos los medios del contacto en la misma operación", async () => {
      const prospecto = await registrarProspecto({ conTelefono: true });
      const respuestaId = await registrarRespuesta(prospecto.id, "ya no me escriban");

      const res = await clasificarAutomatica(respuestaId, "baja");
      expect(res.status).toBe(201);

      const [fila] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospecto.id));
      expect(fila!.estado).toBe("baja");
      expect(await enSupresion("correo", prospecto.correo)).toBe(true);
      expect(await enSupresion("telefono", prospecto.telefono!)).toBe(true);
    });

    it("'no_interesado' no suprime nada", async () => {
      const prospecto = await registrarProspecto({ conTelefono: true });
      const respuestaId = await registrarRespuesta(prospecto.id, "no gracias");
      expect((await clasificarAutomatica(respuestaId, "no_interesado")).status).toBe(201);

      expect(await enSupresion("correo", prospecto.correo)).toBe(false);
      expect(await enSupresion("telefono", prospecto.telefono!)).toBe(false);
    });

    it("'baja' de un contacto sin medios que suprimir: se aplica igual y queda una incidencia", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "bórrenme");
      await db.delete(mediosContacto).where(eq(mediosContacto.contactoId, prospecto.contactoId));

      const res = await clasificarAutomatica(respuestaId, "baja");
      expect(res.status).toBe(201);

      const [fila] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospecto.id));
      expect(fila!.estado).toBe("baja");
      const [incidencia] = await db.select().from(incidencias).where(and(eq(incidencias.prospectoId, prospecto.id), eq(incidencias.tipo, "baja_sin_medios")));
      expect(incidencia).toBeDefined();
      expect(incidencia!.severidad).toBe("alta");
    });

    it("n8n no puede usar los valores que solo existen en la clasificación manual", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id);
      expect((await clasificarAutomatica(respuestaId, "invalido")).status).toBe(400);
      expect((await clasificarAutomatica(respuestaId, "reagendar")).status).toBe(400);
    });
  });

  // Antes la clasificación manual solo cerraba la tarea y encolaba un
  // evento para n8n: ni el prospecto ni la respuesta cambiaban, y un "ya no
  // me escriban" no tenía opción propia, así que el correo nunca llegaba a
  // lista_supresion (hallazgo de revisión, 24-sep-2026).
  describe("clasificación manual (cola de clasificación) aplica la decisión", () => {
    async function tareaDeRespuestaAmbigua() {
      const prospecto = await registrarProspecto({ conTelefono: true });
      const respuestaId = await registrarRespuesta(prospecto.id, "mmm, no sé");
      const res = await clasificarAutomatica(respuestaId, "ambigua");
      expect(res.status).toBe(201);
      return { prospecto, respuestaId, tareaId: res.body.tarea_id as number };
    }

    function clasificarManual(tareaId: number, body: Record<string, unknown>, cookie = adminCookie) {
      return api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", cookie).send(body);
    }

    async function estadoProspecto(prospectoId: number) {
      const [fila] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId));
      return fila!.estado;
    }

    async function clasificacionRespuesta(respuestaId: number) {
      const [fila] = await db.select({ clasificacion: respuestas.clasificacion, estado: respuestas.estado }).from(respuestas).where(eq(respuestas.id, respuestaId));
      return fila!;
    }

    it.each([
      ["interesado", "interesado"],
      ["no_interesado", "no_interesado"],
      ["invalido", "descartado"]
    ])("'%s' cierra la tarea, deja la respuesta con esa clasificación y el prospecto en '%s'", async (clasificacion, estadoEsperado) => {
      const { prospecto, respuestaId, tareaId } = await tareaDeRespuestaAmbigua();

      const res = await clasificarManual(tareaId, { clasificacion });
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe("cerrada");
      expect(res.body.clasificacion).toBe(clasificacion);

      expect(await clasificacionRespuesta(respuestaId)).toEqual({ clasificacion, estado: "clasificada" });
      expect(await estadoProspecto(prospecto.id)).toBe(estadoEsperado);
      expect(await enSupresion("correo", prospecto.correo)).toBe(false);
    });

    it("'baja' suprime todos los medios del contacto (correo y teléfono), bloquea el envío y audita a quien clasificó", async () => {
      const { prospecto, respuestaId, tareaId } = await tareaDeRespuestaAmbigua();
      const adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id as number;

      const res = await clasificarManual(tareaId, { clasificacion: "baja", comentario: "pidió que ya no le escribamos" });
      expect(res.status).toBe(200);

      expect(await clasificacionRespuesta(respuestaId)).toEqual({ clasificacion: "baja", estado: "clasificada" });
      expect(await estadoProspecto(prospecto.id)).toBe("baja");
      expect(await enSupresion("correo", prospecto.correo)).toBe(true);
      expect(await enSupresion("telefono", prospecto.telefono!)).toBe(true);

      const verificacion = await api().get("/api/v1/automatizacion/envios/verificacion").set("X-API-Key", API_KEY).query({ prospecto_id: prospecto.id, canal: "correo" });
      expect(verificacion.body.puede_enviar).toBe(false);

      const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.accion, "registrar_supresion"), eq(auditoria.usuarioId, adminId))).orderBy(desc(auditoria.id)).limit(1);
      expect(audit).toBeDefined();
    });

    // Tareas de clasificación creadas a mano (POST /tareas) no tienen
    // respuesta: antes una "baja" ahí suponía canal correo; con la regla de
    // suprimir todos los medios ese caso ya no existe.
    it("'baja' en una tarea sin respuesta (creada a mano) también suprime todos los medios del contacto", async () => {
      const prospecto = await registrarProspecto({ conTelefono: true });
      const adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id as number;
      const creada = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ tipo: "clasificacion", titulo: "Clasificar a mano", responsableId: adminId, prospectoId: prospecto.id });
      expect(creada.status).toBe(201);

      expect((await clasificarManual(creada.body.id, { clasificacion: "baja" })).status).toBe(200);
      expect(await estadoProspecto(prospecto.id)).toBe("baja");
      expect(await enSupresion("correo", prospecto.correo)).toBe(true);
      expect(await enSupresion("telefono", prospecto.telefono!)).toBe(true);
    });

    it("'baja' sin medios que suprimir: la clasificación se aplica y queda una incidencia", async () => {
      const { prospecto, tareaId } = await tareaDeRespuestaAmbigua();
      await db.delete(mediosContacto).where(eq(mediosContacto.contactoId, prospecto.contactoId));

      expect((await clasificarManual(tareaId, { clasificacion: "baja" })).status).toBe(200);
      expect(await estadoProspecto(prospecto.id)).toBe("baja");
      const [incidencia] = await db.select().from(incidencias).where(and(eq(incidencias.prospectoId, prospecto.id), eq(incidencias.tipo, "baja_sin_medios")));
      expect(incidencia).toBeDefined();
    });

    it("'reagendar' exige fecha de seguimiento, y la fecha solo se acepta con 'reagendar'", async () => {
      const { tareaId } = await tareaDeRespuestaAmbigua();
      expect((await clasificarManual(tareaId, { clasificacion: "reagendar" })).status).toBe(400);
      expect((await clasificarManual(tareaId, { clasificacion: "interesado", fechaSeguimiento: new Date(Date.now() + 86_400_000).toISOString() })).status).toBe(400);
      expect((await clasificarManual(tareaId, { clasificacion: "reagendar", fechaSeguimiento: new Date(Date.now() - 86_400_000).toISOString() })).status).toBe(400);
    });

    it("'reagendar' crea una tarea de seguimiento asignada a quien clasificó, con esa fecha, sin cambiar el estado del prospecto", async () => {
      const { prospecto, respuestaId, tareaId } = await tareaDeRespuestaAmbigua();
      const adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id as number;
      const fecha = new Date(Date.now() + 7 * 86_400_000);
      fecha.setMilliseconds(0);

      const res = await clasificarManual(tareaId, { clasificacion: "reagendar", fechaSeguimiento: fecha.toISOString(), comentario: "llamar después del cierre de mes" });
      expect(res.status).toBe(200);

      expect(await clasificacionRespuesta(respuestaId)).toEqual({ clasificacion: "reagendar", estado: "clasificada" });
      expect(await estadoProspecto(prospecto.id)).toBe("en_revision");

      // registrarRespuesta ya creó otra de seguimiento ("Respuesta tardía",
      // sin responsable) porque este prospecto no tiene envíos: se filtra
      // por quien la creó.
      const seguimientos = await db.select().from(tareas).where(and(eq(tareas.prospectoId, prospecto.id), eq(tareas.tipo, "seguimiento"), eq(tareas.creadaPor, adminId)));
      expect(seguimientos).toHaveLength(1);
      expect(seguimientos[0]!.responsableId).toBe(adminId);
      expect(seguimientos[0]!.creadaPor).toBe(adminId);
      expect(seguimientos[0]!.estado).toBe("pendiente");
      expect(seguimientos[0]!.fechaLimite!.getTime()).toBe(fecha.getTime());
      expect(seguimientos[0]!.descripcion).toBe("llamar después del cierre de mes");
    });

    // Antes solo la clasificación de n8n guardaba su comentario en la
    // respuesta; la manual lo dejaba nada más en la tarea.
    it("el comentario de la clasificación manual queda también en la respuesta, recortado a 500 caracteres", async () => {
      const { respuestaId, tareaId } = await tareaDeRespuestaAmbigua();
      const comentario = `${"a".repeat(499)}😀${"b".repeat(100)}`;

      expect((await clasificarManual(tareaId, { clasificacion: "no_interesado", comentario })).status).toBe(200);

      const [fila] = await db.select({ comentario: respuestas.comentario }).from(respuestas).where(eq(respuestas.id, respuestaId));
      expect(fila!.comentario).toBe(`${"a".repeat(499)}😀`);
    });

    it("el evento a n8n sigue saliendo como aviso, ahora con la respuesta", async () => {
      const { prospecto, respuestaId, tareaId } = await tareaDeRespuestaAmbigua();
      await clasificarManual(tareaId, { clasificacion: "no_interesado" });

      const [evento] = await db.select().from(eventosPendientes).where(and(eq(eventosPendientes.tipo, "prospecto_clasificado"), eq(eventosPendientes.entidadId, prospecto.id)));
      expect((evento!.payload as { respuesta_id: number }).respuesta_id).toBe(respuestaId);
    });

    it("dos clasificaciones simultáneas de la misma tarea: solo una se aplica", async () => {
      const { prospecto, respuestaId, tareaId } = await tareaDeRespuestaAmbigua();
      const [a, b] = await Promise.all([
        clasificarManual(tareaId, { clasificacion: "baja" }),
        clasificarManual(tareaId, { clasificacion: "interesado" })
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const ganadora = a.status === 200 ? "baja" : "interesado";
      expect((await clasificacionRespuesta(respuestaId)).clasificacion).toBe(ganadora);
      expect(await estadoProspecto(prospecto.id)).toBe(ganadora);
      expect(await enSupresion("correo", prospecto.correo)).toBe(ganadora === "baja");
    });
  });

  // PT2 registra cada respuesta con crear_tarea_clasificacion (una tarea en
  // la cola por respuesta). Cuando la IA clasifique directo, esa tarea se
  // quedaba abierta: una persona podía clasificarla después y pisar la
  // decisión de la IA (ej. la IA dijo "baja" y suprimió el contacto; la
  // persona pone "interesado"), y "ambigua" creaba una segunda tarea para
  // la misma respuesta (hallazgo de /code-review, 30-sep-2026).
  describe("la IA y la cola no se pisan", () => {
    async function respuestaConTareaEnCola(prospectoId: number, contenido = "¿cuánto cuesta?") {
      const res = await api()
        .post("/api/v1/automatizacion/respuestas")
        .set("X-API-Key", API_KEY)
        .send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo", contenido, crear_tarea_clasificacion: true });
      expect(res.status).toBe(201);
      return { respuestaId: res.body.id as number, tareaId: res.body.tarea_id as number };
    }

    async function idsEnCola() {
      const cola = await api().get("/api/v1/cola-clasificacion").query({ limit: 100 }).set("Cookie", adminCookie);
      return (cola.body.data as { id: number }[]).map((t) => t.id);
    }

    it("si n8n clasifica una respuesta que tenía tarea en la cola, la tarea se cierra y sale de la cola", async () => {
      const prospecto = await registrarProspecto();
      const { respuestaId, tareaId } = await respuestaConTareaEnCola(prospecto.id);
      expect(await idsEnCola()).toContain(tareaId);

      expect((await clasificarAutomatica(respuestaId, "interesado")).status).toBe(201);

      const [tarea] = await db.select().from(tareas).where(eq(tareas.id, tareaId));
      expect(tarea!.estado).toBe("cerrada");
      expect(tarea!.clasificacion).toBe("interesado");
      expect(tarea!.resultado).toMatch(/n8n/);
      expect(await idsEnCola()).not.toContain(tareaId);
    });

    it("después, una persona ya no puede clasificar esa tarea: 409 con code RESPUESTA_YA_CLASIFICADA", async () => {
      const prospecto = await registrarProspecto({ conTelefono: true });
      const { respuestaId, tareaId } = await respuestaConTareaEnCola(prospecto.id, "ya no me escriban");
      expect((await clasificarAutomatica(respuestaId, "baja")).status).toBe(201);

      const res = await api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "interesado" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RESPUESTA_YA_CLASIFICADA");

      const [fila] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospecto.id));
      expect(fila!.estado).toBe("baja");
    });

    // Caso de datos inconsistentes (la tarea sigue abierta pero la respuesta
    // ya tiene una decisión que no es "ambigua"): la persona no la pisa.
    it("una persona no pisa una respuesta ya clasificada aunque su tarea siga abierta", async () => {
      const prospecto = await registrarProspecto();
      const { respuestaId, tareaId } = await respuestaConTareaEnCola(prospecto.id);
      await db.update(respuestas).set({ estado: "clasificada", clasificacion: "no_interesado" }).where(eq(respuestas.id, respuestaId));

      const res = await api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "interesado" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RESPUESTA_YA_CLASIFICADA");
      const [fila] = await db.select({ clasificacion: respuestas.clasificacion }).from(respuestas).where(eq(respuestas.id, respuestaId));
      expect(fila!.clasificacion).toBe("no_interesado");
    });

    it("n8n tampoco reclasifica una respuesta ya clasificada: 409 con code RESPUESTA_YA_CLASIFICADA", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id);
      expect((await clasificarAutomatica(respuestaId, "no_interesado")).status).toBe(201);

      const res = await clasificarAutomatica(respuestaId, "interesado");
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RESPUESTA_YA_CLASIFICADA");
    });

    it("'ambigua' de una respuesta que ya tiene tarea en la cola reusa esa tarea en vez de crear otra", async () => {
      const prospecto = await registrarProspecto();
      const { respuestaId, tareaId } = await respuestaConTareaEnCola(prospecto.id);

      const res = await clasificarAutomatica(respuestaId, "ambigua");
      expect(res.status).toBe(201);
      expect(res.body.tarea_id).toBe(tareaId);

      const deLaRespuesta = await db.select().from(tareas).where(and(eq(tareas.respuestaId, respuestaId), eq(tareas.tipo, "clasificacion")));
      expect(deLaRespuesta).toHaveLength(1);
      expect(deLaRespuesta[0]!.estado).toBe("pendiente");
    });
  });

  // Un "interesado" solo cambiaba el estado del prospecto: nadie se
  // enteraba. PLAN_CRM_DEFINITIVO.md: la oportunidad la crea el asesor que
  // toma al interesado, así que se deja una tarea sin asignar para que un
  // supervisor la reparta (decisión del 30-sep-2026).
  describe("'interesado' deja una tarea para un vendedor", () => {
    async function tareasDeInteresado(prospectoId: number) {
      return db.select().from(tareas).where(and(eq(tareas.prospectoId, prospectoId), eq(tareas.titulo, "Contactar prospecto interesado")));
    }

    function esperarTareaDeInteresado(tarea: typeof tareas.$inferSelect | undefined, respuestaId: number | null, antes: Date) {
      expect(tarea).toBeDefined();
      expect(tarea!.tipo).toBe("seguimiento");
      expect(tarea!.prioridad).toBe("alta");
      expect(tarea!.estado).toBe("pendiente");
      expect(tarea!.responsableId).toBeNull();
      expect(tarea!.respuestaId).toBe(respuestaId);
      expect(tarea!.empresaId).toEqual(expect.any(Number));
      // Fin del siguiente día hábil en México (ver 215-dia-habil-mx): el
      // valor exacto depende de la hora a la que corra la prueba.
      const limite = tarea!.fechaLimite!.getTime();
      expect(limite).toBeGreaterThan(antes.getTime());
      expect(limite).toBeLessThanOrEqual(antes.getTime() + 4 * 86_400_000);
    }

    it("clasificado por n8n: una tarea 'Contactar prospecto interesado' sin asignar, prioridad alta, con fecha límite", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "sí me interesa, llámenme");
      const antes = new Date();

      expect((await clasificarAutomatica(respuestaId, "interesado")).status).toBe(201);

      const creadas = await tareasDeInteresado(prospecto.id);
      expect(creadas).toHaveLength(1);
      esperarTareaDeInteresado(creadas[0], respuestaId, antes);
      expect(creadas[0]!.descripcion).toMatch(/sí me interesa, llámenme/);
    });

    it("clasificado a mano en la cola: la misma tarea, también sin asignar", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "me interesa la propuesta");
      const tareaId = (await clasificarAutomatica(respuestaId, "ambigua")).body.tarea_id as number;
      const antes = new Date();

      expect((await api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "interesado" })).status).toBe(200);

      const creadas = await tareasDeInteresado(prospecto.id);
      expect(creadas).toHaveLength(1);
      esperarTareaDeInteresado(creadas[0], respuestaId, antes);
      expect(creadas[0]!.descripcion).toMatch(/me interesa la propuesta/);
    });

    it("en una tarea de clasificación creada a mano (sin respuesta) también se crea", async () => {
      const prospecto = await registrarProspecto();
      const adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id as number;
      const creada = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ tipo: "clasificacion", titulo: "Clasificar a mano", responsableId: adminId, prospectoId: prospecto.id });
      const antes = new Date();

      expect((await api().post(`/api/v1/cola-clasificacion/${creada.body.id}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "interesado" })).status).toBe(200);

      const creadas = await tareasDeInteresado(prospecto.id);
      expect(creadas).toHaveLength(1);
      esperarTareaDeInteresado(creadas[0], null, antes);
    });

    it("un reintento de n8n con el mismo execution_id no la duplica", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "interesado");
      const executionId = randomUUID();
      const enviar = () => api().post("/api/v1/automatizacion/respuestas/clasificacion").set("X-API-Key", API_KEY).send({ execution_id: executionId, respuesta_id: respuestaId, clasificacion: "interesado" });

      expect((await enviar()).status).toBe(201);
      const segunda = await enviar();
      expect(segunda.status).toBe(200);
      expect(segunda.body.ya_existia).toBe(true);
      expect(await tareasDeInteresado(prospecto.id)).toHaveLength(1);
    });

    it("las demás clasificaciones no crean esta tarea", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "no gracias");
      expect((await clasificarAutomatica(respuestaId, "no_interesado")).status).toBe(201);
      expect(await tareasDeInteresado(prospecto.id)).toHaveLength(0);
    });
  });

  // Hallazgos del /code-review del 1-oct-2026 (decisiones de Fabián):
  // - una baja cancela las tareas de seguimiento abiertas del prospecto;
  // - "la baja manda": si la persona ya está en baja (p. ej. usó el link de
  //   SendGrid) y tenía una respuesta esperando en la cola, clasificarla
  //   la registra, pero el prospecto sigue en baja y no se crea ninguna
  //   tarea. Antes un "interesado" lo regresaba a interesado y le
  //   asignaba un vendedor.
  describe("la baja manda", () => {
    async function darDeBajaPorLink(correo: string) {
      const res = await api().post("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), tipo: "correo", valor: correo, motivo: "Baja por link de SendGrid", evento: "unsubscribe" });
      expect(res.status).toBe(201);
    }

    async function estadoProspecto(prospectoId: number) {
      const [fila] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId));
      return fila!.estado;
    }

    async function tareasDe(prospectoId: number, titulo: string) {
      return db.select().from(tareas).where(and(eq(tareas.prospectoId, prospectoId), eq(tareas.titulo, titulo)));
    }

    it("una 'baja' de n8n cancela la tarea 'Contactar prospecto interesado' que ya existía", async () => {
      const prospecto = await registrarProspecto();
      expect((await clasificarAutomatica(await registrarRespuesta(prospecto.id, "me interesa"), "interesado")).status).toBe(201);
      expect((await clasificarAutomatica(await registrarRespuesta(prospecto.id, "mejor ya no"), "baja")).status).toBe(201);

      const [contactar] = await tareasDe(prospecto.id, "Contactar prospecto interesado");
      expect(contactar!.estado).toBe("cancelada");
      expect(contactar!.resultado).toBe("Cancelada: el prospecto pidió la baja");
    });

    it("una 'baja' manual en la cola también la cancela", async () => {
      const prospecto = await registrarProspecto();
      expect((await clasificarAutomatica(await registrarRespuesta(prospecto.id, "me interesa"), "interesado")).status).toBe(201);
      const tareaId = (await clasificarAutomatica(await registrarRespuesta(prospecto.id, "mmm"), "ambigua")).body.tarea_id as number;

      expect((await api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "baja" })).status).toBe(200);

      const [contactar] = await tareasDe(prospecto.id, "Contactar prospecto interesado");
      expect(contactar!.estado).toBe("cancelada");
    });

    it("persona en baja con una respuesta en la cola: clasificarla 'interesado' la registra, pero el prospecto sigue en baja y no hay tarea de vendedor", async () => {
      const prospecto = await registrarProspecto();
      const tareaId = (await clasificarAutomatica(await registrarRespuesta(prospecto.id, "sí me interesa"), "ambigua")).body.tarea_id as number;
      await darDeBajaPorLink(prospecto.correo);

      // La tarea de la cola sigue ahí para que alguien lea lo que contestó.
      const [enCola] = await db.select({ estado: tareas.estado }).from(tareas).where(eq(tareas.id, tareaId));
      expect(enCola!.estado).toBe("pendiente");

      const res = await api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "interesado" });
      expect(res.status).toBe(200);

      const deLaTarea = await db.select({ respuestaId: tareas.respuestaId }).from(tareas).where(eq(tareas.id, tareaId));
      const [clasificada] = await db.select({ clasificacion: respuestas.clasificacion }).from(respuestas).where(eq(respuestas.id, deLaTarea[0]!.respuestaId!));
      expect(clasificada!.clasificacion).toBe("interesado");
      expect(await estadoProspecto(prospecto.id)).toBe("baja");
      expect(await tareasDe(prospecto.id, "Contactar prospecto interesado")).toHaveLength(0);
    });

    it("persona en baja: 'reagendar' tampoco crea el seguimiento", async () => {
      const prospecto = await registrarProspecto();
      const tareaId = (await clasificarAutomatica(await registrarRespuesta(prospecto.id, "luego"), "ambigua")).body.tarea_id as number;
      await darDeBajaPorLink(prospecto.correo);

      const fecha = new Date(Date.now() + 7 * 86_400_000).toISOString();
      expect((await api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "reagendar", fechaSeguimiento: fecha })).status).toBe(200);
      expect(await tareasDe(prospecto.id, "Seguimiento reagendado")).toHaveLength(0);
      expect(await estadoProspecto(prospecto.id)).toBe("baja");
    });

    it("persona en baja: un 'ambigua' de n8n no la manda a la cola ni la pasa a en_revision", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "¿?");
      await darDeBajaPorLink(prospecto.correo);

      const res = await clasificarAutomatica(respuestaId, "ambigua");
      expect(res.status).toBe(201);
      expect(res.body.tarea_id).toBeNull();
      expect(await estadoProspecto(prospecto.id)).toBe("baja");
      expect(await db.select().from(tareas).where(and(eq(tareas.respuestaId, respuestaId), eq(tareas.tipo, "clasificacion")))).toHaveLength(0);
    });
  });

  // El Historial de la ficha de cliente (GET /actividades) solo mostraba los
  // cambios de estado hechos por POST /automatizacion/prospectos/estado: una
  // clasificación cambiaba el estado del prospecto sin dejar ese rastro
  // (hallazgo de /code-review, 25-sep-2026).
  describe("Historial de la ficha de cliente", () => {
    async function historial(contactoId: number) {
      const [contacto] = await db.select({ empresaId: contactos.empresaId }).from(contactos).where(eq(contactos.id, contactoId));
      const res = await api().get("/api/v1/actividades").set("Cookie", adminCookie).query({ empresaId: contacto!.empresaId, limit: 100 });
      expect(res.status).toBe(200);
      return res.body.data as { tipo: string; resultado: string | null; responsable_id: number | null; detalle: { motivo: string | null } }[];
    }

    it("una clasificación manual aparece como cambio de estado del prospecto, con quién la hizo", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "mmm, no sé");
      const tareaId = (await clasificarAutomatica(respuestaId, "ambigua")).body.tarea_id as number;
      const adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id as number;

      await api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "no_interesado" });

      const cambios = (await historial(prospecto.contactoId)).filter((e) => e.tipo === "cambio_estado_prospecto");
      const manual = cambios.find((e) => e.resultado === "no_interesado");
      expect(manual).toBeDefined();
      expect(manual!.responsable_id).toBe(adminId);
      expect(manual!.detalle.motivo).toMatch(/no_interesado/);
      // La "ambigua" de n8n también dejó su rastro (en_revision).
      expect(cambios.some((e) => e.resultado === "en_revision" && e.responsable_id === null)).toBe(true);
    });

    it("una 'baja' de n8n aparece como cambio de estado a 'baja'", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id, "ya no me escriban");
      await clasificarAutomatica(respuestaId, "baja");

      const cambios = (await historial(prospecto.contactoId)).filter((e) => e.tipo === "cambio_estado_prospecto");
      expect(cambios.some((e) => e.resultado === "baja")).toBe(true);
    });
  });
});
