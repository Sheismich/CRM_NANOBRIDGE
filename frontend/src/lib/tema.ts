import { useState } from "react";

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

export function useTema() {
  const [tema, setTema] = useState<Tema>(() => (document.documentElement.dataset.theme === "dark" ? "oscuro" : "claro"));

  function alternar() {
    const nuevo: Tema = tema === "oscuro" ? "claro" : "oscuro";
    aplicar(nuevo);
    setTema(nuevo);
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch {
      // Sin almacenamiento: el cambio dura hasta recargar.
    }
  }

  return { tema, alternar };
}
