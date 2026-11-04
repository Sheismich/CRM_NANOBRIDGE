import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { desc, eq, inArray } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { procesosFallidos } from "../database/schema.js";
import { TIPO_ERROR_WORKFLOW } from "../automatizacion/automatizacion.service.js";
import { ProcesosFallidosService } from "../procesos-fallidos/procesos-fallidos.service.js";
import { HttpError } from "../shared/http-error.js";
import type { CurrentUser } from "../auth/current-user.type.js";

// "Problemas abiertos agrupados por causa" de Administración: junta los
// procesos fallidos para resolver de una vez los de la misma causa.
// - workflow_n8n: una falla que avisó el Error Workflow, por workflow + nodo.
// - aviso_api: filas viejas del outbox retirado (tienen evento_id), por error.
// - otro: cualquier otro proceso fallido, por tipo + error.
// Todos solo se marcan resueltos: el arreglo es en n8n.
// Cada grupo lleva una clave estable (la causa en hash) para que la pantalla
// no mande la lista de ids; se actúa sobre lo que siga abierto en ese momento.

type TipoGrupo = "aviso_api" | "workflow_n8n" | "otro";
type EstadoProblema = "abierto" | "en_revision" | "resuelto";

export interface GrupoProblemas {
  clave: string;
  tipo: TipoGrupo;
  cantidad: number;
  mensaje: string;
  workflow: string | null;
  nodo: string | null;
  tipos_evento: { tipo: string; cantidad: number }[];
  desde: Date;
  hasta: Date;
}

type Fila = typeof procesosFallidos.$inferSelect;

function hash(texto: string) {
  return createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

function causa(fila: Fila): { clave: string; tipo: TipoGrupo } {
  if (fila.eventoId != null) return { clave: `aviso:${hash(fila.mensaje)}`, tipo: "aviso_api" };
  if (fila.tipo === TIPO_ERROR_WORKFLOW) return { clave: `n8n:${hash(`${fila.workflow ?? ""}|${fila.nodo ?? ""}`)}`, tipo: "workflow_n8n" };
  return { clave: `otro:${hash(`${fila.tipo}|${fila.mensaje}`)}`, tipo: "otro" };
}

const ABIERTOS: EstadoProblema[] = ["abierto", "en_revision"];

@Injectable()
export class ProblemasService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly procesosFallidosService: ProcesosFallidosService
  ) {}

  private filas(estados: EstadoProblema[]) {
    return this.db.select().from(procesosFallidos).where(inArray(procesosFallidos.estado, estados)).orderBy(desc(procesosFallidos.creadoEn), desc(procesosFallidos.id));
  }

  /** Por omisión, lo que sigue abierto (abierto y en revisión). Lo más reciente primero. */
  async grupos(estado?: EstadoProblema): Promise<GrupoProblemas[]> {
    const filas = await this.filas(estado ? [estado] : ABIERTOS);
    const porClave = new Map<string, { grupo: GrupoProblemas; tipos: Map<string, number> }>();
    // Las filas vienen de la más nueva a la más vieja: la primera de cada
    // grupo pone el mensaje (el último error) y "hasta".
    for (const fila of filas) {
      const { clave, tipo } = causa(fila);
      let entrada = porClave.get(clave);
      if (!entrada) {
        entrada = {
          grupo: {
            clave,
            tipo,
            cantidad: 0,
            mensaje: fila.mensaje,
            workflow: fila.workflow,
            nodo: fila.nodo,
            tipos_evento: [],
            desde: fila.creadoEn,
            hasta: fila.creadoEn
          },
          tipos: new Map()
        };
        porClave.set(clave, entrada);
      }
      entrada.grupo.cantidad++;
      entrada.grupo.desde = fila.creadoEn;
      if (tipo === "aviso_api") entrada.tipos.set(fila.tipo, (entrada.tipos.get(fila.tipo) ?? 0) + 1);
    }
    return [...porClave.values()].map(({ grupo, tipos }) => ({
      ...grupo,
      tipos_evento: [...tipos.entries()].map(([t, cantidad]) => ({ tipo: t, cantidad })).sort((a, b) => b.cantidad - a.cantidad || a.tipo.localeCompare(b.tipo))
    }));
  }

  private async miembros(clave: string) {
    const filas = (await this.filas(ABIERTOS)).filter((fila) => causa(fila).clave === clave);
    if (filas.length === 0) throw new HttpError(404, "Ya no hay problemas abiertos con esa causa");
    return filas;
  }

  // "Marcar resueltos": cualquier grupo. Cada fila auditada.
  async resolver(actor: CurrentUser, clave: string) {
    const filas = await this.miembros(clave);
    let resueltos = 0;
    await this.db.transaction(async (tx) => {
      for (const fila of filas) {
        const [proceso] = await tx.select({ id: procesosFallidos.id, estado: procesosFallidos.estado }).from(procesosFallidos).where(eq(procesosFallidos.id, fila.id)).limit(1).for("update");
        if (!proceso || !ABIERTOS.includes(proceso.estado)) continue;
        await this.procesosFallidosService.cambiarEstadoProcesoEnTx(tx, actor, proceso, "resuelto");
        resueltos++;
      }
    });
    return { resueltos };
  }
}
