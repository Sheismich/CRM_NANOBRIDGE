import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { PanelLateral } from "../ui/PanelLateral";
import { Pastilla } from "../ui/Pastilla";
import { ApiError, api } from "../../lib/api";
import { cuando } from "../../lib/documentos";
import { CUANDO_SALE, type CorreoArmado, type PlantillaCorreo, type PlantillasRespuesta } from "../../lib/plantillas";

// "Correos de prospección" de Administración (etapa 1 de las mejoras,
// 19-oct-2026): el texto del correo 1 y los dos recordatorios, más el pie
// que va en los tres. n8n ya no tiene texto propio: la API le da el correo
// armado en cada envío, así que lo que se guarde aquí sale en el siguiente.
// Administrador y supervisor editan; cada cambio queda en el Registro de
// cambios.

type Edicion = { tipo: "plantilla"; plantilla: PlantillaCorreo } | { tipo: "pie" };

export function CorreosProspeccion() {
  const ahora = new Date();
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const { data, isPending, isError } = useQuery({
    queryKey: ["plantillas"],
    queryFn: () => api.get<PlantillasRespuesta>("/api/v1/plantillas")
  });

  return (
    <section className="tarjeta-blanca overflow-hidden !rounded-[18px]">
      <header className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-info-bg text-info">
          <Icono nombre="correo" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[16px] font-extrabold text-strong">Correos de prospección</h2>
          <p className="text-[12.5px] text-ink-3">Lo que reciben los prospectos. Un cambio sale desde el siguiente envío.</p>
        </div>
      </header>
      <div className="px-4 py-3 md:px-5">
        {isPending && <p className="py-2 text-[13px] text-ink-3">Cargando…</p>}
        {isError && <p className="py-2 text-[13px] text-danger">No se pudieron cargar los correos.</p>}
        <ul>
          {data?.plantillas.map((p) => (
            <li key={p.id} className="border-t border-border first:border-t-0">
              <button type="button" onClick={() => setEdicion({ tipo: "plantilla", plantilla: p })} className="flex w-full items-center gap-3 py-3 text-left hover:bg-soft/60">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Pastilla tono={p.numero === 1 ? "navy" : "info"}>{p.nombre}</Pastilla>
                    <small className="truncate text-[11.5px] text-ink-3">{CUANDO_SALE[p.numero]}</small>
                  </div>
                  <b className="mt-1 block truncate text-[13.5px] text-strong">{p.asunto}</b>
                  <small className="block text-[11.5px] text-ink-3">
                    {p.actualizado_por ? `Editado por ${p.actualizado_por.nombre} · ${cuando(p.actualizado_en, ahora).toLowerCase()}` : "Texto inicial, sin editar"}
                  </small>
                </div>
                <Icono nombre="flechaDerecha" size={16} className="shrink-0 text-ink-3" />
              </button>
            </li>
          ))}
          {data && (
            <li className="border-t border-border">
              <button type="button" onClick={() => setEdicion({ tipo: "pie" })} className="flex w-full items-center gap-3 py-3 text-left hover:bg-soft/60">
                <div className="min-w-0 flex-1">
                  <Pastilla tono="neutro">Pie de los tres</Pastilla>
                  {data.pie.texto ? (
                    <small className="mt-1 block truncate text-[12.5px] text-ink-2">{data.pie.texto}</small>
                  ) : (
                    <small className="mt-1 block text-[12.5px] font-bold text-warn">Vacío: falta el domicilio y el aviso de privacidad</small>
                  )}
                </div>
                <Icono nombre="flechaDerecha" size={16} className="shrink-0 text-ink-3" />
              </button>
            </li>
          )}
        </ul>
      </div>

      <PanelLateral
        abierto={edicion !== null}
        onCerrar={() => setEdicion(null)}
        titulo={edicion?.tipo === "plantilla" ? `Editar · ${edicion.plantilla.nombre}` : "Editar · Pie de los correos"}
        ancho={1000}
      >
        {edicion && data && <Editor edicion={edicion} datos={data} onListo={() => setEdicion(null)} />}
      </PanelLateral>
    </section>
  );
}

type CampoTexto = "asunto" | "cuerpo" | "pie";

function BotonFormato({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: ReactNode }) {
  return (
    // onMouseDown: que el clic no le quite la selección al texto.
    <button type="button" title={titulo} aria-label={titulo} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-[8px] border border-border bg-card text-[14px] text-strong hover:border-navy/40">
      {children}
    </button>
  );
}

function useRetrasado<T>(valor: T, ms: number) {
  const [retrasado, setRetrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setRetrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return retrasado;
}

function Editor({ edicion, datos, onListo }: { edicion: Edicion; datos: PlantillasRespuesta; onListo: () => void }) {
  const queryClient = useQueryClient();
  const esPie = edicion.tipo === "pie";
  // El pie se previsualiza dentro del correo 1, que es el que más gente recibe.
  const base = edicion.tipo === "plantilla" ? edicion.plantilla : datos.plantillas[0]!;
  const [asunto, setAsunto] = useState(base.asunto);
  const [cuerpo, setCuerpo] = useState(base.cuerpo);
  const [pie, setPie] = useState(datos.pie.texto);
  const [error, setError] = useState<string | null>(null);
  const asuntoRef = useRef<HTMLInputElement>(null);
  const cuerpoRef = useRef<HTMLTextAreaElement>(null);
  const pieRef = useRef<HTMLTextAreaElement>(null);
  const ultimoCampo = useRef<CampoTexto>(esPie ? "pie" : "cuerpo");
  // Barra de formato: el enlace pide la dirección en una fila aparte.
  const [enlace, setEnlace] = useState<{ inicio: number; fin: number; url: string } | null>(null);

  const cambio = esPie ? pie.trim() !== datos.pie.texto : asunto.trim() !== base.asunto || cuerpo.trim() !== base.cuerpo;
  const borrador = useRetrasado({ asunto, cuerpo, pie }, 400);
  const vista = useQuery({
    queryKey: ["plantillas", "vista-previa", borrador],
    queryFn: () => api.post<CorreoArmado>("/api/v1/plantillas/vista-previa", borrador),
    placeholderData: keepPreviousData,
    retry: false
  });

  const guardar = useMutation({
    mutationFn: () => (esPie ? api.put("/api/v1/plantillas/pie", { texto: pie }) : api.put(`/api/v1/plantillas/${base.numero}`, { asunto, cuerpo })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["plantillas"] });
      onListo();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo guardar")
  });

  function campo(c: CampoTexto) {
    if (c === "asunto") return { el: asuntoRef.current, valor: asunto, poner: setAsunto };
    if (c === "cuerpo") return { el: cuerpoRef.current, valor: cuerpo, poner: setCuerpo };
    return { el: pieRef.current, valor: pie, poner: setPie };
  }

  // Cambia [inicio, fin) del campo por `texto` y deja seleccionado
  // [selInicio, selFin) (relativo a `inicio`).
  function reemplazar(c: CampoTexto, inicio: number, fin: number, texto: string, selInicio = texto.length, selFin = selInicio) {
    const { el, valor, poner } = campo(c);
    poner(valor.slice(0, inicio) + texto + valor.slice(fin));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(inicio + selInicio, inicio + selFin);
    });
  }

  function seleccion(c: CampoTexto) {
    const { el, valor } = campo(c);
    return { inicio: el?.selectionStart ?? valor.length, fin: el?.selectionEnd ?? valor.length, valor };
  }

  // Mete {{variable}} donde está el cursor del último campo que se tocó.
  function insertar(clave: string) {
    const { inicio, fin } = seleccion(ultimoCampo.current);
    reemplazar(ultimoCampo.current, inicio, fin, `{{${clave}}}`);
  }

  // Negrita y cursiva envuelven lo seleccionado (o "texto", ya seleccionado
  // para escribir encima). Solo en el texto y el pie: el asunto va sin formato.
  const campoConFormato: CampoTexto = esPie ? "pie" : "cuerpo";
  function envolver(marca: string) {
    const { inicio, fin, valor } = seleccion(campoConFormato);
    const relleno = valor.slice(inicio, fin) || "texto";
    reemplazar(campoConFormato, inicio, fin, `${marca}${relleno}${marca}`, marca.length, marca.length + relleno.length);
  }

  function abrirEnlace() {
    const { inicio, fin } = seleccion(campoConFormato);
    setEnlace({ inicio, fin, url: "https://" });
  }

  function ponerEnlace() {
    if (!enlace) return;
    const url = enlace.url.trim();
    const etiqueta = campo(campoConFormato).valor.slice(enlace.inicio, enlace.fin) || url;
    reemplazar(campoConFormato, enlace.inicio, enlace.fin, `[${etiqueta}](${url})`);
    setEnlace(null);
  }
  const urlValida = /^https?:\/\/[^\s(){}<>"]+\.[^\s(){}<>"]+$/.test(enlace?.url.trim() ?? "");

  function atajos(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tecla = e.key.toLowerCase();
    if (tecla === "b") { e.preventDefault(); envolver("**"); }
    if (tecla === "i") { e.preventDefault(); envolver("*"); }
    if (tecla === "k") { e.preventDefault(); abrirEnlace(); }
  }

  const barra = (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <BotonFormato titulo="Negrita (Ctrl+B)" onClick={() => envolver("**")}><b>B</b></BotonFormato>
        <BotonFormato titulo="Cursiva (Ctrl+I)" onClick={() => envolver("*")}><i className="font-serif">I</i></BotonFormato>
        <BotonFormato titulo="Enlace (Ctrl+K)" onClick={abrirEnlace}>
          <Icono d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1 M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" size={15} />
        </BotonFormato>
        <small className="ml-2 hidden text-[11px] text-ink-3 sm:inline">Selecciona el texto y elige el formato</small>
      </div>
      {enlace && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-soft p-2">
          <input
            autoFocus
            aria-label="Dirección del enlace"
            className={`${inputClass} !w-auto min-w-0 flex-1`}
            value={enlace.url}
            onChange={(e) => setEnlace({ ...enlace, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && urlValida) { e.preventDefault(); ponerEnlace(); }
              if (e.key === "Escape") { e.preventDefault(); setEnlace(null); }
            }}
          />
          <Button className="!px-3 !py-2" disabled={!urlValida} onClick={ponerEnlace}>Poner enlace</Button>
          <Button variant="ghost" className="!px-3 !py-2" onClick={() => setEnlace(null)}>Cancelar</Button>
        </div>
      )}
    </div>
  );

  const errorVista = vista.error instanceof ApiError ? vista.error.message : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        {!esPie && <p className="text-[12.5px] text-ink-3">{CUANDO_SALE[base.numero]}.</p>}
        {esPie ? (
          <Field label="Pie (va al final de los tres correos)" htmlFor="plantilla-pie">
            {barra}
            <textarea ref={pieRef} id="plantilla-pie" rows={5} maxLength={1000} className={inputClass} value={pie} onKeyDown={atajos} onChange={(e) => setPie(e.target.value)} placeholder={"NANOBRIDGE · Domicilio\nAviso de privacidad: https://…"} />
          </Field>
        ) : (
          <>
            <Field label="Asunto" htmlFor="plantilla-asunto">
              <input ref={asuntoRef} id="plantilla-asunto" maxLength={200} className={inputClass} value={asunto} onFocus={() => (ultimoCampo.current = "asunto")} onChange={(e) => setAsunto(e.target.value)} />
            </Field>
            <Field label="Texto (una línea en blanco separa párrafos)" htmlFor="plantilla-cuerpo">
              {barra}
              <textarea ref={cuerpoRef} id="plantilla-cuerpo" rows={14} maxLength={5000} className={inputClass} value={cuerpo} onKeyDown={atajos} onFocus={() => (ultimoCampo.current = "cuerpo")} onChange={(e) => setCuerpo(e.target.value)} />
            </Field>
          </>
        )}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-2">Datos del prospecto (clic para insertar)</p>
          <div className="flex flex-wrap gap-1.5">
            {datos.variables.map((v) => (
              <button key={v.clave} type="button" title={v.descripcion} onClick={() => insertar(v.clave)} className="rounded-full border border-border bg-soft px-2.5 py-1 font-mono text-[11.5px] text-navy hover:border-navy/40">
                {`{{${v.clave}}}`}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-3">Si el prospecto no tiene ese dato, se quita solo (“Hola,” sin nombre).</p>
        </div>
        <ServerError message={error} />
        <div className="flex gap-2">
          <Button disabled={!cambio || guardar.isPending} onClick={() => { setError(null); guardar.mutate(); }}>
            {guardar.isPending ? "Guardando…" : "Guardar"}
          </Button>
          <Button variant="outline" onClick={onListo}>Cancelar</Button>
        </div>
      </div>

      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-semibold text-ink-2">Vista previa (con datos de ejemplo)</p>
        <div className="rounded-[14px] border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <small className="block text-[11px] text-ink-3">De: NANOBRIDGE</small>
            <b className="block text-[14px] text-strong">{vista.data?.asunto ?? "…"}</b>
          </div>
          {errorVista ? (
            <p className="px-4 py-4 text-[13px] text-danger">{errorVista}</p>
          ) : (
            // El html lo arma la API con todo el texto escapado (shared/plantillas.ts).
            <div className="space-y-3 px-4 py-4 text-[13.5px] leading-relaxed text-ink [&_a]:text-navy [&_a]:underline [&_strong]:font-bold" dangerouslySetInnerHTML={{ __html: vista.data?.html ?? "" }} />
          )}
          <p className="border-t border-dashed border-border px-4 py-2.5 text-[11.5px] text-ink-3">Al final, SendGrid agrega el enlace para darse de baja.</p>
        </div>
      </div>
    </div>
  );
}
