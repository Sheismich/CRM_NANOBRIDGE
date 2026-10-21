import { useEffect, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { EncabezadoPagina } from "../ui/EncabezadoPagina";
import { Sidebar } from "./Sidebar";
import { BarraNavegacion, BarraSuperiorCelular, HojaMas } from "./BarrasCelular";
import { Buscador } from "../buscador/Buscador";

// Marco de todas las pantallas. Compu: menú lateral fijo y la página se
// desplaza sola. Celular (< 768 px): barra azul arriba y barra de
// navegación abajo (el contenido deja espacio para que no lo tape).
// - `titulo`: pestaña del navegador y, si la pantalla no trae
//   `encabezado`, el título grande de arriba.
// - `encabezado`: el de la pantalla (<EncabezadoPagina ceja acciones…/>),
//   o null si no lleva (el Inicio empieza con la franja azul).
// - `fondo="relieve"`: fondo liso para tarjetas en relieve (Inicio).
export function AppShell({ titulo, encabezado, fondo = "normal", children }: { titulo: string; encabezado?: ReactNode; fondo?: "normal" | "relieve"; children: ReactNode }) {
  const [masAbierta, setMasAbierta] = useState(false);
  const abrirMas = () => setMasAbierta(true);
  const [buscando, setBuscando] = useState(false);
  const abrirBuscador = () => setBuscando(true);

  // Título de la pestaña por pantalla, para no perderse entre varias abiertas.
  useEffect(() => {
    document.title = `${titulo} · CRM NANOBRIDGE`;
  }, [titulo]);

  // Ctrl+K (Cmd+K en Mac) abre el buscador desde cualquier pantalla.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuscando(true);
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  return (
    <div className={clsx("flex min-h-dvh", fondo === "relieve" && "fondo-relieve")}>
      <Sidebar onAbrirBuscador={abrirBuscador} />
      <div className="flex min-w-0 flex-1 flex-col">
        <BarraSuperiorCelular onAbrirMas={abrirMas} onAbrirBuscador={abrirBuscador} />
        <main className="espacio-barra-celular min-w-0 flex-1 px-3 pt-3.5 md:px-7 md:pt-[26px]">
          {encabezado === undefined ? <EncabezadoPagina titulo={titulo} /> : encabezado}
          {children}
        </main>
      </div>
      <BarraNavegacion onAbrirMas={abrirMas} />
      <HojaMas abierta={masAbierta} onCerrar={() => setMasAbierta(false)} />
      <Buscador abierto={buscando} onCerrar={() => setBuscando(false)} />
    </div>
  );
}
