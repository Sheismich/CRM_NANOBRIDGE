import { useEffect, useRef } from "react";

// Abre/cierra un <dialog> nativo según `abierto`. El navegador ya da lo
// difícil: foco atrapado adentro, Esc para cerrar, el resto de la página
// inerte y el fondo oscurecido (::backdrop). Esc y el clic en el fondo
// llaman onCerrar; quien usa el panel decide si cierra (ej. no cerrar
// mientras se guarda).
export function useDialogo(abierto: boolean, onCerrar: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const cerrarRef = useRef(onCerrar);
  useEffect(() => {
    cerrarRef.current = onCerrar;
  });

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) {
      dialogo.showModal();
      // showModal enfoca el primer botón (casi siempre "Cerrar"). Si el
      // contenido marca un campo con data-autofocus, mejor ese.
      dialogo.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    // Esc: el navegador lo cerraría solo y React quedaría con abierto=true.
    const alCancelar = (e: Event) => {
      e.preventDefault();
      cerrarRef.current();
    };
    // Clic en el fondo: el evento llega al <dialog> mismo, no a su contenido.
    const alClic = (e: MouseEvent) => {
      if (e.target === dialogo) cerrarRef.current();
    };
    dialogo.addEventListener("cancel", alCancelar);
    dialogo.addEventListener("click", alClic);
    return () => {
      dialogo.removeEventListener("cancel", alCancelar);
      dialogo.removeEventListener("click", alClic);
    };
  }, []);

  return ref;
}
