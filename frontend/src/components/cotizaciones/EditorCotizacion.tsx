import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BuscadorEmpresa } from "../empresas/BuscadorEmpresa";
import { EmpresaForm } from "../empresas/EmpresaForm";
import { CotizacionForm } from "../ficha/CotizacionForm";
import { NuevaOportunidadForm } from "../ficha/NuevaOportunidadForm";
import { useOportunidadesEmpresa } from "../ficha/queries";
import { Icono } from "../ui/Icono";
import { LogoEmpresa } from "../ui/LogoEmpresa";
import { PanelLateral } from "../ui/PanelLateral";
import { NotaEditor, Pasos, RenglonElegido, ResumenEditor, TarjetaEditor, type Paso } from "./piezas-editor";
import { api } from "../../lib/api";
import { formatoMonedaEntera } from "../../lib/formato";
import type { CotizacionDocumento, EmpresaDetalle, Oportunidad } from "../../types";

// Editor por pasos de Cotizaciones (docs/diseno/cotizaciones.html, opción
// D): 1 Empresa → 2 Oportunidad → 3 Partidas → 4 Revisar y enviar. Ocupa
// el lugar del tablero, con "← Volver al tablero". Una cotización cuelga
// de una oportunidad ABIERTA de la empresa (el backend la exige), así que
// se puede crear la empresa o la oportunidad sin salir de aquí. Los pasos
// 3 y 4 son CotizacionForm en modo editor (el mismo formulario de la
// ficha). Para una nueva versión, la empresa y la oportunidad ya están
// fijas y se empieza en el paso 3.

export type ModoEditor = { tipo: "crear" } | { tipo: "version"; base: CotizacionDocumento };

export function EditorCotizacion({ modo, onCerrar, onGuardada }: { modo: ModoEditor; onCerrar: () => void; onGuardada: (id: number) => void }) {
  const base = modo.tipo === "version" ? modo.base : null;
  const [empresaId, setEmpresaId] = useState<number | null>(base?.empresa_id ?? null);
  const [oportunidadId, setOportunidadId] = useState<number | null>(base?.oportunidad_id ?? null);
  const [pasoForm, setPasoForm] = useState<Paso>(3);
  const [creandoEmpresa, setCreandoEmpresa] = useState(false);
  const [creandoOportunidad, setCreandoOportunidad] = useState(false);

  const { data: empresa } = useQuery({
    queryKey: ["empresa", String(empresaId)],
    queryFn: () => api.get<EmpresaDetalle>(`/api/v1/empresas/${empresaId}`),
    enabled: empresaId != null
  });
  const { data: oportunidades, isPending: cargandoOportunidades } = useOportunidadesEmpresa(modo.tipo === "crear" ? (empresaId ?? 0) : 0);
  const abiertas = useMemo(() => (oportunidades?.data ?? []).filter((o) => !o.cerrada), [oportunidades]);
  const oportunidad = abiertas.find((o) => o.id === oportunidadId);
  // Una fila por medio en GET /empresas/:id: un contacto activo por id.
  const contactos = useMemo(
    () => [...new Map((empresa?.contactos ?? []).filter((c) => c.activo).map((c) => [c.id, { id: c.id, nombre: c.nombre, puesto: c.puesto }])).values()],
    [empresa]
  );

  const listaParaPartidas = base ? Boolean(empresa) : Boolean(empresa && oportunidad);
  const paso: Paso = !empresaId ? 1 : !oportunidadId ? 2 : listaParaPartidas ? pasoForm : 3;

  function elegirEmpresa(id: number | null) {
    setEmpresaId(id);
    setOportunidadId(null);
    setPasoForm(3);
  }

  const nombreEmpresa = empresa ? (empresa.nombre_comercial ?? empresa.nombre_legal) : "Cargando…";
  const renglonEmpresa = empresaId != null && (
    <RenglonElegido
      icono={<LogoEmpresa id={empresaId} nombre={empresa ? nombreEmpresa : "?"} tamano="chico" />}
      titulo={nombreEmpresa}
      detalle={[empresa?.giro, empresa?.ciudad].filter(Boolean).join(" · ") || undefined}
      onCambiar={base ? undefined : () => elegirEmpresa(null)}
    />
  );
  const tituloOportunidad = base ? (base.oportunidad_titulo ?? `Oportunidad ${base.oportunidad_id}`) : (oportunidad?.titulo ?? "");
  const renglonOportunidad = oportunidadId != null && (
    <RenglonElegido
      icono={<IconoOportunidad />}
      titulo={tituloOportunidad}
      detalle={base ? (base.etapa_nombre ?? undefined) : oportunidad && detalleOportunidad(oportunidad)}
      onCambiar={base ? undefined : () => setOportunidadId(null)}
    />
  );

  return (
    <div>
      <div className="mb-3 text-[13px] text-ink-2">
        <button type="button" onClick={onCerrar} className="font-extrabold text-info hover:underline">
          ← Volver al tablero
        </button>
        {" · "}Cotizaciones › <b className="text-strong">{base ? `Nueva versión de #${base.id} (v${base.version + 1})` : "Nueva cotización"}</b>
      </div>
      <Pasos actual={paso} />

      {listaParaPartidas && empresa && empresaId != null && oportunidadId != null ? (
        <CotizacionForm
          key={`${empresaId}-${oportunidadId}`}
          {...(base ? { modo: "version" as const, base } : { modo: "crear" as const, oportunidades: abiertas, oportunidadId })}
          empresaId={empresaId}
          contactos={contactos}
          onDone={onCerrar}
          onGuardada={onGuardada}
          enEditor={{
            paraQuien: (
              <>
                {renglonEmpresa}
                {renglonOportunidad}
              </>
            ),
            contexto: {
              empresa: empresa.nombre_legal,
              oportunidad: tituloOportunidad,
              etapa: base
                ? [base.etapa_nombre, base.probabilidad != null ? `${base.probabilidad}%` : null].filter(Boolean).join(" · ") || null
                : oportunidad
                  ? `${oportunidad.etapa_nombre} · ${oportunidad.probabilidad}%`
                  : null
            },
            onPaso: setPasoForm
          }}
        />
      ) : (
        <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_340px]">
          <TarjetaEditor titulo="Para quién">
            {empresaId == null ? (
              <div className="px-4 py-4 md:px-[18px]">
                <BuscadorEmpresa pregunta="¿Para qué empresa es?" onElegir={(e) => elegirEmpresa(e.id)} />
                <button type="button" onClick={() => setCreandoEmpresa(true)} className="mt-3 text-[13px] font-extrabold text-info hover:underline">
                  + Es una empresa nueva
                </button>
              </div>
            ) : (
              <>
                {renglonEmpresa}
                {oportunidadId != null ? (
                  renglonOportunidad
                ) : (
                  <ElegirOportunidad cargando={cargandoOportunidades} abiertas={abiertas} onElegir={setOportunidadId} onCrear={() => setCreandoOportunidad(true)} />
                )}
              </>
            )}
          </TarjetaEditor>
          <ResumenEditor>
            <NotaEditor>
              {paso === 1 ? "Primero la empresa; luego, a cuál de sus oportunidades va ligada." : "Se cotiza contra una oportunidad abierta de la empresa. Después van las partidas."}
            </NotaEditor>
          </ResumenEditor>
        </div>
      )}

      <PanelLateral
        abierto={creandoEmpresa}
        onCerrar={() => setCreandoEmpresa(false)}
        encabezado={
          <div>
            <h2 className="pt-1 font-heading text-[20px] font-black text-strong">Nueva empresa</h2>
            <p className="mt-1 text-[13px] text-ink-2">Con su contacto principal. Al guardarla sigue la cotización.</p>
          </div>
        }
        cuerpoClassName="!p-0"
      >
        <EmpresaForm
          enPanel
          onDone={() => setCreandoEmpresa(false)}
          onCreada={(id) => {
            setCreandoEmpresa(false);
            elegirEmpresa(id);
          }}
        />
      </PanelLateral>
      <PanelLateral abierto={creandoOportunidad} onCerrar={() => setCreandoOportunidad(false)} titulo="Nueva oportunidad" cuerpoClassName="!p-0">
        {empresaId != null && (
          <NuevaOportunidadForm
            empresaId={empresaId}
            contactos={contactos}
            onDone={() => setCreandoOportunidad(false)}
            onCreada={(id) => {
              setCreandoOportunidad(false);
              setOportunidadId(id);
            }}
          />
        )}
      </PanelLateral>
    </div>
  );
}

function detalleOportunidad(o: Oportunidad) {
  return [o.etapa_nombre, o.valor_estimado ? `${formatoMonedaEntera.format(Number(o.valor_estimado))} en el pipeline` : null].filter(Boolean).join(" · ");
}

function IconoOportunidad() {
  return (
    <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-navy-bg text-navy">
      <Icono nombre="bandera" size={16} />
    </span>
  );
}

function ElegirOportunidad({ cargando, abiertas, onElegir, onCrear }: { cargando: boolean; abiertas: Oportunidad[]; onElegir: (id: number) => void; onCrear: () => void }) {
  return (
    <div className="px-4 py-4 md:px-[18px]">
      <div className="text-[13px] font-bold text-strong">¿Qué oportunidad se está cotizando?</div>
      {cargando && <p className="mt-2 text-[13px] text-ink-2">Cargando oportunidades…</p>}
      {!cargando && abiertas.length === 0 && <p className="mt-2 text-[13px] text-ink-2">Esta empresa no tiene oportunidades abiertas. Créala para continuar.</p>}
      <ul className="mt-3 flex flex-col gap-1.5">
        {abiertas.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => onElegir(o.id)} className="flex w-full items-center gap-3 rounded-[12px] border border-border bg-card px-3 py-2.5 text-left hover:border-navy/40">
              <IconoOportunidad />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13px] text-strong">{o.titulo}</b>
                <small className="block truncate text-[12px] text-ink-3">{detalleOportunidad(o)}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!cargando && (
        <button type="button" onClick={onCrear} className="mt-3 text-[13px] font-extrabold text-info hover:underline">
          + Crear oportunidad
        </button>
      )}
    </div>
  );
}
