import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { ApiError, api } from "../../lib/api";
import { useCampanas, type Campana } from "../../lib/campanas";
import { fechaLocal, formatoFecha, plural } from "../../lib/formato";
import { textoMotivos } from "../../lib/prospectos";

// Botón "Mandar a automatización" (16-oct-2026, POST /prospectos/automatizacion):
// el CRM solo forma la fila y la API se los va soltando a PT1, unos 6 a 10
// por día hábil, para no pasar el tope diario de correos. Solo administrador
// y supervisor. Los que no están listos regresan con su motivo; a los que ya
// están en la fila solo se les cambia la campaña (no pierden su lugar).
// Se monta solo mientras está abierto, así cada vez empieza de cero.

export type ProspectoParaFila = {
  id: number;
  contacto_nombre: string;
  empresa_nombre: string;
  estado: string;
  campana_id: number | null;
  motivo_exclusion_anterior: string[] | null;
};

type Resultado = { agregados: number[]; cambiados: number[]; rechazados: { id: number; motivos: string[] }[] };

// El mismo máximo que mandarAutomatizacionInputSchema (src/crm/dto/prospecto.schema.ts).
const MAXIMO = 200;

// Sirven las que no han terminado: la activa y la que está en espera
// (pausada o que aún no empieza, Q7). La API rechaza las demás con 409.
function campanaSirve(c: Campana) {
  return c.motivo === null || c.motivo === "pausada" || c.motivo === "aun_no_empieza";
}

function avisoCampana(c: Campana | undefined) {
  if (c?.motivo === "aun_no_empieza" && c.fecha_inicio) return `Esta campaña empieza el ${formatoFecha.format(fechaLocal(c.fecha_inicio))}; saldrán desde ese día.`;
  if (c?.motivo === "aun_no_empieza") return "Esta campaña todavía no empieza; saldrán desde su fecha de inicio.";
  if (c?.motivo === "pausada") return "Esta campaña está pausada; saldrán cuando se reanude.";
  return null;
}

export function MandarAutomatizacionModal({
  prospectos,
  enFila,
  onCerrar,
  onEnviado
}: {
  prospectos: ProspectoParaFila[];
  // Cuántos esperan hoy en la fila (GET /prospectos/conteos); undefined mientras carga.
  enFila: number | undefined;
  onCerrar: () => void;
  onEnviado?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: campanas } = useCampanas();
  const disponibles = (campanas?.data ?? []).filter(campanaSirve);
  // Viene puesta la del prospecto (o la que comparten todos los elegidos);
  // si no sirve, la primera que esté mandando hoy.
  const propias = new Set(prospectos.map((p) => p.campana_id));
  const comun = propias.size === 1 ? [...propias][0] : null;
  const inicial = disponibles.find((c) => c.id === comun) ?? disponibles.find((c) => c.activa_hoy) ?? disponibles[0];
  const [elegida, setElegida] = useState<string | null>(null);
  const campanaId = elegida ?? (inicial ? String(inicial.id) : "");
  const campana = disponibles.find((c) => String(c.id) === campanaId);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const yaEnFila = prospectos.filter((p) => p.estado === "en_fila").length;
  const excluidosAntes = prospectos.filter((p) => p.estado === "excluido" && p.motivo_exclusion_anterior?.length);
  const nombre = (id: number) => {
    const p = prospectos.find((x) => x.id === id);
    return p ? `${p.contacto_nombre} (${p.empresa_nombre})` : `#${id}`;
  };
  const demasiados = prospectos.length > MAXIMO;

  async function mandar() {
    setError(null);
    setEnviando(true);
    try {
      const r = await api.post<Resultado>("/api/v1/prospectos/automatizacion", { prospectoIds: prospectos.map((p) => p.id), campanaId: Number(campanaId) });
      setResultado(r);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["prospectos"] }), queryClient.invalidateQueries({ queryKey: ["prospecto"] })]);
      onEnviado?.();
    } catch (e) {
      // 409 CAMPANA_TERMINADA: alguien la finalizó mientras el modal estaba abierto.
      setError(e instanceof ApiError ? e.message : "No se pudo conectar con el servidor");
    } finally {
      setEnviando(false);
    }
  }

  // Si todos ya esperan en la fila, lo único que hace es cambiarles la campaña.
  const soloCambio = yaEnFila === prospectos.length;
  const titulo = soloCambio ? "Cambiar de campaña" : prospectos.length === 1 ? "Mandar a automatización" : `Mandar ${prospectos.length} a automatización`;

  if (resultado) {
    const { agregados, cambiados, rechazados } = resultado;
    return (
      <Modal abierto onCerrar={onCerrar} titulo="Listo" acciones={<Button onClick={onCerrar}>Cerrar</Button>}>
        <div className="flex flex-col gap-3 text-[13.5px]">
          <p className="text-strong">
            Entraron {agregados.length}. Cambiaron de campaña {cambiados.length}. No entraron {rechazados.length}.
          </p>
          {agregados.length > 0 && <p className="text-ink-2">Salen solos en el orden en que entraron; no hay que hacer nada más.</p>}
          {rechazados.length > 0 && (
            <div className="rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-warn">
              <b className="block">No entraron:</b>
              <ul className="mt-1 list-disc pl-5">
                {rechazados.map((r) => (
                  <li key={r.id}>
                    {nombre(r.id)}: {textoMotivos(r.motivos)}.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      abierto
      onCerrar={() => !enviando && onCerrar()}
      titulo={titulo}
      descripcion={prospectos.length === 1 ? nombre(prospectos[0]!.id) : undefined}
      acciones={
        <>
          <Button variant="ghost" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void mandar()} disabled={enviando || !campana || demasiados}>
            {enviando ? "Guardando…" : soloCambio ? "Cambiar campaña" : "Mandar"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5 text-[13.5px]">
        {campanas && disponibles.length === 0 ? (
          <div className="rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-warn">No hay campañas activas ni en espera. Activa una en la pestaña Campañas.</div>
        ) : (
          <Field label="Campaña" htmlFor="campana-fila">
            <select id="campana-fila" data-autofocus className={inputClass} value={campanaId} onChange={(e) => setElegida(e.target.value)}>
              {disponibles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.motivo === "pausada" ? " (pausada)" : c.motivo === "aun_no_empieza" ? " (aún no empieza)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {avisoCampana(campana) && <div className="rounded-[10px] bg-info-bg px-3.5 py-2.5 text-info">{avisoCampana(campana)}</div>}

        <p className="text-ink-2">
          Salen solos, unos 6 a 10 por día hábil, en el orden en que entran.
          {enFila !== undefined && ` Hoy hay ${plural(enFila, "prospecto", "prospectos")} en la fila.`}
        </p>
        {yaEnFila > 0 && (
          <p className="text-ink-2">
            {yaEnFila === 1 ? "1 ya está" : `${yaEnFila} ya están`} en la fila: solo se le{yaEnFila === 1 ? "" : "s"} cambia la campaña y no pierde{yaEnFila === 1 ? "" : "n"} su lugar.
          </p>
        )}
        {excluidosAntes.length > 0 && (
          <div className="rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-warn">
            <b className="block">Se excluyeron antes</b>
            <ul className="mt-1 list-disc pl-5">
              {excluidosAntes.map((p) => (
                <li key={p.id}>
                  {prospectos.length > 1 && `${nombre(p.id)}: `}la vez pasada se excluyó porque {textoMotivos(p.motivo_exclusion_anterior!)}.
                </li>
              ))}
            </ul>
            <span className="mt-1 block">Si ya se corrigió, puede{excluidosAntes.length === 1 ? "" : "n"} entrar; si no, se le{excluidosAntes.length === 1 ? "" : "s"} avisa al mandar.</span>
          </div>
        )}
        {demasiados && <ServerError message={`Se pueden mandar hasta ${MAXIMO} a la vez; elegiste ${prospectos.length}.`} />}
        <ServerError message={error} />
      </div>
    </Modal>
  );
}
