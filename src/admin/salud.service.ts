import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { envios, eventosPendientes } from "../database/schema.js";
import { env } from "../config/env.js";
import { diaSiguiente, fechaMx, inicioDelDiaMxSql } from "../shared/dia-habil.js";
import { ProblemasService } from "./problemas.service.js";

// "Estado del sistema" de Administración (12-oct-2026; puntos 38 y 54). Solo
// lo que de verdad sabemos medir: no hay tiempo en línea, ni entregabilidad
// de SendGrid (necesitaría su Event Webhook), así que no se prometen.
// - API: la revisión que corre (Cloud Run pone K_REVISION). Cuánto tarda en
//   contestar lo mide la pantalla.
// - Base de datos: cuánto tarda un SELECT 1. El respaldo diario es
//   configuración de Cloud SQL: lo dice la pantalla como texto fijo.
// - Avisos a n8n: cuántos esperan, cuántos fallaron y si hay a dónde mandarlos.
// - Correos: cuántos van hoy (día de México) y cuándo salió el último.

@Injectable()
export class SaludService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly problemasService: ProblemasService
  ) {}

  async estado() {
    const inicio = performance.now();
    let baseDatos: { estado: "ok" | "error"; responde_ms: number | null };
    try {
      await this.db.execute(sql`SELECT 1`);
      baseDatos = { estado: "ok", responde_ms: Math.round(performance.now() - inicio) };
    } catch {
      // Sin base no hay nada más que contar.
      return {
        revisado_en: new Date().toISOString(),
        api: this.api(),
        base_datos: { estado: "error" as const, responde_ms: null },
        avisos_n8n: null,
        correos: null,
        por_configurar: this.porConfigurar(),
        resumen: null
      };
    }

    const hoy = fechaMx(new Date());
    const [[espera], [fallidos], [correos], grupos] = await Promise.all([
      this.db.select({ n: sql<number>`COUNT(*)` }).from(eventosPendientes).where(eq(eventosPendientes.estado, "pendiente")),
      this.db.select({ n: sql<number>`COUNT(*)` }).from(eventosPendientes).where(eq(eventosPendientes.estado, "fallido")),
      this.db.select({ n: sql<number>`COUNT(*)`, ultimo: sql<Date | string | null>`MAX(${envios.enviadoEn})` }).from(envios)
        .where(and(sql`${envios.enviadoEn} >= ${inicioDelDiaMxSql(hoy)}`, sql`${envios.enviadoEn} < ${inicioDelDiaMxSql(diaSiguiente(hoy))}`)),
      this.problemasService.grupos()
    ]);
    const configurado = Boolean(env.N8N_WEBHOOK_URL);
    const enEspera = Number(espera?.n ?? 0);
    const conFallas = Number(fallidos?.n ?? 0);
    const porConfigurar = this.porConfigurar();

    return {
      revisado_en: new Date().toISOString(),
      api: this.api(),
      base_datos: baseDatos,
      avisos_n8n: { estado: configurado && conFallas === 0 ? "ok" : "atencion", configurado, en_espera: enEspera, fallidos: conFallas },
      correos: { enviados_hoy: Number(correos?.n ?? 0), ultimo_envio_en: aIso(correos?.ultimo ?? null) },
      por_configurar: porConfigurar,
      resumen: { por_configurar: porConfigurar.length, problemas_abiertos: grupos.length }
    };
  }

  private api() {
    return { estado: "ok" as const, revision: process.env.K_REVISION ?? null };
  }

  private porConfigurar() {
    const pendientes: { clave: string; texto: string }[] = [];
    if (!env.N8N_WEBHOOK_URL) pendientes.push({ clave: "N8N_WEBHOOK_URL", texto: "Falta la dirección de n8n (N8N_WEBHOOK_URL): los avisos esperan sin salir." });
    return pendientes;
  }
}

// MAX() de un DATETIME llega como texto "AAAA-MM-DD HH:MM:SS" (UTC).
function aIso(valor: Date | string | null) {
  if (valor == null) return null;
  if (valor instanceof Date) return valor.toISOString();
  return new Date(`${valor.replace(" ", "T")}Z`).toISOString();
}
