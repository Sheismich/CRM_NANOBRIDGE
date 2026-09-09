import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { requireRole, requireUser } from "../auth/require-user.js";
import { HttpError } from "../shared/http.js";

export const crmRouter = Router();
crmRouter.use(requireUser);

const contactInput = z.object({
  nombre: z.string().trim().min(2).max(160), puesto: z.string().trim().max(160).optional(), area: z.string().trim().max(160).optional(),
  correo: z.string().trim().email().max(254).optional(), telefono: z.string().trim().min(7).max(40).optional(), whatsapp: z.string().trim().min(7).max(40).optional()
}).refine((input) => input.correo || input.telefono || input.whatsapp, { message: "Cada contacto requiere al menos un medio de contacto" });

const companyInput = z.object({
  nombreLegal: z.string().trim().min(2).max(255), nombreComercial: z.string().trim().max(255).optional(), giro: z.string().trim().max(120).optional(),
  tamano: z.enum(["micro", "pequena", "mediana", "grande"]).optional(), region: z.string().trim().max(120).optional(), estado: z.string().trim().max(120).optional(),
  ciudad: z.string().trim().max(120).optional(), pais: z.string().length(2).default("MX"), sitioWeb: z.string().url().max(2048).optional(), linkedinUrl: z.string().url().max(2048).optional(), contactos: z.array(contactInput).min(1).max(50)
});

function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
function normalizePhone(value: string) { return value.replace(/\D/g, ""); }

async function audit(usuarioId: number, entidad: string, entidadId: number, accion: string, despues: object) {
  await pool.query("INSERT INTO auditoria (usuario_id, entidad, entidad_id, accion, despues) VALUES (?, ?, ?, ?, ?)", [usuarioId, entidad, entidadId, accion, JSON.stringify(despues)]);
}

crmRouter.get("/empresas", async (request, response, next) => {
  try {
    const page = z.coerce.number().int().min(1).default(1).parse(request.query.page);
    const limit = z.coerce.number().int().min(1).max(100).default(25).parse(request.query.limit);
    const offset = (page - 1) * limit;
    const ownsOnly = request.currentUser?.rol === "agente";
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT e.id, e.nombre_legal, e.nombre_comercial, e.giro, e.region, e.estado, e.ciudad, e.activo, e.creado_en
      FROM empresas e WHERE e.activo = TRUE ${ownsOnly ? "AND e.propietario_id = ?" : ""} ORDER BY e.nombre_legal LIMIT ? OFFSET ?`, ownsOnly ? [request.currentUser!.id, limit, offset] : [limit, offset]);
    response.json({ page, limit, data: rows });
  } catch (error) { next(error); }
});

crmRouter.post("/empresas", requireRole("administrador", "supervisor", "agente"), async (request, response, next) => {
  const connection = await pool.getConnection();
  try {
    const input = companyInput.parse(request.body);
    await connection.beginTransaction();
    const [company] = await connection.query<ResultSetHeader>(`INSERT INTO empresas (nombre_legal, nombre_comercial, giro, tamano, region, estado, ciudad, pais, sitio_web, linkedin_url, propietario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.nombreLegal, input.nombreComercial ?? null, input.giro ?? null, input.tamano ?? null, input.region ?? null, input.estado ?? null, input.ciudad ?? null, input.pais.toUpperCase(), input.sitioWeb ?? null, input.linkedinUrl ?? null, request.currentUser!.id]);
    for (const contact of input.contactos) {
      const [created] = await connection.query<ResultSetHeader>("INSERT INTO contactos (empresa_id, nombre, puesto, area) VALUES (?, ?, ?, ?)", [company.insertId, contact.nombre, contact.puesto ?? null, contact.area ?? null]);
      const media = [["correo", contact.correo, contact.correo && normalizeEmail(contact.correo)], ["telefono", contact.telefono, contact.telefono && normalizePhone(contact.telefono)], ["whatsapp", contact.whatsapp, contact.whatsapp && normalizePhone(contact.whatsapp)]] as const;
      for (const [type, raw, normalized] of media) if (raw && normalized) await connection.query("INSERT INTO medios_contacto (contacto_id, tipo, valor, valor_normalizado, es_principal) VALUES (?, ?, ?, ?, ?)", [created.insertId, type, raw, normalized, type === "correo"]);
    }
    await connection.query("INSERT INTO auditoria (usuario_id, entidad, entidad_id, accion, despues) VALUES (?, 'empresa', ?, 'crear', ?)", [request.currentUser!.id, company.insertId, JSON.stringify({ nombreLegal: input.nombreLegal })]);
    await connection.commit();
    response.status(201).json({ id: company.insertId });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

crmRouter.get("/empresas/:id", async (request, response, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(request.params.id);
    const [companies] = await pool.query<RowDataPacket[]>("SELECT * FROM empresas WHERE id = ? AND activo = TRUE", [id]);
    const company = companies[0];
    if (!company || (request.currentUser!.rol === "agente" && company.propietario_id !== request.currentUser!.id)) throw new HttpError(404, "Empresa no encontrada");
    const [contacts] = await pool.query<RowDataPacket[]>(`SELECT c.*, m.id AS medio_id, m.tipo AS medio_tipo, m.valor AS medio_valor, m.estado_contacto
      FROM contactos c LEFT JOIN medios_contacto m ON m.contacto_id = c.id WHERE c.empresa_id = ? AND c.activo = TRUE ORDER BY c.nombre`, [id]);
    response.json({ ...company, contactos: contacts });
  } catch (error) { next(error); }
});
