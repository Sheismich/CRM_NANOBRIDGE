import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AppShell } from "../components/layout/AppShell";
import { BuscadorEmpresa, EmpresaElegida } from "../components/empresas/BuscadorEmpresa";
import { ContactoForm } from "../components/empresas/ContactoForm";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { Contador } from "../components/ui/Contador";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { EstadoVacio } from "../components/ui/EstadoVacio";
import { inputBaseClass } from "../components/ui/Field";
import { Icono } from "../components/ui/Icono";
import { LogoEmpresa } from "../components/ui/LogoEmpresa";
import { MarcaDeAgua } from "../components/ui/MarcaDeAgua";
import { Paginacion } from "../components/ui/Paginacion";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Pastilla } from "../components/ui/Pastilla";
import { Segmento } from "../components/ui/Segmento";
import { api } from "../lib/api";
import { prospeccionEmpresa } from "../lib/empresas";
import type { ConteosContactos, ContactoFila, Empresa, Paginated } from "../types";

// Contactos del rediseño (docs/diseno/contactos.html, opción A con "Lista |
// Tarjetas"): las personas, cómo localizarlas y si se les puede escribir.
// Un agente solo ve los contactos de sus empresas (lo filtra el backend).
// El alta pide primero la empresa: un contacto siempre es de una.

const LIMIT = 25;
type Vista = "lista" | "tarjetas";
type Estado = "" | "escribible" | "no_contactar" | "sin_medio";
const CLAVE_VISTA = "crm-contactos-vista";

function vistaGuardada(): Vista {
  try {
    return localStorage.getItem(CLAVE_VISTA) === "tarjetas" ? "tarjetas" : "lista";
  } catch {
    return "lista";
  }
}

export function ContactosPage() {
  const [q, setQ] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<Estado>("");
  const [page, setPage] = useState(1);
  const [vista, setVistaEstado] = useState<Vista>(vistaGuardada);
  const [creando, setCreando] = useState(false);

  function setVista(v: Vista) {
    setVistaEstado(v);
    try {
      localStorage.setItem(CLAVE_VISTA, v);
    } catch {
      // Sin almacenamiento: dura hasta recargar.
    }
  }
  function cambiar(fn: () => void) {
    setPage(1);
    fn();
  }

  const filtros = { q: busqueda || undefined, estado: estado || undefined, page, limit: LIMIT };
  const { data, isPending, isError } = useQuery({
    queryKey: ["contactos", filtros],
    queryFn: () => api.get<Paginated<ContactoFila>>("/api/v1/contactos", filtros)
  });
  const { data: conteos } = useQuery({
    queryKey: ["contactos", "conteos"],
    queryFn: () => api.get<ConteosContactos>("/api/v1/contactos/conteos")
  });
  const hayFiltros = Boolean(busqueda || estado);
  const alternar = (e: Exclude<Estado, "">) => () => cambiar(() => setEstado(estado === e ? "" : e));

  return (
    <AppShell
      titulo="Contactos"
      encabezado={
        <EncabezadoPagina
          titulo="Contactos"
          subtitulo="Las personas: cómo localizarlas y si se les puede escribir."
          acciones={
            <Button className="w-full md:w-auto" onClick={() => setCreando(true)}>
              + Nuevo contacto
            </Button>
          }
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
          <Contador etiqueta="Total" valor={conteos?.total ?? "…"} detalle="personas" tono="navy" seleccionado={!estado} onClick={() => cambiar(() => setEstado(""))} />
          <Contador etiqueta="Escribibles" valor={conteos?.escribibles ?? "…"} detalle="con medio activo" tono="ok" seleccionado={estado === "escribible"} onClick={alternar("escribible")} />
          <Contador etiqueta="No contactar" valor={conteos?.no_contactar ?? "…"} detalle="pidieron su baja" tono="danger" seleccionado={estado === "no_contactar"} onClick={alternar("no_contactar")} />
          <Contador etiqueta="Sin medio" valor={conteos?.sin_medio ?? "…"} detalle="sin correo ni teléfono" tono="warn" seleccionado={estado === "sin_medio"} onClick={alternar("sin_medio")} />
        </div>

        <form
          className="flex flex-wrap items-center gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            cambiar(() => setBusqueda(q.trim()));
          }}
        >
          <label className="flex h-10 min-w-0 flex-[1_1_100%] items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-ink-3 md:max-w-[440px] md:flex-[1_1_300px]">
            <Icono nombre="buscar" size={15} />
            <input
              aria-label="Buscar"
              placeholder="Buscar por nombre, correo, teléfono o empresa…"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-strong outline-none placeholder:text-ink-3"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => q.trim() !== busqueda && cambiar(() => setBusqueda(q.trim()))}
            />
          </label>
          <select aria-label="Estado" className={`${inputBaseClass} h-10 w-auto`} value={estado} onChange={(e) => cambiar(() => setEstado(e.target.value as Estado))}>
            <option value="">Estado: Todos</option>
            <option value="escribible">Se les puede escribir</option>
            <option value="no_contactar">No contactar</option>
            <option value="sin_medio">Sin medio válido</option>
          </select>
          <Segmento
            etiqueta="Vista"
            className="md:ml-auto md:!w-auto"
            valor={vista}
            onCambiar={setVista}
            opciones={[
              { id: "lista", texto: "Lista" },
              { id: "tarjetas", texto: "Tarjetas" }
            ]}
          />
        </form>

        {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="text-sm text-danger">No se pudieron cargar los contactos.</div>}
        {data && data.data.length === 0 && hayFiltros && <div className="tarjeta-blanca p-5 text-sm text-ink-3">No hay contactos con ese filtro.</div>}
        {data && data.data.length === 0 && !hayFiltros && page === 1 && (
          <EstadoVacio className="tarjeta-blanca p-5" titulo="Todavía no hay contactos." texto="Se dan de alta dentro de su empresa, o aquí con + Nuevo contacto." />
        )}

        {data && data.data.length > 0 && vista === "lista" && (
          <section className="tarjeta-blanca overflow-hidden">
            <ListaContactos contactos={data.data} />
            {(page > 1 || data.data.length === LIMIT) && (
              <div className="border-t border-border bg-soft">
                <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />
              </div>
            )}
          </section>
        )}
        {data && data.data.length > 0 && vista === "tarjetas" && (
          <>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
              {data.data.map((c) => (
                <TarjetaContacto key={c.id} contacto={c} />
              ))}
            </div>
            {(page > 1 || data.data.length === LIMIT) && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
          </>
        )}
      </div>

      <PanelLateral abierto={creando} onCerrar={() => setCreando(false)} titulo="Nuevo contacto">
        <NuevoContacto onDone={() => setCreando(false)} />
      </PanelLateral>
    </AppShell>
  );
}

// Primero la empresa, luego la persona (POST /empresas/:id/contactos).
function NuevoContacto({ onDone }: { onDone: () => void }) {
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  if (!empresa) return <BuscadorEmpresa pregunta="¿De qué empresa es el contacto?" onElegir={setEmpresa} />;
  return (
    <div className="flex flex-col gap-4">
      <EmpresaElegida empresa={empresa} onCambiar={() => setEmpresa(null)} />
      <ContactoForm empresaId={empresa.id} onDone={onDone} />
    </div>
  );
}

// --- Medios ------------------------------------------------------------------

const SIGNO_MEDIO: Record<string, string> = { correo: "✉", telefono: "☏", whatsapp: "W", linkedin: "in", sitio_web: "www", facebook: "f", instagram: "ig" };
const PARA_ESCRIBIR = new Set(["correo", "telefono", "whatsapp"]);

// Pastillas de color: verde activo, rojo no contactar, gris obsoleto (o las
// redes, que no sirven para escribir). Sin ningún medio para escribir sale
// el aviso ámbar.
function Medios({ medios }: { medios: ContactoFila["medios"] }) {
  const escribir = medios.filter((m) => PARA_ESCRIBIR.has(m.tipo));
  return (
    <div className="flex flex-wrap gap-1.5">
      {medios.map((m) => {
        const clase =
          m.estado_contacto === "no_contactar"
            ? "bg-danger-bg text-danger"
            : m.estado_contacto === "obsoleto"
              ? "bg-soft text-ink-3 line-through"
              : PARA_ESCRIBIR.has(m.tipo)
                ? "bg-ok-bg text-ok"
                : "border border-border bg-soft text-ink-2";
        return (
          <span
            key={m.id}
            className={clsx("inline-flex max-w-full items-center gap-1 break-all rounded-full px-2.5 py-1 text-[11px] font-semibold", clase)}
            title={m.estado_contacto === "no_contactar" ? "Pidió que no lo contacten por este medio" : m.estado_contacto === "obsoleto" ? "Ya no se usa" : undefined}
          >
            <span className="shrink-0 font-extrabold">{SIGNO_MEDIO[m.tipo] ?? m.tipo}</span>
            {m.tipo === "linkedin" ? "LinkedIn" : m.valor}
          </span>
        );
      })}
      {escribir.length === 0 && <span className="rounded-full bg-warn-bg px-2.5 py-1 text-[11px] font-semibold text-warn">⚠ sin correo ni teléfono</span>}
    </div>
  );
}

function puedeEscribir(c: ContactoFila) {
  return c.medios.some((m) => PARA_ESCRIBIR.has(m.tipo) && m.estado_contacto === "activo");
}

// --- Lista ---------------------------------------------------------------------

function ListaContactos({ contactos }: { contactos: ContactoFila[] }) {
  const navigate = useNavigate();
  const abrir = (c: ContactoFila) => navigate(`/empresas/${c.empresa_id}`);
  return (
    <>
      <ul className="divide-y divide-border md:hidden">
        {contactos.map((c) => {
          const pros = prospeccionEmpresa(c.prospeccion);
          return (
            <li key={c.id}>
              <Link to={`/empresas/${c.empresa_id}`} className="flex flex-col gap-2 px-3.5 py-3 active:bg-soft">
                <div className="flex items-center gap-3">
                  <Avatar nombre={c.nombre} className={clsx("!h-9 !w-9 !text-[12px]", !puedeEscribir(c) && "opacity-60")} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[14px] text-strong">{c.nombre}</b>
                    <small className="block truncate text-[12px] text-ink-3">{[c.puesto, c.empresa_nombre].filter(Boolean).join(" · ")}</small>
                  </div>
                  <Pastilla tono={pros.tono} punto>
                    {pros.texto}
                  </Pastilla>
                </div>
                <Medios medios={c.medios} />
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="tabla-scroll hidden md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-soft">
              {["Persona", "Empresa", "Medios", "Prospección"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-heading text-[11px] font-extrabold uppercase tracking-[1px] text-ink-3 first:pl-[18px]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contactos.map((c) => {
              const pros = prospeccionEmpresa(c.prospeccion);
              return (
                <tr key={c.id} tabIndex={0} onClick={() => abrir(c)} onKeyDown={(e) => e.key === "Enter" && abrir(c)} className="cursor-pointer border-t border-border align-top hover:bg-soft">
                  <td className="px-4 py-3 pl-[18px]">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar nombre={c.nombre} className={clsx("!h-9 !w-9 !text-[12px]", !puedeEscribir(c) && "opacity-60")} />
                      <div className="min-w-0">
                        <b className="block truncate text-[14px] text-strong">{c.nombre}</b>
                        <small className="block truncate text-[12px] text-ink-3">{[c.puesto, c.area].filter(Boolean).join(" · ") || "—"}</small>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/empresas/${c.empresa_id}`} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-ink hover:underline">
                      <LogoEmpresa id={c.empresa_id} nombre={c.empresa_nombre} tamano="chico" className="!h-7 !w-7 !rounded-[8px] !text-[10px]" />
                      <span className="truncate">{c.empresa_nombre}</span>
                    </Link>
                  </td>
                  <td className="max-w-[420px] px-4 py-3">
                    <Medios medios={c.medios} />
                  </td>
                  <td className="px-4 py-3">
                    <Pastilla tono={pros.tono} punto>
                      {pros.texto}
                    </Pastilla>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Tarjetas --------------------------------------------------------------------

// Tarjeta de persona (opción B del diseño): franja de color de su empresa
// con la N, avatar, puesto, empresa y medios; abajo "Escribir" si tiene un
// correo activo, o "Agregar medio" (en la ficha) si no se le puede escribir.
function TarjetaContacto({ contacto: c }: { contacto: ContactoFila }) {
  const correo = c.medios.find((m) => m.tipo === "correo" && m.estado_contacto === "activo");
  const escribible = puedeEscribir(c);
  return (
    <section className={clsx("tarjeta-blanca flex flex-col overflow-hidden", !escribible && "opacity-80")}>
      <div className={clsx("relative h-[54px] overflow-hidden bg-[linear-gradient(120deg,var(--marca-navy),var(--marca-violet))]", !escribible && "grayscale")}>
        <MarcaDeAgua sobreOscuro girada={false} className="-right-3 -top-6 w-[110px]" />
      </div>
      <Avatar nombre={c.nombre} className="relative -mt-[29px] ml-[18px] !h-[58px] !w-[58px] border-[3px] border-card !text-[18px]" />
      <div className="flex flex-1 flex-col gap-2.5 px-[18px] pb-4 pt-2">
        <div>
          <h4 className="font-heading text-[16px] font-extrabold text-strong">{c.nombre}</h4>
          <div className="text-[12px] text-ink-3">{[c.puesto, c.area].filter(Boolean).join(" · ") || "—"}</div>
        </div>
        <Link to={`/empresas/${c.empresa_id}`} className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-ink hover:underline">
          <LogoEmpresa id={c.empresa_id} nombre={c.empresa_nombre} tamano="chico" className="!h-6 !w-6 !rounded-[7px] !text-[9px]" />
          <span className="truncate">{c.empresa_nombre}</span>
        </Link>
        <Medios medios={c.medios} />
      </div>
      <div className="flex gap-2 border-t border-border bg-soft px-[18px] py-3">
        {correo ? (
          <a href={`mailto:${correo.valor}`} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] font-extrabold text-strong hover:border-navy/40">
            <Icono nombre="correo" size={14} /> Escribir
          </a>
        ) : (
          <Link to={`/empresas/${c.empresa_id}`} className="inline-flex flex-1 items-center justify-center rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] font-extrabold text-strong hover:border-navy/40">
            Agregar medio
          </Link>
        )}
        <Link to={`/empresas/${c.empresa_id}`} className="inline-flex flex-1 items-center justify-center rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] font-extrabold text-strong hover:border-navy/40">
          Ver empresa
        </Link>
      </div>
    </section>
  );
}
