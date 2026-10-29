import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { actividades, auditoria, borradoresCaptura, contactos, cotizaciones, documentos, empresas, mediosContacto, notificaciones, oportunidades, prospectos, tareas, usoIa } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import type { CurrentUser } from "../auth/current-user.type.js";

// Fusionar dos empresas repetidas (control G-05, 28-oct-2026). Solo
// administrador. Todo lo de la empresa ORIGEN (la repetida) pasa a la DESTINO
// (la que se queda): contactos con sus medios y prospectos, oportunidades,
// cotizaciones, documentos, actividades, tareas y resúmenes. La destino
// completa los datos que le falten con los de la origen, y la origen queda
// desactivada (no se borra) con la fusión en la bitácora. Nada de esto cambia
// la identidad de las personas: los medios siguen siendo de las mismas.

// Datos de la empresa que la destino toma de la origen si los tiene vacíos.
const COMPLETABLES = ["nombreComercial", "giro", "tamano", "region", "estado", "ciudad", "sitioWeb", "linkedinUrl", "facebookUrl", "instagramUrl", "propietarioId"] as const;

type Empresa = typeof empresas.$inferSelect;

@Injectable()
export class FusionEmpresasService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async fusionar(user: CurrentUser, origenId: number, destinoId: number, simular: boolean) {
    if (origenId === destinoId) throw new HttpError(400, "Elige otra empresa: una empresa no se fusiona consigo misma");
    return this.db.transaction(async (tx) => {
      // Las dos bloqueadas, siempre en el mismo orden (por id) para no trabarse con otra fusión.
      const filas = await tx.select().from(empresas).where(inArray(empresas.id, [origenId, destinoId])).orderBy(asc(empresas.id)).for("update");
      const origen = filas.find((e) => e.id === origenId);
      const destino = filas.find((e) => e.id === destinoId);
      if (!origen || !origen.activo) throw new HttpError(404, "Empresa no encontrada");
      if (!destino || !destino.activo) throw new HttpError(404, "La empresa en la que se fusiona no existe o está desactivada");

      const mover = await this.conteos(tx, origenId);
      const completar = COMPLETABLES.filter((campo) => (destino[campo] === null || destino[campo] === "") && origen[campo] !== null && origen[campo] !== "");
      const resumen = {
        origen: { id: origen.id, nombre: origen.nombreComercial ?? origen.nombreLegal },
        destino: { id: destino.id, nombre: destino.nombreComercial ?? destino.nombreLegal },
        mover,
        completar: completar.map(nombreDeCampo)
      };
      if (simular) return { ...resumen, fusionada: false };

      const contactoIds = (await tx.select({ id: contactos.id }).from(contactos).where(eq(contactos.empresaId, origenId))).map((c) => c.id);
      await tx.update(contactos).set({ empresaId: destinoId }).where(eq(contactos.empresaId, origenId));
      await tx.update(mediosContacto).set({ empresaId: destinoId }).where(eq(mediosContacto.empresaId, origenId));
      await tx.update(oportunidades).set({ empresaId: destinoId }).where(eq(oportunidades.empresaId, origenId));
      await tx.update(cotizaciones).set({ empresaId: destinoId }).where(eq(cotizaciones.empresaId, origenId));
      await tx.update(documentos).set({ empresaId: destinoId }).where(eq(documentos.empresaId, origenId));
      await tx.update(actividades).set({ empresaId: destinoId }).where(eq(actividades.empresaId, origenId));
      await tx.update(tareas).set({ empresaId: destinoId }).where(eq(tareas.empresaId, origenId));
      await tx.update(usoIa).set({ empresaId: destinoId }).where(eq(usoIa.empresaId, origenId));
      await tx.update(borradoresCaptura).set({ empresaId: destinoId }).where(eq(borradoresCaptura.empresaId, origenId));
      await tx.update(notificaciones).set({ entidadId: destinoId }).where(and(eq(notificaciones.entidad, "empresa"), eq(notificaciones.entidadId, origenId)));

      if (completar.length) {
        const cambios: Partial<Empresa> = {};
        for (const campo of completar) (cambios as Record<string, unknown>)[campo] = origen[campo];
        await tx.update(empresas).set(cambios).where(eq(empresas.id, destinoId));
      }
      await tx.update(empresas).set({ activo: false }).where(eq(empresas.id, origenId));

      await tx.insert(auditoria).values([
        { usuarioId: user.id, entidad: "empresa", entidadId: origenId, accion: "fusionar", antes: { activo: true, nombre_legal: origen.nombreLegal }, despues: { activo: false, fusionada_en: destinoId, contactos: contactoIds, movidos: mover } },
        { usuarioId: user.id, entidad: "empresa", entidadId: destinoId, accion: "recibir_fusion", antes: { completados: Object.fromEntries(completar.map((c) => [c, destino[c]])) }, despues: { desde: origenId, completados: Object.fromEntries(completar.map((c) => [c, origen[c]])), movidos: mover } }
      ]);
      return { ...resumen, fusionada: true };
    });
  }

  private async conteos(tx: DrizzleTx, empresaId: number) {
    const n = async (consulta: Promise<{ n: number }[]>) => Number((await consulta)[0]?.n ?? 0);
    const contactoIds = (await tx.select({ id: contactos.id }).from(contactos).where(eq(contactos.empresaId, empresaId))).map((c) => c.id);
    return {
      contactos: contactoIds.length,
      prospectos: contactoIds.length ? await n(tx.select({ n: count() }).from(prospectos).where(inArray(prospectos.contactoId, contactoIds))) : 0,
      medios_de_empresa: await n(tx.select({ n: count() }).from(mediosContacto).where(eq(mediosContacto.empresaId, empresaId))),
      oportunidades: await n(tx.select({ n: count() }).from(oportunidades).where(eq(oportunidades.empresaId, empresaId))),
      cotizaciones: await n(tx.select({ n: count() }).from(cotizaciones).where(eq(cotizaciones.empresaId, empresaId))),
      documentos: await n(tx.select({ n: count() }).from(documentos).where(eq(documentos.empresaId, empresaId))),
      actividades: await n(tx.select({ n: count() }).from(actividades).where(eq(actividades.empresaId, empresaId))),
      tareas: await n(tx.select({ n: count() }).from(tareas).where(eq(tareas.empresaId, empresaId)))
    };
  }
}

function nombreDeCampo(campo: (typeof COMPLETABLES)[number]) {
  return { nombreComercial: "nombre comercial", giro: "giro", tamano: "tamaño", region: "región", estado: "estado", ciudad: "ciudad", sitioWeb: "sitio web", linkedinUrl: "LinkedIn", facebookUrl: "Facebook", instagramUrl: "Instagram", propietarioId: "responsable" }[campo];
}
