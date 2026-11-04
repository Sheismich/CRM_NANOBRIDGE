import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, procesosFallidos } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import type { CurrentUser } from "../auth/current-user.type.js";

type EstadoProceso = "abierto" | "en_revision" | "resuelto";

// Revisión de las fallas que reporta el Error Workflow de n8n. Cambiar el
// estado no reintenta nada: el arreglo es en n8n.
@Injectable()
export class ProcesosFallidosService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async listar(estado: EstadoProceso | undefined, tipo: string | undefined, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const conditions = compactConditions([
      estado !== undefined ? eq(procesosFallidos.estado, estado) : undefined,
      tipo !== undefined ? eq(procesosFallidos.tipo, tipo) : undefined
    ]);

    const rows = await this.db
      .select()
      .from(procesosFallidos)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(procesosFallidos.creadoEn))
      .limit(limit)
      .offset(offset);

    return {
      page,
      limit,
      data: rows.map((row) => ({
        id: row.id,
        evento_id: row.eventoId,
        execution_id: row.executionId,
        workflow: row.workflow,
        nodo: row.nodo,
        endpoint: row.endpoint,
        codigo_http: row.codigoHttp,
        tipo: row.tipo,
        payload: row.payload,
        mensaje: row.mensaje,
        estado: row.estado,
        creado_en: row.creadoEn,
        actualizado_en: row.actualizadoEn
      }))
    };
  }

  async actualizarEstado(actor: CurrentUser, id: number, estado: EstadoProceso) {
    await this.db.transaction(async (tx) => {
      const [proceso] = await tx.select({ id: procesosFallidos.id, estado: procesosFallidos.estado }).from(procesosFallidos).where(eq(procesosFallidos.id, id)).limit(1).for("update");
      if (!proceso) throw new HttpError(404, "Proceso fallido no encontrado");

      await this.cambiarEstadoProcesoEnTx(tx, actor, proceso, estado);
    });
  }

  // También lo usa "Marcar resueltos" por grupo. El proceso ya viene bloqueado.
  async cambiarEstadoProcesoEnTx(tx: DrizzleTx, actor: CurrentUser, proceso: { id: number; estado: string }, estado: EstadoProceso) {
    await tx.update(procesosFallidos).set({ estado }).where(eq(procesosFallidos.id, proceso.id));

    await tx.insert(auditoria).values({
      usuarioId: actor.id,
      entidad: "proceso_fallido",
      entidadId: proceso.id,
      accion: "cambiar_estado",
      antes: { estado: proceso.estado },
      despues: { estado }
    });
  }
}
