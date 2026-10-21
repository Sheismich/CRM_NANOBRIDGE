import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { ContactoForm } from "../components/empresas/ContactoForm";
import { EmpresaForm } from "../components/empresas/EmpresaForm";
import { TAMANOS } from "../components/empresas/campos";
import { CotizacionesTab } from "../components/ficha/CotizacionesTab";
import { DocumentosTab } from "../components/ficha/DocumentosTab";
import { HistorialTab } from "../components/ficha/HistorialTab";
import { OportunidadesTab } from "../components/ficha/OportunidadesTab";
import { ResumenIa } from "../components/ficha/ResumenIa";
import { TareasEmpresa } from "../components/ficha/TareasEmpresa";
import { NuevaTareaForm } from "../components/tareas/NuevaTareaForm";
import { useOportunidadesEmpresa } from "../components/ficha/queries";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { EnlaceExterno } from "../components/ui/Enlaces";
import { ServerError } from "../components/ui/Field";
import { Icono } from "../components/ui/Icono";
import { LogoEmpresa } from "../components/ui/LogoEmpresa";
import { MarcaDeAgua } from "../components/ui/MarcaDeAgua";
import { Modal } from "../components/ui/Modal";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Pastilla } from "../components/ui/Pastilla";
import { Segmento } from "../components/ui/Segmento";
import { Tarjeta } from "../components/ui/Tarjeta";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { fechaCorta, prospeccionEmpresa } from "../lib/empresas";
import { fechaLocal, formatoFecha, formatoMonedaEntera } from "../lib/formato";
import { ETIQUETA_MEDIO, claseMedio } from "../lib/medios";
import type { ContactoConMedio, EmpresaFicha, Paginated, TimelineEvento, Usuario } from "../types";

// Ficha de empresa del rediseño (docs/diseno/empresas.html, "Ficha de
// empresa"): encabezado con la N de marca de agua y cuatro datos, y abajo
// Resumen (contactos, historial, oportunidades abiertas y datos) más las
// pestañas Oportunidades, Cotizaciones y Documentos. ?tab= abre una
// pestaña directo: desde Documentos se llega con ?tab=documentos (y aquí
// sale "← Documentos" para regresar). "info" e "historial" (las pestañas de
// antes) caen en Resumen.
const TABS = ["resumen", "oportunidades", "cotizaciones", "documentos"] as const;
type TabId = (typeof TABS)[number];

// Agrupa las filas de GET /empresas/:id (una por medio de contacto) en un
// contacto con su arreglo de medios -- ver el comentario en types.ts sobre
// por qué esta respuesta no viene ya anidada como la de /contactos.
function agruparContactos(filas: ContactoConMedio[]) {
  const porId = new Map<number, { contacto: ContactoConMedio; medios: ContactoConMedio[] }>();
  for (const fila of filas) {
    const entry = porId.get(fila.id) ?? { contacto: fila, medios: [] };
    if (fila.medio_tipo) entry.medios.push(fila);
    porId.set(fila.id, entry);
  }
  return [...porId.values()];
}

// Un id que no es entero positivo (/empresas/abc) ni se le pregunta a la
// API: la respuesta sería un 400 y la pantalla se vería igual que "no
// encontrada".
export function FichaClientePage() {
  const { id } = useParams<{ id: string }>();
  if (!id || !/^[1-9]\d{0,9}$/.test(id)) {
    return (
      <AppShell titulo="Ficha de empresa">
        <div className="text-sm text-danger">No se encontró la empresa (o no tienes acceso a ella).</div>
      </AppShell>
    );
  }
  return <FichaCliente id={id} />;
}

function FichaCliente({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t === params.get("tab")) ?? "resumen";
  const setTab = (nuevo: TabId) => setParams(nuevo === "resumen" ? {} : { tab: nuevo }, { replace: true });

  const { data: empresa, isPending, isError } = useQuery({
    queryKey: ["empresa", id],
    queryFn: () => api.get<EmpresaFicha>(`/api/v1/empresas/${id}`)
  });
  const { data: timeline } = useQuery({
    queryKey: ["timeline", Number(id)],
    queryFn: () => api.get<{ data: TimelineEvento[] }>("/api/v1/actividades", { empresaId: Number(id), limit: 100 })
  });
  const { data: oportunidades } = useOportunidadesEmpresa(Number(id));

  const { user } = useAuth();
  // DELETE /empresas/:id es solo administrador/supervisor; editar y
  // gestionar contactos lo puede hacer también el agente dueño.
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";
  // El nombre del responsable: GET /empresas/:id solo trae su id. Un agente
  // solo abre las suyas; admin y supervisor ven la lista de usuarios.
  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    enabled: esAdminOSupervisor
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editandoEmpresa, setEditandoEmpresa] = useState(false);
  const [creandoTarea, setCreandoTarea] = useState(false);
  const [confirmarBaja, setConfirmarBaja] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);

  async function desactivarEmpresa() {
    if (!empresa) return;
    setAccionError(null);
    try {
      await api.delete(`/api/v1/empresas/${empresa.id}`);
      await queryClient.invalidateQueries({ queryKey: ["empresas"] });
      navigate("/empresas");
    } catch (error) {
      setConfirmarBaja(false);
      setAccionError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  const contactos = useMemo(() => (empresa ? agruparContactos(empresa.contactos) : []), [empresa]);
  // Para los selects de "contacto" de los formularios: solo activos (el
  // backend rechaza una oportunidad con un contacto desactivado).
  const opcionesContacto = useMemo(() => contactos.filter(({ contacto }) => contacto.activo).map(({ contacto }) => ({ id: contacto.id, nombre: contacto.nombre })), [contactos]);
  const abiertas = (oportunidades?.data ?? []).filter((o) => !o.cerrada);
  const pipeline = abiertas.reduce((s, o) => s + Number(o.valor_estimado ?? 0), 0);
  const ultima = timeline?.data[0]?.fecha ?? null;
  const nombreDe = (id: number | null) => (id == null ? null : id === user?.id ? (user?.nombre ?? null) : (usuarios?.data.find((u) => u.id === id)?.nombre ?? null));
  const responsable = nombreDe(empresa?.propietario_id ?? null);

  return (
    <AppShell titulo={empresa?.nombre_legal ?? "Ficha de empresa"} encabezado={null}>
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se encontró la empresa (o no tienes acceso a ella).</div>}

      {empresa && (
        <div className="flex flex-col gap-4 md:gap-5">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
            {tab === "documentos" ? (
              <Link to="/documentos" className="inline-flex items-center gap-1.5 font-bold text-navy hover:underline">
                <Icono nombre="flechaIzquierda" size={14} /> Documentos
              </Link>
            ) : (
              <Link to="/empresas" className="hover:text-strong hover:underline">
                Empresas
              </Link>
            )}
            <span>›</span>
            <b className="min-w-0 truncate text-strong">{empresa.nombre_legal}</b>
          </div>

          <Encabezado
            empresa={empresa}
            responsable={responsable}
            contactosActivos={opcionesContacto.length}
            pipeline={pipeline}
            ultima={ultima}
            acciones={
              <>
                <Button onClick={() => setTab("oportunidades")}>+ Oportunidad</Button>
                {/* "Nueva tarea" (lo que hay que hacer); lo que ya pasó se anota en
                    el Historial (revisión de Fabián, 15-oct-2026). */}
                <Button variant="outline" onClick={() => setCreandoTarea(true)}>
                  Nueva tarea
                </Button>
                <Button variant="outline" onClick={() => setEditandoEmpresa(true)}>
                  Editar
                </Button>
                {esAdminOSupervisor && (
                  <Button variant="peligro" onClick={() => setConfirmarBaja(true)}>
                    Desactivar
                  </Button>
                )}
              </>
            }
          />

          <ServerError message={accionError} />

          <Segmento
            etiqueta="Secciones de la ficha"
            valor={tab}
            onCambiar={setTab}
            opciones={[
              { id: "resumen", texto: "Resumen" },
              { id: "oportunidades", texto: "Oportunidades", cuenta: abiertas.length || undefined },
              { id: "cotizaciones", texto: "Cotizaciones" },
              { id: "documentos", texto: "Documentos" }
            ]}
          />

          {tab === "resumen" && (
            <div className="grid grid-cols-1 gap-4 md:gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-4 md:gap-5">
                <TarjetaContactos empresaId={empresa.id} contactos={contactos} />
                <HistorialTab empresaId={empresa.id} contactos={opcionesContacto} />
              </div>
              <div className="flex min-w-0 flex-col gap-4 md:gap-5">
                <ResumenIa empresaId={empresa.id} />
                <Tarjeta
                  titulo="Oportunidades"
                  icono="bandera"
                  color="menta"
                  extra={
                    <button type="button" className="font-bold text-navy hover:underline" onClick={() => setTab("oportunidades")}>
                      {abiertas.length === 1 ? "1 abierta" : `${abiertas.length} abiertas`} ›
                    </button>
                  }
                >
                  {abiertas.length === 0 && <div className="text-[13px] text-ink-3">Sin oportunidades abiertas. Créala con + Oportunidad.</div>}
                  <ul className="flex flex-col gap-2.5">
                    {abiertas.slice(0, 4).map((o) => (
                      <li key={o.id} className="rounded-[12px] border border-border p-3">
                        <div className="text-[14px] font-bold text-strong">{o.titulo}</div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="flex flex-1 gap-1">
                            {[25, 50, 75, 100].map((tope) => (
                              <i key={tope} className={`h-1.5 flex-1 rounded-full ${o.probabilidad >= tope - 24 ? "bg-[linear-gradient(90deg,var(--mint),var(--cyan))]" : "bg-border"}`} />
                            ))}
                          </span>
                          <span className="text-[12px] font-bold text-ink-2">{o.etapa_nombre}</span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between gap-2">
                          <b className="mono text-[15px] text-strong">{o.valor_estimado ? formatoMonedaEntera.format(Number(o.valor_estimado)) : "—"}</b>
                          <span className="text-[12px] text-ink-3">
                            {o.probabilidad}%{o.fecha_cierre_estimada ? ` · cierre ${formatoFecha.format(fechaLocal(o.fecha_cierre_estimada))}` : ""}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Tarjeta>
                <TareasEmpresa empresaId={empresa.id} nombreDe={nombreDe} onNueva={() => setCreandoTarea(true)} />
                <Tarjeta titulo="Datos" icono="info" color="lila">
                  <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
                    <Campo etiqueta="Nombre legal">{empresa.nombre_legal}</Campo>
                    <Campo etiqueta="Comercial">{empresa.nombre_comercial}</Campo>
                    <Campo etiqueta="Giro">{empresa.giro}</Campo>
                    <Campo etiqueta="Tamaño">{empresa.tamano ? (TAMANOS.find((t) => t.valor === empresa.tamano)?.etiqueta ?? empresa.tamano) : null}</Campo>
                    <Campo etiqueta="Ubicación">{[empresa.ciudad, empresa.estado, empresa.region, empresa.pais].filter(Boolean).join(", ") || null}</Campo>
                    <Campo etiqueta="Sitio web">{empresa.sitio_web && <EnlaceExterno url={empresa.sitio_web} />}</Campo>
                    <Campo etiqueta="LinkedIn">{empresa.linkedin_url && <EnlaceExterno url={empresa.linkedin_url} />}</Campo>
                    <Campo etiqueta="Facebook">{empresa.facebook_url && <EnlaceExterno url={empresa.facebook_url} />}</Campo>
                    <Campo etiqueta="Instagram">{empresa.instagram_url && <EnlaceExterno url={empresa.instagram_url} />}</Campo>
                    <Campo etiqueta="Fuente">{empresa.fuente_url && <EnlaceExterno url={empresa.fuente_url} />}</Campo>
                    <Campo etiqueta="Alta">{formatoFecha.format(new Date(empresa.creado_en))}</Campo>
                  </dl>
                </Tarjeta>
              </div>
            </div>
          )}
          {tab === "oportunidades" && <OportunidadesTab empresaId={empresa.id} contactos={opcionesContacto} />}
          {tab === "cotizaciones" && <CotizacionesTab empresaId={empresa.id} contactos={opcionesContacto} />}
          {/* El expediente/documentos lo hace Fabián (Documentos); aquí solo se coloca. */}
          {tab === "documentos" && <DocumentosTab empresaId={empresa.id} contactos={opcionesContacto} />}

          <PanelLateral
            abierto={editandoEmpresa}
            onCerrar={() => setEditandoEmpresa(false)}
            encabezado={<h2 className="pt-1 font-heading text-[20px] font-black text-strong">Editar empresa</h2>}
            cuerpoClassName="!p-0"
          >
            <EmpresaForm enPanel empresa={empresa} onDone={() => setEditandoEmpresa(false)} />
          </PanelLateral>
          <PanelLateral abierto={creandoTarea} onCerrar={() => setCreandoTarea(false)} titulo="Nueva tarea" cuerpoClassName="!p-0">
            {user && (
              <NuevaTareaForm
                usuarioActual={{ id: user.id, nombre: user.nombre }}
                usuarios={esAdminOSupervisor ? usuarios?.data.filter((u) => u.rol !== "sistema") : undefined}
                empresa={{ id: empresa.id, nombre: empresa.nombre_comercial ?? empresa.nombre_legal }}
                onDone={() => setCreandoTarea(false)}
              />
            )}
          </PanelLateral>
          <Modal
            abierto={confirmarBaja}
            onCerrar={() => setConfirmarBaja(false)}
            titulo="¿Desactivar la empresa?"
            descripcion={`«${empresa.nombre_legal}» dejará de aparecer en el CRM junto con sus contactos, y sus medios ya no se usarán en campañas.`}
            acciones={
              <>
                <Button variant="ghost" onClick={() => setConfirmarBaja(false)}>
                  No, dejarla
                </Button>
                <Button variant="rechazar" onClick={() => void desactivarEmpresa()}>
                  Sí, desactivar
                </Button>
              </>
            }
          />
        </div>
      )}
    </AppShell>
  );
}

function Encabezado({
  empresa,
  responsable,
  contactosActivos,
  pipeline,
  ultima,
  acciones
}: {
  empresa: EmpresaFicha;
  responsable: string | null;
  contactosActivos: number;
  pipeline: number;
  ultima: string | null;
  acciones: ReactNode;
}) {
  const tamano = empresa.tamano ? (TAMANOS.find((t) => t.valor === empresa.tamano)?.etiqueta ?? empresa.tamano).toLowerCase() : null;
  const lugar = [empresa.ciudad, empresa.estado].filter(Boolean).join(", ");
  // En qué va su prospección, igual que en la lista (GET /empresas/:id la
  // trae desde el 15-oct-2026); nada si nunca fue prospecto.
  const pros = empresa.prospeccion ? prospeccionEmpresa(empresa.prospeccion) : null;
  const redes: [string, string | null][] = [
    ["in", empresa.linkedin_url],
    ["f", empresa.facebook_url],
    ["ig", empresa.instagram_url]
  ];
  return (
    <section className="tarjeta-blanca relative overflow-hidden">
      <MarcaDeAgua className="-right-10 -top-[60px] w-[260px] md:-right-[30px] md:-top-[80px] md:w-[340px]" />
      <div className="relative flex flex-wrap items-start gap-4 px-4 pb-4 pt-5 md:px-7 md:pt-7">
        <LogoEmpresa id={empresa.id} nombre={empresa.nombre_legal} tamano="ficha" />
        <div className="min-w-0 flex-[1_1_16rem]">
          <h1 className="font-heading text-[22px] font-black tracking-[-0.5px] text-strong md:text-[28px]">{empresa.nombre_legal}</h1>
          <div className="mt-1 text-[13px] text-ink-2">
            {[empresa.nombre_comercial, empresa.giro ?? "sin giro", tamano, lugar].filter(Boolean).join(" · ")}
            {empresa.sitio_web && (
              <>
                {" · "}
                <a href={empresa.sitio_web} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy hover:underline">
                  {empresa.sitio_web.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              </>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {pros && (
              <Pastilla tono={pros.tono} punto>
                {pros.texto}
              </Pastilla>
            )}
            {redes
              .filter((r): r is [string, string] => Boolean(r[1]))
              .map(([etiqueta, url]) => (
                <a key={etiqueta} href={url} target="_blank" rel="noopener noreferrer" className="grid h-7 min-w-7 place-items-center rounded-[8px] border border-border bg-card px-1.5 text-[11px] font-extrabold text-ink-2 hover:text-strong">
                  {etiqueta}
                </a>
              ))}
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">{acciones}</div>
      </div>
      <div className="relative grid grid-cols-2 border-t border-border md:grid-cols-4">
        <Kpi etiqueta="Responsable">
          <span className="flex min-w-0 items-center gap-2">
            <Avatar nombre={responsable} />
            <span className="truncate">{responsable ?? (empresa.propietario_id ? "Asignada" : "Sin responsable")}</span>
          </span>
        </Kpi>
        <Kpi etiqueta="Contactos">{contactosActivos === 1 ? "1 activo" : `${contactosActivos} activos`}</Kpi>
        <Kpi etiqueta="Pipeline">{pipeline > 0 ? formatoMonedaEntera.format(pipeline) : "—"}</Kpi>
        <Kpi etiqueta="Última actividad">{ultima ? fechaCorta(ultima) : "Nunca"}</Kpi>
      </div>
    </section>
  );
}

function Kpi({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-border px-4 py-3.5 even:border-l md:border-l md:px-7 md:first:border-l-0">
      <small className="block font-heading text-[11px] font-extrabold uppercase tracking-[1px] text-ink-3">{etiqueta}</small>
      <b className="mt-1 block truncate text-[14px] text-strong">{children}</b>
    </div>
  );
}

type ContactoAgrupado = ReturnType<typeof agruparContactos>[number];

function TarjetaContactos({ empresaId, contactos }: { empresaId: number; contactos: ContactoAgrupado[] }) {
  const queryClient = useQueryClient();
  const [agregando, setAgregando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [porDesactivar, setPorDesactivar] = useState<ContactoAgrupado | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function desactivar(c: ContactoAgrupado) {
    setError(null);
    try {
      await api.delete(`/api/v1/empresas/${empresaId}/contactos/${c.contacto.id}`);
      await queryClient.invalidateQueries({ queryKey: ["empresa", String(empresaId)] });
      await queryClient.invalidateQueries({ queryKey: ["contactos"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setPorDesactivar(null);
    }
  }

  return (
    <Tarjeta
      titulo={`Contactos · ${contactos.length}`}
      icono="equipo"
      extra={
        !agregando && (
          <button
            type="button"
            className="font-bold text-navy hover:underline"
            onClick={() => {
              setAgregando(true);
              setEditandoId(null);
            }}
          >
            + Agregar
          </button>
        )
      }
      cuerpoClassName="!p-0"
    >
      <ServerError message={error} />
      {agregando && (
        <div className="p-4 md:px-[22px]">
          <ContactoForm empresaId={empresaId} onDone={() => setAgregando(false)} />
        </div>
      )}
      {contactos.length === 0 && !agregando && <div className="px-4 py-5 text-[13px] text-ink-3 md:px-[22px]">Sin contactos registrados.</div>}
      <ul className="divide-y divide-border">
        {contactos.map((agrupado) => {
          const { contacto, medios } = agrupado;
          if (editandoId === contacto.id) {
            return (
              <li key={contacto.id} className="p-4 md:px-[22px]">
                <ContactoForm empresaId={empresaId} contacto={agrupado} onDone={() => setEditandoId(null)} />
              </li>
            );
          }
          const sinMedioActivo = medios.every((m) => m.estado_contacto !== "activo");
          return (
            <li key={contacto.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5 md:px-[22px]">
              <Avatar nombre={contacto.nombre} className={sinMedioActivo ? "!bg-none !bg-soft !text-ink-3" : ""} />
              <div className="min-w-0 flex-[1_1_12rem]">
                <b className="block text-[14px] text-strong">{contacto.nombre}</b>
                {(contacto.puesto || contacto.area) && <small className="block text-[12px] text-ink-3">{[contacto.puesto, contacto.area].filter(Boolean).join(" · ")}</small>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {medios.map((m) => (
                    <span key={m.medio_id} className={`max-w-full break-all rounded-full px-2.5 py-1 text-[11px] font-semibold ${claseMedio(m.estado_contacto)}`}>
                      {ETIQUETA_MEDIO[m.medio_tipo ?? ""] ?? m.medio_tipo}: {m.medio_valor}
                      {m.estado_contacto === "no_contactar" && " · no contactar"}
                    </span>
                  ))}
                  {medios.length === 0 && <span className="rounded-full bg-warn-bg px-2.5 py-1 text-[11px] font-semibold text-warn">Sin medio de contacto</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded-[8px] px-2 py-1 text-[12px] font-bold text-navy hover:bg-soft"
                  onClick={() => {
                    setEditandoId(contacto.id);
                    setAgregando(false);
                  }}
                >
                  Editar
                </button>
                <button type="button" className="rounded-[8px] px-2 py-1 text-[12px] font-bold text-danger hover:bg-danger-bg" onClick={() => setPorDesactivar(agrupado)}>
                  Desactivar
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <Modal
        abierto={porDesactivar !== null}
        onCerrar={() => setPorDesactivar(null)}
        titulo="¿Desactivar el contacto?"
        descripcion={porDesactivar ? `Los medios de «${porDesactivar.contacto.nombre}» ya no se usarán.` : undefined}
        acciones={
          <>
            <Button variant="ghost" onClick={() => setPorDesactivar(null)}>
              No
            </Button>
            <Button variant="rechazar" onClick={() => porDesactivar && void desactivar(porDesactivar)}>
              Sí, desactivar
            </Button>
          </>
        }
      />
    </Tarjeta>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-strong">{children || <span className="text-ink-3">—</span>}</dd>
    </>
  );
}
