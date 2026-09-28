import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

type Lote = { lote_id: string; fuente: string; total: number; resumen: Record<string, number> };

describe("GET /prospectos/importaciones (lotes de importación)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agente1Cookie: string[];
  let agente2Cookie: string[];
  const sufijo = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agente1Cookie = await crearAgente(app, adminCookie, `lotes.agente1.${sufijo}@test.local`);
    agente2Cookie = await crearAgente(app, adminCookie, `lotes.agente2.${sufijo}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const ENCABEZADO = "empresaNombreLegal,contactoNombre,correo,canalInicial";

  async function importar(cookie: string[], nombreArchivo: string, filas: string[]) {
    const res = await request(app.getHttpServer())
      .post("/api/v1/prospectos/importaciones")
      .set("Cookie", cookie)
      .attach("archivo", Buffer.from([ENCABEZADO, ...filas].join("\n")), nombreArchivo);
    expect(res.status).toBe(201);
    return res.body as { lote_id: string; resumen: Record<string, number> };
  }

  async function lotes(cookie: string[]) {
    const res = await request(app.getHttpServer()).get("/api/v1/prospectos/importaciones").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.data as Lote[];
  }

  it("resume cada lote por estado, más reciente primero; un agente solo ve los suyos y las altas manuales no cuentan como lote", async () => {
    const lote1 = await importar(agente1Cookie, `agente1-${sufijo}.csv`, [
      `Empresa Lotes A ${sufijo},Contacto A,a.${sufijo}@test.local,correo`,
      `Empresa Lotes B ${sufijo},Contacto B,b.${sufijo}@test.local,correo`,
      // Duplicado de la fila 2 dentro del mismo archivo.
      `Empresa Lotes C ${sufijo},Contacto C,a.${sufijo}@test.local,correo`,
      // Sin correo ni teléfono: no pasa validación.
      `Empresa Lotes D ${sufijo},Contacto D,,correo`
    ]);
    const lote2 = await importar(agente2Cookie, `agente2-${sufijo}.csv`, [`Empresa Lotes E ${sufijo},Contacto E,e.${sufijo}@test.local,correo`]);

    // Alta manual del agente 1: también es un lote interno (fuente "manual"), pero no una importación.
    const manual = await request(app.getHttpServer())
      .post("/api/v1/prospectos")
      .set("Cookie", agente1Cookie)
      .send({ empresaNombreLegal: `Empresa Manual ${sufijo}`, contactoNombre: "Contacto Manual", correo: `manual.${sufijo}@test.local`, canalInicial: "correo" });
    expect(manual.status).toBe(201);

    const delAgente1 = await lotes(agente1Cookie);
    expect(delAgente1.map((l) => l.lote_id)).toEqual([lote1.lote_id]);
    const [resumen1] = delAgente1;
    expect(resumen1).toMatchObject({ fuente: `agente1-${sufijo}.csv`, total: 4 });
    // Mismos conteos que devolvió la importación.
    expect(resumen1!.resumen).toMatchObject(lote1.resumen);
    expect(resumen1!.resumen).toMatchObject({ pendiente_revision: 2, duplicado: 1, rechazado: 1, importado: 0, expirado: 0 });

    const deAdmin = await lotes(adminCookie);
    const posicion = (id: string) => deAdmin.findIndex((l) => l.lote_id === id);
    expect(posicion(lote2.lote_id)).toBeGreaterThanOrEqual(0);
    expect(posicion(lote2.lote_id)).toBeLessThan(posicion(lote1.lote_id));
    expect(deAdmin.some((l) => l.fuente === "manual")).toBe(false);
  });

  it("el resumen refleja las filas ya confirmadas o rechazadas", async () => {
    const lote = await importar(agente1Cookie, `confirmar-${sufijo}.csv`, [
      `Empresa Lotes F ${sufijo},Contacto F,f.${sufijo}@test.local,correo`,
      `Empresa Lotes G ${sufijo},Contacto G,g.${sufijo}@test.local,correo`
    ]);
    const detalle = await request(app.getHttpServer()).get(`/api/v1/prospectos/importaciones/${lote.lote_id}`).set("Cookie", agente1Cookie);
    const [primera, segunda] = detalle.body.filas as { id: number }[];

    const confirmar = await request(app.getHttpServer()).post(`/api/v1/prospectos/importaciones/${lote.lote_id}/filas/${primera!.id}/confirmar`).set("Cookie", agente1Cookie).send({});
    expect(confirmar.status).toBe(200);
    const rechazar = await request(app.getHttpServer()).post(`/api/v1/prospectos/importaciones/${lote.lote_id}/filas/${segunda!.id}/rechazar`).set("Cookie", agente1Cookie);
    expect(rechazar.status).toBe(204);

    const resumen = (await lotes(agente1Cookie)).find((l) => l.lote_id === lote.lote_id);
    expect(resumen?.resumen).toMatchObject({ pendiente_revision: 0, importado: 1, rechazado: 1 });
  });
});
