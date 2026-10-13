import { useSyncExternalStore } from "react";

// Modo claro/oscuro. Se guarda en este navegador (es una preferencia de la
// persona, no un dato del CRM); sin elección guardada se sigue la del
// sistema operativo. index.css define los colores de cada tema sobre
// :root[data-theme].
export type Tema = "claro" | "oscuro";
const CLAVE = "crm-tema";

function temaGuardado(): Tema | null {
  try {
    const valor = localStorage.getItem(CLAVE);
    return valor === "claro" || valor === "oscuro" ? valor : null;
  } catch {
    // Navegación privada o almacenamiento bloqueado.
    return null;
  }
}

function temaInicial(): Tema {
  return temaGuardado() ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro");
}

function aplicar(tema: Tema) {
  document.documentElement.dataset.theme = tema === "oscuro" ? "dark" : "light";
}

// Se llama en main.tsx antes de pintar, para que no parpadee en claro.
export function aplicarTemaInicial() {
  aplicar(temaInicial());
}

// La fuente de verdad es el atributo de <html>: así el selector del menú
// de compu y el de la barra del celular (los dos montados a la vez) nunca
// se contradicen.
function suscribir(avisar: () => void) {
  const observador = new MutationObserver(avisar);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observador.disconnect();
}

function leer(): Tema {
  return document.documentElement.dataset.theme === "dark" ? "oscuro" : "claro";
}

export function useTema() {
  const tema = useSyncExternalStore(suscribir, leer);

  function elegir(nuevo: Tema) {
    aplicar(nuevo);
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch {
      // Sin almacenamiento: el cambio dura hasta recargar.
    }
  }

  return { tema, elegir, alternar: () => elegir(tema === "oscuro" ? "claro" : "oscuro") };
}
