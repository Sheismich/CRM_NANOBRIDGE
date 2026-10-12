import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { desc, eq, inArray } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { eventosPendientes, procesosFallidos } from "../database/schema.js";
import { TIPO_ERROR_WORKFLOW } from "../automatizacion/automatizacion.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { env } from "../config/env.js";
import { HttpError } from "../shared/http-error.js";
import type { CurrentUser } from "../auth/current-user.type.js";

// "Problemas abiertos agrupados por causa" de Administración (12-oct-2026;
// punto 39). Hoy se reintenta y se resuelve uno por uno; la pantalla los
// junta para actuar sobre todos los de la misma causa:
// - aviso_api: un aviso de la API a n8n (evento del outbox) que agotó sus
//   reintentos -- deja su proceso fallido con evento_id. Se agrupan por el
//   mismo error. Se pueden reintentar (vuelven a la cola) o marcar resueltos.
// - workflow_n8n: una falla dentro de un workflow de n8n que avisó el Error
//   Workflow (B4). Se agrupan por workflow + nodo. SOLO se marcan resueltas:
//   aquí no hay nada que reintentar, el arreglo es en n8n (Fabián, 12-oct).
// - otro: cualquier otro proceso fallido sin evento (no debería haber), por
//   tipo + error, solo para resolver.
// Cada grupo lleva una clave estable (la causa en hash) para que la
// pantalla diga "reintentar los de esta causa" sin mandar la lista de ids;
// se actúa sobre lo que siga abierto con esa causa en ese momento.

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
  acciones: ("reintentar" | "resolver")[];
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
    private readonly outboxService: OutboxService
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
            hasta: fila.creadoEn,
            acciones: tipo === "aviso_api" ? ["reintentar", "resolver"] : ["resolver"]
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
    return { filas, tipo: causa(filas[0]!).tipo };
  }

  // "Reintentar todos": solo avisos de la API. Cada evento que siga fallido
  // vuelve a la cola igual que con el botón de uno (OutboxService), y su
  // problema se cierra; todo en una transacción y cada fila auditada.
  async reintentar(actor: CurrentUser, clave: string) {
    const { filas, tipo } = await this.miembros(clave);
    if (tipo !== "aviso_api") {
      throw new HttpError(409, "Las fallas de un workflow de n8n no se reintentan desde aquí: se arreglan en n8n y se marcan resueltas");
    }
    let reintentados = 0;
    await this.db.transaction(async (tx) => {
      for (const fila of filas) {
        const [proceso] = await tx.select({ id: procesosFallidos.id, estado: procesosFallidos.estado }).from(procesosFallidos).where(eq(procesosFallidos.id, fila.id)).limit(1).for("update");
        if (!proceso || !ABIERTOS.includes(proceso.estado)) continue;
        const [evento] = await tx.select().from(eventosPendientes).where(eq(eventosPendientes.id, fila.eventoId!)).limit(1).for("update");
        if (evento?.estado === "fallido") {
          await this.outboxService.reintentarEnTx(tx, actor, evento);
          reintentados++;
        }
        await this.outboxService.cambiarEstadoProcesoEnTx(tx, actor, proceso, "resuelto");
      }
    });
    // Igual que "Despachar ahora": sin dirección de n8n quedan esperando.
    return env.N8N_WEBHOOK_URL ? { reintentados, resueltos: filas.length } : { reintentados, resueltos: filas.length, sin_destino: true };
  }

  // "Marcar resueltos": cualquier grupo. Cada fila auditada.
  async resolver(actor: CurrentUser, clave: string) {
    const { filas } = await this.miembros(clave);
    let resueltos = 0;
    await this.db.transaction(async (tx) => {
      for (const fila of filas) {
        const [proceso] = await tx.select({ id: procesosFallidos.id, estado: procesosFallidos.estado }).from(procesosFallidos).where(eq(procesosFallidos.id, fila.id)).limit(1).for("update");
        if (!proceso || !ABIERTOS.includes(proceso.estado)) continue;
        await this.outboxService.cambiarEstadoProcesoEnTx(tx, actor, proceso, "resuelto");
        resueltos++;
      }
    });
    return { resueltos };
  }
}
