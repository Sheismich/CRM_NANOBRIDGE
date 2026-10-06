import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { aCentavos, calcularCotizacion, tieneMaxDosDecimales } from "../../lib/dinero";
import { formatoMoneda } from "../../lib/formato";
import type { CotizacionDetalle, Oportunidad } from "../../types";

// Mismos límites que cotizacion.schema.ts del backend: DECIMAL(12,2), y
// cantidades y montos con a lo más 2 decimales (D1, 5-oct-2026).
const MAX_MONTO = 9_999_999_999.99;
const MAX_MONTO_CENTAVOS = aCentavos(MAX_MONTO);
const PARTIDA_MAX = 50;

const numero = (max: number, { positivo = false } = {}) =>
  z
    .string()
    .trim()
    .refine((v) => v !== "" && Number.isFinite(Number(v)), "Número inválido")
    .refine((v) => tieneMaxDosDecimales(Number(v)), "Máximo 2 decimales")
    .refine((v) => (positivo ? Number(v) > 0 : Number(v) >= 0), positivo ? "Debe ser mayor a 0" : "No puede ser negativo")
    .refine((v) => Number(v) <= max, `Máximo ${max.toLocaleString("es-MX")}`);

const cotizacionSchema = z
  .object({
    oportunidadId: z.string(),
    contactoId: z.string(),
    partidas: z
      .array(
        z.object({
          descripcion: z.string().trim().min(2, "Mínimo 2 caracteres").max(255, "Máximo 255 caracteres"),
          cantidad: numero(1_000_000, { positivo: true }),
          precioUnitario: numero(100_000_000)
        })
      )
      .min(1, "Agrega al menos una partida")
      .max(PARTIDA_MAX, `Máximo ${PARTIDA_MAX} partidas`),
    descuento: numero(MAX_MONTO),
    impuestos: numero(MAX_MONTO),
    fechaEsperadaCierre: z.string(),
    probabilidad: z.string().refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 100), "Entero de 0 a 100")
  })
  .superRefine((v, ctx) => {
    const { subtotal, total } = calcularCentavos(v);
    if (subtotal > MAX_MONTO_CENTAVOS) ctx.addIssue({ code: "custom", path: ["descuento"], message: "El subtotal excede el máximo permitido" });
    // Desde D1 el descuento no puede pasar del subtotal (antes bastaba con
    // que los impuestos lo cubrieran).
    else if (aCentavos(Number(v.descuento) || 0) > subtotal) ctx.addIssue({ code: "custom", path: ["descuento"], message: "El descuento no puede ser mayor que el subtotal" });
    else if (total > MAX_MONTO_CENTAVOS) ctx.addIssue({ code: "custom", path: ["impuestos"], message: "El total excede el máximo permitido" });
  });
type CotizacionInput = z.infer<typeof cotizacionSchema>;

// Igual que CotizacionesService.calcular() (lib/dinero.ts): cada línea se
// redondea a centavos antes de sumar, para que el total mostrado sea el que
// se guarda. Resultado en centavos.
function calcularCentavos(v: { partidas: { cantidad: string; precioUnitario: string }[]; descuento: string; impuestos: string }) {
  const partidas = v.partidas.map((p) => ({ cantidad: Number(p.cantidad) || 0, precioUnitario: Number(p.precioUnitario) || 0 }));
  return calcularCotizacion(partidas, Number(v.descuento) || 0, Number(v.impuestos) || 0);
}

type Props = {
  empresaId: number;
  contactos: { id: number; nombre: string }[];
  onDone: () => void;
  // Solo al guardar (onDone corre también al cancelar).
  onGuardada?: () => void;
} & (
  // Nueva cotización: se elige la oportunidad (solo abiertas: el backend
  // rechaza con 409 una oportunidad cerrada). `oportunidadId` la deja ya
  // elegida (la que se acaba de crear desde "Nueva cotización").
  | { modo: "crear"; oportunidades: Oportunidad[]; oportunidadId?: number }
  // Nueva versión: misma empresa y oportunidad; parte de la vigente.
  | { modo: "version"; base: CotizacionDetalle }
);

export function CotizacionForm(props: Props) {
  const { empresaId, contactos, onDone, onGuardada } = props;
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const base = props.modo === "version" ? props.base : null;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting }
  } = useForm<CotizacionInput>({
    resolver: zodResolver(cotizacionSchema),
    defaultValues: {
      oportunidadId: props.modo === "crear" && props.oportunidadId ? String(props.oportunidadId) : "",
      contactoId: base?.contacto_id ? String(base.contacto_id) : "",
      partidas: base
        ? base.partidas.map((p) => ({ descripcion: p.descripcion, cantidad: String(Number(p.cantidad)), precioUnitario: String(Number(p.precio_unitario)) }))
        : [{ descripcion: "", cantidad: "1", precioUnitario: "" }],
      descuento: base ? String(Number(base.descuento)) : "0",
      impuestos: base ? String(Number(base.impuestos)) : "0",
      fechaEsperadaCierre: base?.fecha_esperada_cierre ?? "",
      probabilidad: base?.probabilidad != null ? String(base.probabilidad) : ""
    }
  });
  const { fields, append, remove } = useFieldArray({ control, name: "partidas" });
  const partidas = useWatch({ control, name: "partidas" });
  const descuento = useWatch({ control, name: "descuento" });
  const impuestos = useWatch({ control, name: "impuestos" });
  const centavos = calcularCentavos({ partidas: partidas ?? [], descuento, impuestos });
  const subtotal = centavos.subtotal / 100;
  const total = centavos.total / 100;

  async function onSubmit(values: CotizacionInput) {
    setServerError(null);
    if (props.modo === "crear" && !values.oportunidadId) {
      setServerError("Elige la oportunidad");
      return;
    }
    const datos = {
      contactoId: values.contactoId ? Number(values.contactoId) : undefined,
      partidas: values.partidas.map((p) => ({ descripcion: p.descripcion, cantidad: Number(p.cantidad), precioUnitario: Number(p.precioUnitario) })),
      descuento: Number(values.descuento),
      impuestos: Number(values.impuestos),
      fechaEsperadaCierre: values.fechaEsperadaCierre || undefined,
      // Vacío = el backend toma la probabilidad de la etapa de la oportunidad.
      probabilidad: values.probabilidad !== "" ? Number(values.probabilidad) : undefined
    };
    try {
      if (props.modo === "crear") {
        await api.post("/api/v1/cotizaciones", { ...datos, empresaId, oportunidadId: Number(values.oportunidadId) });
      } else {
        await api.post(`/api/v1/cotizaciones/${props.base.id}/version`, datos);
      }
      await queryClient.invalidateQueries({ queryKey: ["cotizaciones"] });
      await queryClient.invalidateQueries({ queryKey: ["cotizacion"] });
      onGuardada?.();
      onDone();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 border-b border-border bg-bg p-5">
      {props.modo === "version" && (
        <div className="text-[13px] text-ink-2">
          Nueva versión (v{props.base.version + 1}): la v{props.base.version} queda obsoleta. La empresa y la oportunidad no cambian.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {props.modo === "crear" && (
          <Field label="Oportunidad" htmlFor="cot-oportunidad">
            <select id="cot-oportunidad" className={inputClass} {...register("oportunidadId")}>
              <option value="">— Elige —</option>
              {props.oportunidades.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.titulo} ({o.etapa_nombre})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Contacto (opcional)" htmlFor="cot-contacto">
          <select id="cot-contacto" className={inputClass} {...register("contactoId")}>
            <option value="">— Ninguno —</option>
            {contactos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold text-ink-2">Partidas</div>
        <div className="flex flex-col gap-2">
          {fields.map((field, index) => {
            const e = errors.partidas?.[index];
            return (
              <div key={field.id} className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[1fr_90px_130px_auto]">
                <div className="col-span-2 sm:col-span-1">
                  <input aria-label="Descripción" placeholder="Descripción" className={inputClass} {...register(`partidas.${index}.descripcion`)} />
                  {e?.descripcion && <span className="text-xs text-danger">{e.descripcion.message}</span>}
                </div>
                <div>
                  <input aria-label="Cantidad" inputMode="decimal" placeholder="Cant." className={inputClass} {...register(`partidas.${index}.cantidad`)} />
                  {e?.cantidad && <span className="text-xs text-danger">{e.cantidad.message}</span>}
                </div>
                <div>
                  <input aria-label="Precio unitario" inputMode="decimal" placeholder="Precio unitario" className={inputClass} {...register(`partidas.${index}.precioUnitario`)} />
                  {e?.precioUnitario && <span className="text-xs text-danger">{e.precioUnitario.message}</span>}
                </div>
                <Button type="button" variant="ghost" disabled={fields.length === 1} onClick={() => remove(index)} aria-label="Quitar partida">
                  ✕
                </Button>
              </div>
            );
          })}
        </div>
        {errors.partidas?.root && <span className="text-xs text-danger">{errors.partidas.root.message}</span>}
        <Button type="button" variant="ghost" className="mt-2" disabled={fields.length >= PARTIDA_MAX} onClick={() => append({ descripcion: "", cantidad: "1", precioUnitario: "" })}>
          + Agregar partida
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Descuento (MXN)" htmlFor="cot-descuento" error={errors.descuento?.message}>
          <input id="cot-descuento" inputMode="decimal" className={inputClass} {...register("descuento")} />
        </Field>
        <Field label="Impuestos (MXN)" htmlFor="cot-impuestos" error={errors.impuestos?.message}>
          <input id="cot-impuestos" inputMode="decimal" className={inputClass} {...register("impuestos")} />
        </Field>
        <Field label="Cierre esperado (opcional)" htmlFor="cot-cierre">
          <input id="cot-cierre" type="date" className={inputClass} {...register("fechaEsperadaCierre")} />
        </Field>
        <Field label="Probabilidad % (vacío = la de la etapa)" htmlFor="cot-probabilidad" error={errors.probabilidad?.message}>
          <input id="cot-probabilidad" inputMode="numeric" className={inputClass} {...register("probabilidad")} />
        </Field>
      </div>

      <div className="flex justify-end gap-6 text-[13px]">
        <span className="text-ink-2">Subtotal: {formatoMoneda.format(subtotal)}</span>
        <span className="font-bold">Total: {formatoMoneda.format(total)}</span>
      </div>

      <ServerError message={serverError} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : props.modo === "crear" ? "Crear cotización" : "Crear versión"}
        </Button>
      </div>
    </form>
  );
}
