import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Button } from "../components/ui/Button";
import { Contador, FilaContadores } from "../components/ui/Contador";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { Ficha } from "../components/ui/Ficha";
import { ChipVivo, Franja, Kpi } from "../components/ui/Franja";
import { Icono } from "../components/ui/Icono";
import { MarcaDeAgua } from "../components/ui/MarcaDeAgua";
import { Modal } from "../components/ui/Modal";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Pastilla } from "../components/ui/Pastilla";
import { IconoHundido, Tarjeta } from "../components/ui/Tarjeta";

// Catálogo de la base común del rediseño. Solo existe con `npm run dev`
// (App.tsx la carga con import.meta.env.DEV), no se publica. Sirve para
// ver cada componente en día/noche y celular sin iniciar sesión, y como
// ejemplo de uso. ?fondo=relieve la pinta sobre el fondo del Inicio.
export function MuestraBasePage() {
  const [params] = useSearchParams();
  const relieve = params.get("fondo") === "relieve";
  const estilo = relieve ? "relieve" : "blanca";
  const [panel, setPanel] = useState(params.get("abrir") === "panel");
  const [modal, setModal] = useState(params.get("abrir") === "modal");
  const [filtro, setFiltro] = useState("por_revisar");

  return (
    <AppShell
      titulo="Base común"
      fondo={relieve ? "relieve" : "normal"}
      encabezado={
        <EncabezadoPagina
          ceja={
            <>
              <Pastilla tono="ok" punto mayusculas>
                Circuito activo
              </Pastilla>
              · 3 completadas ayer
            </>
          }
          titulo="Base común"
          subtitulo="Componentes compartidos del rediseño (components/ui/)."
          acciones={
            <>
              <Button variant="outline" onClick={() => setModal(true)}>
                <Icono nombre="descargar" size={17} /> Abrir modal
              </Button>
              <Button onClick={() => setPanel(true)}>
                <Icono nombre="subir" size={17} /> Abrir panel
              </Button>
            </>
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Franja ceja="Conectando la ficción con la realidad" chips={<ChipVivo>Automatización activa</ChipVivo>} fecha="Mié 8 oct · 09:45" titulo="Buenos días, Fabián" subtitulo="Así va la prospección de octubre.">
          <Kpi valor="128" etiqueta="Personas contactadas" detalle="+12 hoy" />
          <Kpi valor="14" etiqueta="Respondieron" detalle="+3 hoy" />
          <Kpi valor="5" etiqueta="Interesados" detalle="+1 hoy" />
          <Kpi valor="10.9%" etiqueta="Tasa de respuesta" detalle="septiembre: 8.2%" resaltado />
        </Franja>

        <FilaContadores>
          <Contador etiqueta="Por revisar" valor={3} detalle="subidos sin revisar" tono="warn" seleccionado={filtro === "por_revisar"} onClick={() => setFiltro("por_revisar")} />
          <Contador etiqueta="Aprobados" valor={9} detalle="vigentes" tono="ok" seleccionado={filtro === "aprobados"} onClick={() => setFiltro("aprobados")} />
          <Contador etiqueta="Expedientes incompletos" valor={2} detalle="clientes con faltantes" tono="warn" />
          <Contador etiqueta="Rechazados" valor={1} detalle="por corregir" tono="danger" seleccionado={filtro === "rechazados"} onClick={() => setFiltro("rechazados")} />
        </FilaContadores>

        <div className="grid gap-4 md:grid-cols-2">
          <Tarjeta estilo={estilo} titulo="Correos enviados por día" icono="correo" color="menta" extra="1–8 oct">
            <p className="text-[13px] text-ink-2">Encabezado menta. Las gráficas van en SVG, como components/reportes/Graficas.tsx.</p>
          </Tarjeta>
          <Tarjeta
            estilo={estilo}
            titulo="Lo que acaba de pasar"
            icono="campana"
            color="cyan"
            extra={
              <span className="inline-flex items-center gap-1.5">
                <span className="punto-vivo" /> en vivo
              </span>
            }
          >
            <p className="text-[13px] text-ink-2">Encabezado cyan con «en vivo».</p>
          </Tarjeta>
          <Tarjeta estilo={estilo} titulo="Campañas" icono="bandera" color="lila" extra="tasa de respuesta">
            <div className="flex flex-wrap gap-2">
              <Pastilla tono="ok">Activa</Pastilla>
              <Pastilla tono="warn">Pausada</Pastilla>
              <Pastilla tono="danger" punto>
                Rechazado
              </Pastilla>
              <Pastilla tono="info">Cola IA</Pastilla>
              <Pastilla tono="navy">En progreso</Pastilla>
              <Pastilla tono="neutro">Baja</Pastilla>
              <Pastilla tono="warn" punto mayusculas>
                Pendiente de aprobación
              </Pastilla>
            </div>
          </Tarjeta>
          <Tarjeta estilo={estilo} className="encabezado-morado">
            <div className="flex items-center gap-3">
              <IconoHundido icono="dinero" color="morado" />
              <span className="font-heading text-[11px] font-extrabold tracking-[2px] text-ink-3">PIPELINE ABIERTO</span>
            </div>
            <div className="mono mt-4 font-display text-[44px] leading-tight text-strong">$456,901</div>
            <p className="mt-1.5 text-[13px] text-ink-2">Tarjeta sin título, con ícono suelto (IconoHundido).</p>
          </Tarjeta>
        </div>

        <Tarjeta estilo={estilo} className="min-h-[220px]">
          <MarcaDeAgua className="-bottom-[70px] -right-10 w-[340px]" />
          <div className="relative">
            <h2 className="font-heading text-[22px] font-black text-strong">Llamar a Ana Ruiz — respondió “interesada”</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Ficha icono="empresa" to="/empresas">
                Moldes del Bajío S.A. de C.V.
              </Ficha>
              <Ficha icono="persona">Ana Ruiz (Directora de Compras)</Ficha>
              <Ficha icono={<span className="block h-2 w-2 rounded-full bg-mint" />}>Campaña: Manufactura Bajío Q4</Ficha>
              <Ficha onClick={() => undefined} activa>
                Revisión <b>Por revisar</b>
              </Ficha>
            </div>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Button>
                <Icono nombre="checkCirculo" size={17} /> Hecha
              </Button>
              <Button variant="outline">Reprogramar</Button>
              <Button variant="ghost">Saltar</Button>
              <Button variant="rechazar">
                <Icono nombre="xCirculo" size={17} /> Rechazar
              </Button>
              <Button variant="aprobar">
                <Icono nombre="escudo" size={17} /> Aprobar documento
              </Button>
            </div>
          </div>
        </Tarjeta>
      </div>

      <PanelLateral
        abierto={panel}
        onCerrar={() => setPanel(false)}
        encabezado={
          <div>
            <Pastilla tono="warn" punto mayusculas>
              Pendiente de aprobación
            </Pastilla>
            <h2 className="mt-1.5 font-heading text-[15px] font-extrabold text-strong">Acta constitutiva Moldes del Bajío.pdf</h2>
            <p className="text-[12px] text-ink-3">Moldes del Bajío SA de CV · subido hoy 10:12</p>
          </div>
        }
      >
        <p className="text-[13px] text-ink-2">Contenido del panel. Se desplaza solo; el encabezado se queda fijo. Esc o clic afuera lo cierran.</p>
      </PanelLateral>

      <Modal
        abierto={modal}
        onCerrar={() => setModal(false)}
        titulo="Rechazar documento"
        descripcion="Elige el motivo y explícalo. Es obligatorio."
        acciones={
          <>
            <Button variant="outline" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button variant="rechazar" onClick={() => setModal(false)}>
              Rechazar
            </Button>
          </>
        }
      >
        <textarea className="h-28 w-full rounded-[12px] border border-border bg-soft p-3 text-[13px] text-ink" placeholder="Explica qué tiene que corregir…" />
      </Modal>
    </AppShell>
  );
}
