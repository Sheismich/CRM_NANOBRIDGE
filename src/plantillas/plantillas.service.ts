import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, campanas, parametrosAutomatizacion, plantillasCorreo, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { armarCorreo, enlacesInvalidos, VARIABLES_PLANTILLA, variablesDesconocidas, type DatosPlantilla } from "../shared/plantillas.js";
import { URL_BAJA_EJEMPLO } from "../shared/link-baja.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { CLAVE_PIE_CORREO, datosDelProspecto, leerPie } from "./plantillas.correo.js";
import type { EditarPieInput, EditarPlantillaInput, VistaPreviaInput } from "./dto/plantilla.schema.js";

export const CODIGO_PLANTILLA_VARIABLE_DESCONOCIDA = "PLANTILLA_VARIABLE_DESCONOCIDA";
export const CODIGO_PLANTILLA_ENLACE_INVALIDO = "PLANTILLA_ENLACE_INVALIDO";

export const NOMBRES_PLANTILLA: Record<number, string> = { 1: "Correo 1", 2: "Recordatorio 1", 3: "Recordatorio 2" };

// Datos de la vista previa cuando no se elige un prospecto.
const DATOS_EJEMPLO: DatosPlantilla = { nombre: "Daniela Torres", empresa: "Moldes del Bajío", giro: "Manufactura" };

function exigirVariablesConocidas(...textos: string[]) {
  const desconocidas = [...new Set(textos.flatMap(variablesDesconocidas))];
  if (desconocidas.length > 0) {
    const lista = desconocidas.map((v) => `{{${v}}}`).join(", ");
    throw new HttpError(400, `No existe la variable ${lista}. Usa solo: ${VARIABLES_PLANTILLA.map((v) => `{{${v.clave}}}`).join(", ")}`, CODIGO_PLANTILLA_VARIABLE_DESCONOCIDA);
  }
}

// Solo http(s): un enlace a "www.…" o a un archivo suelto no abre en el correo.
function exigirEnlacesValidos(...textos: string[]) {
  const malos = [...new Set(textos.flatMap(enlacesInvalidos))];
  if (malos.length > 0) {
    throw new HttpError(400, `El enlace «${malos.join("», «")}» no es válido: la dirección debe empezar con https://`, CODIGO_PLANTILLA_ENLACE_INVALIDO);
  }
}

// Correos de prospección editables (etapa 1 de las mejoras, 19-oct-2026).
// Los cambian administrador y supervisor; cada cambio queda en auditoria
// con antes y después (Registro de cambios, filtro "configuración"). Las 3
// generales (campana_id NULL, giro '') y, desde el 9-nov-2026, las propias
// de cada campaña; n8n las recibe ya armadas en POST /automatizacion/envios
// (plantillas.correo.ts).
@Injectable()
export class PlantillasService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // Sin campaña: las 3 generales. Con campaña (9-nov-2026): los 3 que se
  // usarían en ella, el propio si lo tiene y si no el general (origen dice
  // cuál es cuál). Las de giro no salen: no hay pantalla para ellas.
  async listar(campanaId?: number) {
    const campana = campanaId === undefined ? null : await this.campana(this.db, campanaId);
    const filas = await this.db
      .select({ plantilla: plantillasCorreo, autor: usuarios.nombre })
      .from(plantillasCorreo)
      .leftJoin(usuarios, eq(usuarios.id, plantillasCorreo.actualizadoPor))
      .where(and(eq(plantillasCorreo.giro, ""), campana ? or(isNull(plantillasCorreo.campanaId), eq(plantillasCorreo.campanaId, campana.id)) : isNull(plantillasCorreo.campanaId)))
      .orderBy(asc(plantillasCorreo.numero));
    const porNumero = new Map<number, (typeof filas)[number]>();
    for (const f of filas) {
      if (!porNumero.has(f.plantilla.numero) || f.plantilla.campanaId != null) porNumero.set(f.plantilla.numero, f);
    }
    const [pie] = await this.db.select().from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_PIE_CORREO)).limit(1);
    return {
      campana,
      plantillas: [...porNumero.values()].map((f) => this.toRow(f.plantilla, f.autor)),
      pie: { texto: typeof pie?.valor === "string" ? pie.valor : "", actualizado_en: pie?.actualizadoEn ?? null },
      variables: VARIABLES_PLANTILLA
    };
  }

  private async campana(db: DrizzleDb | DrizzleTx, id: number) {
    const [c] = await db.select({ id: campanas.id, nombre: campanas.nombre }).from(campanas).where(eq(campanas.id, id)).limit(1);
    if (!c) throw new HttpError(404, "Campaña no encontrada");
    return c;
  }

  private toRow(p: typeof plantillasCorreo.$inferSelect, autor: string | null) {
    return {
      id: p.id,
      campana_id: p.campanaId,
      origen: p.campanaId != null ? "campana" as const : "general" as const,
      giro: p.giro,
      numero: p.numero,
      nombre: NOMBRES_PLANTILLA[p.numero] ?? `Correo ${p.numero}`,
      asunto: p.asunto,
      cuerpo: p.cuerpo,
      actualizado_por: p.actualizadoPor != null ? { id: p.actualizadoPor, nombre: autor ?? "" } : null,
      actualizado_en: p.actualizadoEn
    };
  }

  private async fila(id: number) {
    const [fila] = await this.db
      .select({ plantilla: plantillasCorreo, autor: usuarios.nombre })
      .from(plantillasCorreo)
      .leftJoin(usuarios, eq(usuarios.id, plantillasCorreo.actualizadoPor))
      .where(eq(plantillasCorreo.id, id))
      .limit(1);
    return this.toRow(fila!.plantilla, fila!.autor);
  }

  private general(db: DrizzleDb | DrizzleTx, numero: number) {
    return db.select().from(plantillasCorreo).where(and(isNull(plantillasCorreo.campanaId), eq(plantillasCorreo.giro, ""), eq(plantillasCorreo.numero, numero))).limit(1);
  }

  // Con campana_id edita el propio de la campaña, y lo crea la primera vez
  // (antes = el general que tenía). En la auditoría va el nombre de la
  // campaña, para que el Registro de cambios lo diga aunque luego cambie.
  async editar(user: CurrentUser, numero: number, input: EditarPlantillaInput) {
    exigirVariablesConocidas(input.asunto, input.cuerpo);
    exigirEnlacesValidos(input.cuerpo);
    const id = await this.db.transaction(async (tx) => {
      const campana = input.campana_id === undefined ? null : await this.campana(tx, input.campana_id);
      const deCampana = campana ? { campana_id: campana.id, campana: campana.nombre } : {};
      const [actual] = campana
        ? await tx.select().from(plantillasCorreo).where(and(eq(plantillasCorreo.campanaId, campana.id), eq(plantillasCorreo.giro, ""), eq(plantillasCorreo.numero, numero))).limit(1).for("update")
        : await this.general(tx, numero).for("update");

      if (!actual) {
        if (!campana) throw new HttpError(404, "Plantilla no encontrada");
        const [general] = await this.general(tx, numero);
        const [result] = await tx.insert(plantillasCorreo).values({ campanaId: campana.id, giro: "", numero, asunto: input.asunto, cuerpo: input.cuerpo, actualizadoPor: user.id });
        await tx.insert(auditoria).values({
          usuarioId: user.id,
          entidad: "plantilla_correo",
          entidadId: result.insertId,
          accion: "editar",
          antes: { numero, ...deCampana, asunto: general?.asunto ?? null, cuerpo: general?.cuerpo ?? null },
          despues: { numero, ...deCampana, asunto: input.asunto, cuerpo: input.cuerpo }
        });
        return result.insertId;
      }
      if (actual.asunto === input.asunto && actual.cuerpo === input.cuerpo) return actual.id;

      await tx.update(plantillasCorreo).set({ asunto: input.asunto, cuerpo: input.cuerpo, actualizadoPor: user.id }).where(eq(plantillasCorreo.id, actual.id));
      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "plantilla_correo",
        entidadId: actual.id,
        accion: "editar",
        antes: { numero, ...deCampana, asunto: actual.asunto, cuerpo: actual.cuerpo },
        despues: { numero, ...deCampana, asunto: input.asunto, cuerpo: input.cuerpo }
      });
      return actual.id;
    });
    return this.fila(id);
  }

  // El propio de una campaña se borra y ese número vuelve al general. Los
  // envíos que ya salieron con él guardan su plantilla_id (sin FK): un
  // reintento usa la que hoy toca (plantillas.correo.ts, correoDeEnvio).
  async quitar(user: CurrentUser, numero: number, campanaId: number) {
    await this.db.transaction(async (tx) => {
      const campana = await this.campana(tx, campanaId);
      const [actual] = await tx.select().from(plantillasCorreo).where(and(eq(plantillasCorreo.campanaId, campana.id), eq(plantillasCorreo.giro, ""), eq(plantillasCorreo.numero, numero))).limit(1).for("update");
      if (!actual) throw new HttpError(404, "Esta campaña no tiene un correo propio para ese número");
      await tx.delete(plantillasCorreo).where(eq(plantillasCorreo.id, actual.id));
      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "plantilla_correo",
        entidadId: actual.id,
        accion: "quitar",
        antes: { numero, campana_id: campana.id, campana: campana.nombre, asunto: actual.asunto, cuerpo: actual.cuerpo },
        despues: { numero, campana_id: campana.id, campana: campana.nombre, origen: "general" }
      });
    });
    const [general] = await this.general(this.db, numero);
    return this.fila(general!.id);
  }

  // El pie vive en parametros_automatizacion (no es una plantilla: va en los
  // tres). En auditoria no tiene id propio: entidad_id 0.
  async editarPie(user: CurrentUser, input: EditarPieInput) {
    exigirVariablesConocidas(input.texto);
    exigirEnlacesValidos(input.texto);
    await this.db.transaction(async (tx) => {
      const [actual] = await tx.select().from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_PIE_CORREO)).limit(1).for("update");
      const antes = typeof actual?.valor === "string" ? actual.valor : "";
      if (actual && antes === input.texto) return;

      await tx
        .insert(parametrosAutomatizacion)
        .values({ clave: CLAVE_PIE_CORREO, valor: input.texto, descripcion: "Pie de los correos de prospeccion (domicilio, aviso de privacidad); se edita en Administracion" })
        .onDuplicateKeyUpdate({ set: { valor: input.texto } });
      await tx.insert(auditoria).values({ usuarioId: user.id, entidad: "pie_correo", entidadId: 0, accion: "editar", antes: { pie: antes }, despues: { pie: input.texto } });
    });
    return { texto: await leerPie(this.db) };
  }

  async vistaPrevia(input: VistaPreviaInput) {
    const pie = input.pie ?? (await leerPie(this.db));
    exigirVariablesConocidas(input.asunto, input.cuerpo, pie);
    exigirEnlacesValidos(input.cuerpo, pie);
    const datos = input.prospecto_id ? await datosDelProspecto(this.db, input.prospecto_id) : DATOS_EJEMPLO;
    // En la pantalla el link de baja no lleva a ningún lado: el de verdad va
    // firmado para cada prospecto (shared/link-baja.ts) y se arma al mandar.
    const correo = armarCorreo({ asunto: input.asunto, cuerpo: input.cuerpo }, datos, pie, { linkDeBaja: URL_BAJA_EJEMPLO });
    return { ...correo, html: correo.html.replaceAll(`href="${URL_BAJA_EJEMPLO}"`, 'href="#"') };
  }
}
