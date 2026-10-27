import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Icono } from "../ui/Icono";
import { useDialogo } from "../ui/dialogo";
import { NAV_ITEMS } from "../layout/nav-items";
import { buscarMas, ETIQUETA_GRUPO, GRUPOS, ligaDe, useBuscar, type FilaBuscador, type Grupo, type ResultadoGrupo } from "../../lib/buscar";

// Buscador general (etapa 5 de las mejoras, 21-oct-2026). Se abre con la
// caja del menú, Ctrl+K (Cmd+K en Mac) o la lupa de la barra del celular.
// En compu es una ventana arriba al centro; en el celular, pantalla
// completa. Flechas para moverse, Enter abre, Esc cierra. El contenido solo
// se monta mientras está abierto, así que cada vez empieza vacío.
export function Buscador({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const ref = useDialogo(abierto, onCerrar);
  return (
    <dialog
      ref={ref}
      aria-label="Buscar en el CRM"
      className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-card p-0 text-ink backdrop:bg-navy-ink/45 backdrop:backdrop-blur-[2px] md:mx-auto md:mb-auto md:mt-[10vh] md:h-auto md:max-h-[76vh] md:w-[min(640px,calc(100vw-24px))] md:rounded-[20px] md:border md:border-border md:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]"
    >
      {abierto && <Contenido onCerrar={onCerrar} />}
    </dialog>
  );
}

type Item = { grupo: Grupo; fila: FilaBuscador };

function Contenido({ onCerrar }: { onCerrar: () => void }) {
  const navigate = useNavigate();
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const { data, isPlaceholderData, isError } = useBuscar(q);
  // Lo que trajo "Ver más", solo mientras el texto sea el mismo.
  const [mas, setMas] = useState<{ q: string; porGrupo: Partial<Record<Grupo, ResultadoGrupo>> }>({ q: "", porGrupo: {} });
  const [cargandoMas, setCargandoMas] = useState<Grupo | null>(null);
  const [activo, setActivo] = useState(0);
  const [qVista, setQVista] = useState(q);
  if (q !== qVista) {
    setQVista(q);
    setActivo(0);
  }

  const extra = mas.q === q ? mas.porGrupo : {};
  const grupos = data
    ? GRUPOS.map((grupo) => ({
        grupo,
        filas: [...data[grupo].data, ...(extra[grupo]?.data ?? [])],
        hayMas: extra[grupo]?.hay_mas ?? data[grupo].hay_mas
      })).filter((g) => g.filas.length > 0)
    : [];
  const items: Item[] = grupos.flatMap((g) => g.filas.map((fila) => ({ grupo: g.grupo, fila })));
  const indiceActivo = Math.min(activo, Math.max(items.length - 1, 0));

  // El elegido con flechas siempre a la vista.
  useEffect(() => {
    document.getElementById(`buscador-${indiceActivo}`)?.scrollIntoView({ block: "nearest" });
  }, [indiceActivo]);

  function abrir(item: Item | undefined) {
    if (!item) return;
    onCerrar();
    navigate(ligaDe(item.grupo, item.fila));
  }

  async function verMas(grupo: Grupo, desde: number) {
    setCargandoMas(grupo);
    try {
      const nuevos = await buscarMas(q, grupo, desde);
      setMas((antes) => {
        const previos = antes.q === q ? antes.porGrupo : {};
        return { q, porGrupo: { ...previos, [grupo]: { data: [...(previos[grupo]?.data ?? []), ...nuevos.data], hay_mas: nuevos.hay_mas } } };
      });
    } finally {
      setCargandoMas(null);
    }
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setActivo((indiceActivo + paso + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      abrir(items[indiceActivo]);
    }
  }

  let posicion = 0;
  return (
    <div className="flex h-full flex-col md:max-h-[76vh]">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Icono nombre="buscar" size={18} className="shrink-0 text-ink-3" />
        <input
          data-autofocus
          role="combobox"
          aria-label="Buscar"
          aria-expanded={items.length > 0}
          aria-controls="buscador-resultados"
          aria-activedescendant={items.length > 0 ? `buscador-${indiceActivo}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Empresa, persona, correo, teléfono o #folio"
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-strong outline-none placeholder:text-ink-3"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
        />
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-soft hover:text-strong">
          <Icono nombre="cerrar" size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {texto.trim() === "" ? (
          <Mensaje>Busca en empresas, contactos, prospectos, oportunidades, cotizaciones y tareas.</Mensaje>
        ) : isError ? (
          <Mensaje>No se pudo buscar. Intenta de nuevo.</Mensaje>
        ) : !data ? (
          <Mensaje>Buscando…</Mensaje>
        ) : grupos.length === 0 ? (
          <Mensaje>Sin resultados para «{q}».</Mensaje>
        ) : (
          <div id="buscador-resultados" role="listbox" aria-label="Resultados">
            {grupos.map((g) => (
              <section key={g.grupo} role="group" aria-label={ETIQUETA_GRUPO[g.grupo]} className="pb-1.5">
                <div role="presentation" aria-hidden="true" className="px-3 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-ink-3">{ETIQUETA_GRUPO[g.grupo]}</div>
                {g.filas.map((fila) => {
                  const i = posicion++;
                  return (
                    <div
                      key={fila.id}
                      id={`buscador-${i}`}
                      role="option"
                      aria-selected={i === indiceActivo}
                      onMouseMove={() => i !== indiceActivo && setActivo(i)}
                      onClick={() => abrir({ grupo: g.grupo, fila })}
                      className={clsx("flex cursor-pointer items-center gap-3 rounded-[11px] px-3 py-2", i === indiceActivo && "bg-navy-bg")}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-soft text-ink-2">
                        <Icono d={NAV_ITEMS.find((n) => n.to === `/${g.grupo}`)?.icon} size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[14px] font-bold text-strong">{fila.titulo}</b>
                        {fila.detalle && <small className={clsx("block truncate text-[12px]", i === indiceActivo ? "text-ink-2" : "text-ink-3")}>{fila.detalle}</small>}
                      </span>
                    </div>
                  );
                })}
                {g.hayMas && (
                  <button
                    type="button"
                    disabled={cargandoMas !== null || isPlaceholderData}
                    onClick={() => void verMas(g.grupo, g.filas.length)}
                    className="ml-14 mt-0.5 rounded-[8px] px-1.5 py-1 text-[12.5px] font-bold text-navy hover:underline disabled:opacity-60"
                  >
                    {cargandoMas === g.grupo ? "Cargando…" : "Ver más"}
                  </button>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="hidden gap-4 border-t border-border px-4 py-2.5 text-[11.5px] text-ink-3 md:flex">
        <span><Tecla>↑</Tecla> <Tecla>↓</Tecla> para moverte</span>
        <span><Tecla>Enter</Tecla> para abrir</span>
        <span><Tecla>Esc</Tecla> para cerrar</span>
      </div>
    </div>
  );
}

function Mensaje({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-[13px] text-ink-3">{children}</p>;
}

export function Tecla({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[6px] border border-border bg-soft px-1.5 py-px font-sans text-[11px] font-bold text-ink-2">{children}</kbd>;
}
