import { useState, type ReactNode } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { HojaCotizacion } from "../cotizaciones/HojaCotizacion";
import { NotaEditor, RenglonResumen, ResumenEditor, TarjetaEditor, TotalGrande, type Paso } from "../cotizaciones/piezas-editor";
import { ApiError, api } from "../../lib/api";
import { CLASE_CAMPO_EDITOR } from "../../lib/cotizaciones";
import { aCentavos, calcularCotizacion, importeEnCentavos, tieneMaxDosDecimales } from "../../lib/dinero";
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
          // Segunda línea en el documento (028). Vacío = sin detalle.
          detalle: z.string().trim().max(255, "Máximo 255 caracteres"),
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

// Editor por pasos de la pantalla Cotizaciones (rediseño, 13-oct-2026):
// partidas a la izquierda y resumen fijo a la derecha (paso 3), y luego la
// hoja como va a quedar con "Guardar y marcar enviada" o "Guardar
// borrador" (paso 4). `paraQuien` son los renglones de empresa y
// oportunidad ya elegidos; `contexto`, lo que dice arriba la hoja.
type Editor = {
  paraQuien: ReactNode;
  contexto: { empresa: string; oportunidad: string; etapa: string | null };
  onPaso: (paso: Paso) => void;
};

type Props = {
  empresaId: number;
  contactos: { id: number; nombre: string; puesto?: string | null }[];
  onDone: () => void;
  // Solo al guardar (onDone corre también al cancelar), con el id de la
  // cotización que se creó.
  onGuardada?: (id: number) => void;
  enEditor?: Editor;
} & (
  // Nueva cotización: se elige la oportunidad (solo abiertas: el backend
  // rechaza con 409 una oportunidad cerrada). `oportunidadId` la deja ya
  // elegida (la que se acaba de crear desde "Nueva cotización").
  | { modo: "crear"; oportunidades: Oportunidad[]; oportunidadId?: number }
  // Nueva versión: misma empresa y oportunidad; parte de la vigente.
  | { modo: "version"; base: CotizacionDetalle }
);

export function CotizacionForm(props: Props) {
  const { empresaId, contactos, onDone, onGuardada, enEditor } = props;
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);
  const base = props.modo === "version" ? props.base : null;

  const {
    register,
    handleSubmit,
    control,
    getValues,
    formState: { errors, isSubmitting }
  } = useForm<CotizacionInput>({
    resolver: zodResolver(cotizacionSchema),
    defaultValues: {
      oportunidadId: props.modo === "crear" && props.oportunidadId ? String(props.oportunidadId) : "",
      contactoId: base?.contacto_id ? String(base.contacto_id) : "",
      partidas: base
        ? base.partidas.map((p) => ({ descripcion: p.descripcion, detalle: p.detalle ?? "", cantidad: String(Number(p.cantidad)), precioUnitario: String(Number(p.precio_unitario)) }))
        : [{ descripcion: "", detalle: "", cantidad: "1", precioUnitario: "" }],
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
  const contactoId = useWatch({ control, name: "contactoId" });
  const centavos = calcularCentavos({ partidas: partidas ?? [], descuento, impuestos });
  const subtotal = centavos.subtotal / 100;
  const total = centavos.total / 100;

  async function onSubmit(values: CotizacionInput, enviar = false) {
    setServerError(null);
    if (props.modo === "crear" && !values.oportunidadId) {
      setServerError("Elige la oportunidad");
      return;
    }
    const datos = {
      contactoId: values.contactoId ? Number(values.contactoId) : undefined,
      partidas: values.partidas.map((p) => ({ descripcion: p.descripcion, detalle: p.detalle || undefined, cantidad: Number(p.cantidad), precioUnitario: Number(p.precioUnitario) })),
      descuento: Number(values.descuento),
      impuestos: Number(values.impuestos),
      fechaEsperadaCierre: values.fechaEsperadaCierre || undefined,
      // Vacío = el backend toma la probabilidad de la etapa de la oportunidad.
      probabilidad: values.probabilidad !== "" ? Number(values.probabilidad) : undefined
    };
    try {
      // Las dos nacen en borrador.
      const { id } =
        props.modo === "crear"
          ? await api.post<{ id: number }>("/api/v1/cotizaciones", { ...datos, empresaId, oportunidadId: Number(values.oportunidadId) })
          : await api.post<{ id: number }>(`/api/v1/cotizaciones/${props.base.id}/version`, datos);
      if (enviar) {
        // Si esto falla (p. ej. la oportunidad se cerró en ese momento), ya
        // quedó guardada como borrador: se abre igual, y al volver a dar
        // "Marcar enviada" en el documento se ve el mensaje.
        await api.patch(`/api/v1/cotizaciones/${id}/estado`, { estado: "enviada" }).catch(() => undefined);
      }
      await queryClient.invalidateQueries({ queryKey: ["cotizaciones"] });
      await queryClient.invalidateQueries({ queryKey: ["cotizacion"] });
      onGuardada?.(id);
      onDone();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  if (enEditor) {
    const irA = (paso: Paso) => {
      setRevisando(paso === 4);
      enEditor.onPaso(paso);
    };
    const nuevaVersion = base ? base.version + 1 : 1;

    if (revisando) {
      const v = getValues();
      const contacto = contactos.find((c) => String(c.id) === v.contactoId);
      return (
        <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 overflow-hidden rounded-[18px] border border-border bg-soft">
            <HojaCotizacion
              datos={{
                id: null,
                version: nuevaVersion,
                emitida: null,
                vigente: v.fechaEsperadaCierre || null,
                empresa: enEditor.contexto.empresa,
                persona: contacto ? [contacto.nombre, contacto.puesto].filter(Boolean).join(" · ") : null,
                oportunidad: enEditor.contexto.oportunidad,
                etapa: enEditor.contexto.etapa,
                partidas: v.partidas.map((p) => {
                  const cantidad = Number(p.cantidad);
                  const precio = Number(p.precioUnitario);
                  return { descripcion: p.descripcion, detalle: p.detalle || null, cantidad, precio, importe: importeEnCentavos(cantidad, precio) / 100 };
                }),
                subtotal,
                descuento: Number(v.descuento) || 0,
                impuestos: Number(v.impuestos) || 0,
                total,
                moneda: "MXN"
              }}
            />
          </div>
          <ResumenEditor>
            <RenglonResumen etiqueta="Total" grande>
              <TotalGrande>{formatoMoneda.format(total)}</TotalGrande>
            </RenglonResumen>
            <NotaEditor>
              {base ? `Se guarda como v${nuevaVersion} y la v${base.version} queda obsoleta.` : "Así la va a ver el cliente."} El folio y la fecha los pone el sistema al guardar.
            </NotaEditor>
            <div className="flex flex-col gap-2 px-[18px] pt-1">
              <ServerError message={serverError} />
              <Button disabled={isSubmitting} onClick={() => void handleSubmit((values) => onSubmit(values, true))()}>
                <Icono nombre="correo" size={15} /> {isSubmitting ? "Guardando…" : "Guardar y marcar enviada"}
              </Button>
              <Button variant="outline" disabled={isSubmitting} onClick={() => void handleSubmit((values) => onSubmit(values))()}>
                Guardar borrador
              </Button>
              <Button variant="ghost" disabled={isSubmitting} onClick={() => irA(3)}>
                ← Corregir
              </Button>
            </div>
          </ResumenEditor>
        </div>
      );
    }

    const contactoElegido = contactos.find((c) => String(c.id) === contactoId);
    const agregar = () => append({ descripcion: "", detalle: "", cantidad: "1", precioUnitario: "" });
    return (
      <form onSubmit={(e) => void handleSubmit(() => irA(4))(e)} className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-[18px]">
          <TarjetaEditor titulo="Para quién">
            {enEditor.paraQuien}
            <div className="flex items-center gap-3 px-4 py-3 md:px-[18px]">
              <Avatar nombre={contactoElegido?.nombre} />
              <label className="min-w-0 flex-1">
                <span className="sr-only">Contacto</span>
                <select className={CLASE_CAMPO_EDITOR} {...register("contactoId")}>
                  <option value="">Sin contacto (opcional)</option>
                  {contactos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.puesto ? `${c.nombre} · ${c.puesto}` : c.nombre}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </TarjetaEditor>

          <TarjetaEditor
            titulo="Partidas"
            extra={
              fields.length < PARTIDA_MAX && (
                <button type="button" className="font-sans text-[12px] font-extrabold text-info hover:underline" onClick={agregar}>
                  + Agregar partida
                </button>
              )
            }
          >
            <div className="hidden grid-cols-[minmax(0,1fr)_80px_140px_130px_24px] gap-2.5 bg-soft px-[18px] py-2.5 font-heading text-[10px] font-extrabold uppercase tracking-[1px] text-ink-3 md:grid">
              <span>Concepto</span>
              <span className="text-right">Cant.</span>
              <span className="text-right">Precio unitario</span>
              <span className="text-right">Importe</span>
              <span />
            </div>
            {fields.map((field, index) => {
              const e = errors.partidas?.[index];
              const p = partidas?.[index];
              const importe = importeEnCentavos(Number(p?.cantidad) || 0, Number(p?.precioUnitario) || 0) / 100;
              return (
                <div key={field.id} className="grid grid-cols-2 items-start gap-2.5 border-b border-border px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_80px_140px_130px_24px] md:px-[18px]">
                  <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
                    <input aria-label="Concepto" placeholder="Concepto" className={CLASE_CAMPO_EDITOR} {...register(`partidas.${index}.descripcion`)} />
                    {e?.descripcion && <span className="text-xs text-danger">{e.descripcion.message}</span>}
                    <input aria-label="Detalle del concepto" placeholder="Detalle (opcional)" className={`${CLASE_CAMPO_EDITOR} !h-8 !text-[12px]`} {...register(`partidas.${index}.detalle`)} />
                    {e?.detalle && <span className="text-xs text-danger">{e.detalle.message}</span>}
                  </div>
                  <div>
                    <input aria-label="Cantidad" inputMode="decimal" placeholder="Cant." className={`${CLASE_CAMPO_EDITOR} text-right`} {...register(`partidas.${index}.cantidad`)} />
                    {e?.cantidad && <span className="text-xs text-danger">{e.cantidad.message}</span>}
                  </div>
                  <div>
                    <input aria-label="Precio unitario" inputMode="decimal" placeholder="Precio unitario" className={`${CLASE_CAMPO_EDITOR} text-right`} {...register(`partidas.${index}.precioUnitario`)} />
                    {e?.precioUnitario && <span className="text-xs text-danger">{e.precioUnitario.message}</span>}
                  </div>
                  <b className="mono flex h-10 items-center text-[14px] text-strong md:justify-end">{formatoMoneda.format(importe)}</b>
                  <button
                    type="button"
                    aria-label="Quitar partida"
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
                    className="flex h-10 items-center justify-end text-ink-3 hover:text-danger disabled:opacity-30 md:justify-center"
                  >
                    <Icono nombre="cerrar" size={14} />
                  </button>
                </div>
              );
            })}
            {errors.partidas?.root && <span className="block px-[18px] pt-2 text-xs text-danger">{errors.partidas.root.message}</span>}
            {fields.length < PARTIDA_MAX && (
              <div className="px-4 pb-4 pt-3 md:px-[18px]">
                <button type="button" onClick={agregar} className="w-full rounded-[12px] border-[1.5px] border-dashed border-border p-3 text-center text-[13px] font-extrabold text-ink-3 hover:border-navy/40 hover:text-strong">
                  + Agregar partida
                </button>
              </div>
            )}
          </TarjetaEditor>
        </div>

        <ResumenEditor>
          <RenglonResumen etiqueta="Subtotal">
            <b className="text-strong">{formatoMoneda.format(subtotal)}</b>
          </RenglonResumen>
          <CampoResumen etiqueta="Descuento" id="cot-descuento" error={errors.descuento?.message}>
            <input id="cot-descuento" inputMode="decimal" className={`${CLASE_CAMPO_EDITOR} !h-[34px] text-right !text-[13px]`} {...register("descuento")} />
          </CampoResumen>
          <CampoResumen etiqueta="Impuestos" id="cot-impuestos" error={errors.impuestos?.message}>
            <input id="cot-impuestos" inputMode="decimal" className={`${CLASE_CAMPO_EDITOR} !h-[34px] text-right !text-[13px]`} {...register("impuestos")} />
          </CampoResumen>
          <RenglonResumen etiqueta="Total" grande>
            <TotalGrande>{formatoMoneda.format(total)}</TotalGrande>
          </RenglonResumen>
          <RenglonResumen etiqueta="Moneda">
            <span className="rounded-[8px] border border-cyan bg-info-bg px-2.5 py-1 text-[12px] font-extrabold text-info">MXN</span>
          </RenglonResumen>
          <CampoResumen etiqueta="Cierre esperado" id="cot-cierre">
            <input id="cot-cierre" type="date" className={`${CLASE_CAMPO_EDITOR} !h-[34px] !text-[13px]`} {...register("fechaEsperadaCierre")} />
          </CampoResumen>
          <CampoResumen etiqueta="Probabilidad %" id="cot-probabilidad" error={errors.probabilidad?.message}>
            <input id="cot-probabilidad" inputMode="numeric" placeholder="la de la etapa" className={`${CLASE_CAMPO_EDITOR} !h-[34px] text-right !text-[13px]`} {...register("probabilidad")} />
          </CampoResumen>
          <NotaEditor>El total lo recalcula el sistema; se guarda como borrador hasta que la envíes.</NotaEditor>
          <div className="flex flex-col gap-2 px-[18px] pt-1">
            <ServerError message={serverError} />
            <Button type="submit">Revisar y enviar →</Button>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => void handleSubmit((values) => onSubmit(values))()}>
              {isSubmitting ? "Guardando…" : "Guardar borrador"}
            </Button>
          </div>
        </ResumenEditor>
      </form>
    );
  }


  return (
    <form onSubmit={(e) => void handleSubmit((values) => onSubmit(values))(e)} className="flex flex-col gap-4 border-b border-border bg-bg p-5">
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
        <Button type="button" variant="ghost" className="mt-2" disabled={fields.length >= PARTIDA_MAX} onClick={() => append({ descripcion: "", detalle: "", cantidad: "1", precioUnitario: "" })}>
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

// Renglón del resumen con un campo a la derecha (descuento, cierre...).
function CampoResumen({ etiqueta, id, error, children }: { etiqueta: string; id: string; error?: string; children: ReactNode }) {
  return (
    <div className="px-[18px] py-1.5">
      <div className="flex items-center justify-between gap-2.5 text-[13px] text-ink-2">
        <label htmlFor={id} className="shrink-0">
          {etiqueta}
        </label>
        <div className="w-[150px]">{children}</div>
      </div>
      {error && <span className="block text-right text-xs text-danger">{error}</span>}
    </div>
  );
}
