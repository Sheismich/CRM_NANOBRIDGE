import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Icono } from "../ui/Icono";
import { api } from "../../lib/api";
import type { Empresa } from "../../types";

// Control G-01 (29-oct-2026): al escribir el nombre de una empresa nueva,
// avisa si ya hay una que se llama igual (GET /empresas/parecidas ignora
// mayúsculas, acentos y "S.A. de C.V."). Solo avisa: decidir si es la misma
// es de quien captura. Con `onUsar`, cada una trae un botón para elegirla;
// sin él, un enlace a su ficha.
export function AvisoEmpresasParecidas({ nombre, onUsar }: { nombre: string; onUsar?: (e: Empresa) => void }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(nombre.trim()), 400);
    return () => clearTimeout(t);
  }, [nombre]);
  const { data } = useQuery({
    queryKey: ["empresas", "parecidas", q],
    queryFn: () => api.get<{ data: Empresa[] }>("/api/v1/empresas/parecidas", { nombre: q }),
    enabled: q.length >= 2
  });
  const parecidas = q.length >= 2 ? (data?.data ?? []) : [];
  if (parecidas.length === 0) return null;

  return (
    <div role="status" className="flex gap-2.5 rounded-[12px] bg-warn-bg px-3.5 py-3 text-[12px] font-semibold text-warn">
      <Icono nombre="aviso" size={15} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        {parecidas.length === 1 ? "Ya hay una empresa con este nombre" : `Ya hay ${parecidas.length} empresas con este nombre`}. Si es la misma, no la des de alta otra vez:
        <ul className="mt-2 flex flex-col gap-1.5">
          {parecidas.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <b className="text-strong">{e.nombre_comercial ?? e.nombre_legal}</b>
              {[e.giro, e.ciudad].filter(Boolean).length > 0 && <span className="font-normal text-ink-2">{[e.giro, e.ciudad].filter(Boolean).join(" · ")}</span>}
              {onUsar ? (
                <button type="button" onClick={() => onUsar(e)} className="rounded-full border border-warn/40 bg-card px-2.5 py-0.5 text-[12px] font-bold text-strong hover:border-warn">
                  Usar esta
                </button>
              ) : (
                <Link to={`/empresas/${e.id}`} className="font-bold text-strong underline">
                  Ver ficha
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
