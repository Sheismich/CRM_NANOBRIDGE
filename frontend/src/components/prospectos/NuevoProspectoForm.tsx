import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import type { NombreIcono } from "../ui/iconos";
import { ApiError, api } from "../../lib/api";
import { campanasAsignables, useCampanas } from "../../lib/campanas";
import { avisoMediosSuprimidos } from "../../lib/medios";
import type { Borrador, Empresa } from "../../types";
import { BuscadorEmpresa, EmpresaElegida } from "../empresas/BuscadorEmpresa";
import { TAMANOS, correoOpcional, sinVacios, telefonoOpcional, textoOpcional, urlOpcional } from "../empresas/campos";

// Mismos límites que prospectoInputSchema (src/crm/dto/prospecto.schema.ts).
// El backend deduplica por correo y teléfono, por eso pide al menos uno, y
// el canal inicial debe tener su medio (WhatsApp usa el teléfono).
// El nombre de la empresa solo se pide con "Empresa nueva" (se revisa al
// guardar, porque con "Ya existe" no se escribe).
const prospectoSchema = z
  .object({
    empresaNombreLegal: z.string().trim().max(255, "Máximo 255 caracteres"),
    empresaGiro: textoOpcional(120),
    empresaTamano: z.string(),
    empresaRegion: textoOpcional(120),
    empresaEstado: textoOpcional(120),
    empresaCiudad: textoOpcional(120),
    empresaSitioWeb: urlOpcional,
    contactoNombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(160, "Máximo 160 caracteres"),
    contactoPuesto: textoOpcional(160),
    correo: correoOpcional,
    telefono: telefonoOpcional,
    canalInicial: z.enum(["correo", "telefono", "whatsapp"]),
    prioridad: z.string(),
    confianza: z.string(),
    fuenteUrl: urlOpcional,
    observaciones: textoOpcional(2000),
    // Id de la campaña como texto del <select>; vacío = sin campaña.
    campanaId: z.string()
  })
  .refine((p) => p.correo || p.telefono, { message: "Captura correo o teléfono", path: ["correo"] })
  .refine((p) => (p.canalInicial === "correo" ? p.correo : p.telefono), { message: "El canal inicial necesita su medio (WhatsApp usa el teléfono)", path: ["canalInicial"] });
type ProspectoInput = z.infer<typeof prospectoSchema>;

type Confirmado = { id: number; empresa_id?: number; medios_suprimidos?: string[] };

// POST /prospectos crea un borrador de una fila (lote "manual") que pasa
// por la misma deduplicación que el CSV; aquí se confirma en el mismo paso,
// porque quien lo captura ya lo revisó. Si sale duplicado contra un
// contacto existente, se pregunta antes de reutilizarlo.
// Score sigue fuera: lo calcula la automatización.
// "Ya existe" (22-oct-2026): se elige una empresa del CRM y el contacto nuevo
// se cuelga de ella (empresaId); si no, cada alta creaba otra empresa.
export function NuevoProspectoForm({ onDone }: { onDone: (prospectoId: number | null, aviso?: string | null) => void }) {
  const queryClient = useQueryClient();
  const { data: campanas } = useCampanas();
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<Borrador | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [empresaExiste, setEmpresaExiste] = useState(false);
  const [empresaElegida, setEmpresaElegida] = useState<Empresa | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting }
  } = useForm<ProspectoInput>({
    resolver: zodResolver(prospectoSchema),
    defaultValues: {
      empresaNombreLegal: "",
      empresaGiro: "",
      empresaTamano: "",
      empresaRegion: "",
      empresaEstado: "",
      empresaCiudad: "",
      empresaSitioWeb: "",
      contactoNombre: "",
      contactoPuesto: "",
      correo: "",
      telefono: "",
      canalInicial: "correo",
      prioridad: "",
      confianza: "",
      fuenteUrl: "",
      observaciones: "",
      campanaId: ""
    }
  });

  async function confirmar(borrador: Borrador, usarContactoExistente: boolean) {
    const res = await api.post<Confirmado>(`/api/v1/prospectos/importaciones/${borrador.lote_id}/filas/${borrador.id}/confirmar`, { usarContactoExistente });
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["prospectos"] }), queryClient.invalidateQueries({ queryKey: ["empresas"] })]);
    onDone(res.id, avisoMediosSuprimidos(res.medios_suprimidos));
  }

  async function onSubmit(values: ProspectoInput) {
    setServerError(null);
    if (empresaExiste && !empresaElegida) {
      setServerError("Elige la empresa, o cambia a Empresa nueva.");
      return;
    }
    if (!empresaExiste && values.empresaNombreLegal.length < 2) {
      setError("empresaNombreLegal", { message: "Mínimo 2 caracteres" });
      return;
    }
    try {
      const { campanaId, empresaNombreLegal, empresaGiro, empresaTamano, empresaRegion, empresaEstado, empresaCiudad, empresaSitioWeb, ...resto } = values;
      const empresa = empresaExiste && empresaElegida
        ? { empresaId: empresaElegida.id }
        : sinVacios({ empresaNombreLegal, empresaGiro, empresaTamano, empresaRegion, empresaEstado, empresaCiudad, empresaSitioWeb });
      const borrador = await api.post<Borrador>("/api/v1/prospectos", { ...sinVacios(resto), ...empresa, ...(campanaId ? { campanaId: Number(campanaId) } : {}) });
      if (borrador.estado === "duplicado") {
        setDuplicado(borrador);
        return;
      }
      await confirmar(borrador, false);
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  async function resolverDuplicado(usar: boolean) {
    if (!duplicado) return;
    setServerError(null);
    setOcupado(true);
    try {
      if (usar) {
        await confirmar(duplicado, true);
      } else {
        // Descartar: el borrador queda rechazado, no se crea nada.
        await api.post(`/api/v1/prospectos/importaciones/${duplicado.lote_id}/filas/${duplicado.id}/rechazar`);
        onDone(null);
      }
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  if (duplicado) {
    const medio = duplicado.match_motivo === "telefono" ? "teléfono" : "correo";
    return (
      <div className="m-4 flex flex-col gap-3 rounded-[14px] bg-warn-bg p-5 md:m-5">
        <div className="text-[13px] font-bold text-warn">Posible duplicado</div>
        <div className="text-[13px] text-ink">
          {duplicado.match_contacto_id
            ? `Ya existe un contacto con el mismo ${medio}. Puedes registrar el prospecto sobre ese contacto o descartar la captura.`
            : (duplicado.errores?.map((e) => e.mensaje).join("; ") ?? "El prospecto coincide con otro registro.")}
        </div>
        <ServerError message={serverError} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={ocupado} onClick={() => void resolverDuplicado(false)}>
            Descartar
          </Button>
          {duplicado.match_contacto_id && (
            <Button variant="outline" disabled={ocupado} onClick={() => void resolverDuplicado(true)}>
              Usar contacto existente
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex min-h-full flex-col">
      <div className="flex flex-col gap-[22px] px-4 py-5 md:px-6">
      <Seccion icono="empresa" titulo="Empresa">
      <div className="flex flex-wrap gap-1.5">
        {[
          { existe: false, texto: "Empresa nueva" },
          { existe: true, texto: "Ya existe en el CRM" }
        ].map((o) => (
          <button
            key={o.texto}
            type="button"
            onClick={() => setEmpresaExiste(o.existe)}
            aria-pressed={empresaExiste === o.existe}
            className={clsx("rounded-full border px-3 py-1.5 text-[12px] font-bold", empresaExiste === o.existe ? "border-navy bg-navy-bg text-navy" : "border-border bg-card text-ink-2 hover:text-strong")}
          >
            {o.texto}
          </button>
        ))}
      </div>
      {empresaExiste ? (
        empresaElegida ? (
          <>
            <div className="rounded-[12px] border border-border">
              <EmpresaElegida empresa={empresaElegida} onCambiar={() => setEmpresaElegida(null)} />
            </div>
            {(!empresaElegida.giro || !empresaElegida.tamano) && (
              <div className="flex gap-2.5 rounded-[12px] bg-warn-bg px-3.5 py-3 text-[12px] font-semibold text-warn">
                <Icono nombre="aviso" size={15} className="mt-px shrink-0" />
                A esta empresa le falta {[!empresaElegida.giro && "giro", !empresaElegida.tamano && "tamaño"].filter(Boolean).join(" y ")}: complétalo en su ficha o la automatización no le escribe.
              </div>
            )}
          </>
        ) : (
          <BuscadorEmpresa pregunta="¿Qué empresa?" onElegir={setEmpresaElegida} />
        )
      ) : (
      <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Nombre legal" htmlFor="pr-empresa" error={errors.empresaNombreLegal?.message}>
            <input id="pr-empresa" className={inputClass} {...register("empresaNombreLegal")} />
          </Field>
        </div>
        <Field label="Giro (recomendado)" htmlFor="pr-giro" error={errors.empresaGiro?.message}>
          <input id="pr-giro" className={inputClass} {...register("empresaGiro")} />
        </Field>
        <Field label="Tamaño (recomendado)" htmlFor="pr-tamano">
          <select id="pr-tamano" className={inputClass} {...register("empresaTamano")}>
            <option value="">— Sin dato —</option>
            {TAMANOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Región (opcional)" htmlFor="pr-region" error={errors.empresaRegion?.message}>
          <input id="pr-region" className={inputClass} {...register("empresaRegion")} />
        </Field>
        <Field label="Estado (opcional)" htmlFor="pr-estado" error={errors.empresaEstado?.message}>
          <input id="pr-estado" className={inputClass} {...register("empresaEstado")} />
        </Field>
        <Field label="Ciudad (opcional)" htmlFor="pr-ciudad" error={errors.empresaCiudad?.message}>
          <input id="pr-ciudad" className={inputClass} {...register("empresaCiudad")} />
        </Field>
        <Field label="Sitio web (opcional)" htmlFor="pr-web" error={errors.empresaSitioWeb?.message}>
          <input id="pr-web" placeholder="https://" className={inputClass} {...register("empresaSitioWeb")} />
        </Field>
      </div>
      <div className="flex gap-2.5 rounded-[12px] bg-warn-bg px-3.5 py-3 text-[12px] font-semibold text-warn">
        <Icono nombre="aviso" size={15} className="mt-px shrink-0" />
        Sin giro ni tamaño la automatización lo marca como excluido y no le escribe.
      </div>
      </>
      )}
      </Seccion>

      <Seccion icono="persona" titulo="Contacto">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Nombre" htmlFor="pr-contacto" error={errors.contactoNombre?.message}>
          <input id="pr-contacto" className={inputClass} {...register("contactoNombre")} />
        </Field>
        <Field label="Puesto (opcional)" htmlFor="pr-puesto" error={errors.contactoPuesto?.message}>
          <input id="pr-puesto" className={inputClass} {...register("contactoPuesto")} />
        </Field>
        <Field label="Canal inicial" htmlFor="pr-canal" error={errors.canalInicial?.message}>
          <select id="pr-canal" className={inputClass} {...register("canalInicial")}>
            <option value="correo">Correo</option>
            <option value="telefono">Teléfono</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </Field>
        <Field label="Correo" htmlFor="pr-correo" error={errors.correo?.message}>
          <input id="pr-correo" type="email" className={inputClass} {...register("correo")} />
        </Field>
        <Field label="Teléfono / WhatsApp" htmlFor="pr-telefono" error={errors.telefono?.message}>
          <input id="pr-telefono" inputMode="tel" className={inputClass} {...register("telefono")} />
        </Field>
      </div>
      </Seccion>

      <Seccion icono="tendencia" titulo="Calificación" opcional>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Prioridad (opcional)" htmlFor="pr-prioridad">
          <select id="pr-prioridad" className={inputClass} {...register("prioridad")}>
            <option value="">— Sin dato —</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </Field>
        <Field label="Confianza del dato (opcional)" htmlFor="pr-confianza">
          <select id="pr-confianza" className={inputClass} {...register("confianza")}>
            <option value="">— Sin dato —</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </Field>
        <Field label="Fuente (URL, opcional)" htmlFor="pr-fuente" error={errors.fuenteUrl?.message}>
          <input id="pr-fuente" placeholder="https://" className={inputClass} {...register("fuenteUrl")} />
        </Field>
        <Field label="Campaña (opcional)" htmlFor="pr-campana">
          <select id="pr-campana" className={inputClass} {...register("campanaId")}>
            <option value="">— Sin campaña —</option>
            {campanasAsignables(campanas?.data).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Observaciones (opcional)" htmlFor="pr-obs" error={errors.observaciones?.message}>
        <textarea id="pr-obs" rows={2} className={inputClass} {...register("observaciones")} />
      </Field>
      </Seccion>

      <ServerError message={serverError} />
      </div>

      <div className="sticky bottom-0 mt-auto flex justify-end gap-2.5 border-t border-border bg-card px-4 py-4 md:px-6">
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Crear prospecto"}
        </Button>
      </div>
    </form>
  );
}

// Sección del panel de alta: ícono en cuadrito, título y sus campos.
function Seccion({ icono, titulo, opcional = false, children }: { icono: NombreIcono; titulo: string; opcional?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2.5 font-heading text-[13px] font-extrabold text-strong">
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-navy-bg text-navy">
          <Icono nombre={icono} size={15} />
        </span>
        {titulo}
        {opcional && <em className="font-sans text-[12px] font-semibold not-italic text-ink-3">opcional</em>}
      </h3>
      {children}
    </section>
  );
}
