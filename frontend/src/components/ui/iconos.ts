// Íconos de trazo (viewBox 24×24, stroke 2), los mismos de docs/diseno/.
// `d` acepta varios trazos pegados ("M... M..."), igual que nav-items.ts.
// Para un ícono que no esté aquí, se pasa su `d` directo.
export const ICONOS = {
  inicio: "M3 10.5 12 3l9 7.5 M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5",
  correo: "M5 5h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z M4 7l8 6 8-6",
  campana: "M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8 M10.3 21a1.9 1.9 0 0 0 3.4 0",
  bandera: "M4 21V4 M4 4h11l-2 4 2 4H4",
  dinero: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5 M12 6v2 M12 16v2",
  mas: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 8v8 M8 12h8",
  cerrar: "M6 6l12 12 M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  checkCirculo: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M8.5 12.5l2.5 2.5 4.5-5",
  xCirculo: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M9.5 9.5l5 5 M14.5 9.5l-5 5",
  info: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 11v5 M12 8h.01",
  aviso: "M12 4 2.5 20h19L12 4z M12 10v4 M12 17h.01",
  reloj: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3 2",
  calendario: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M4 10h16 M8 3v4 M16 3v4",
  telefono: "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  persona: "M12 8a3.5 3.5 0 1 0 0-.001 M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7",
  equipo: "M9 8a3 3 0 1 0 0-.001 M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M17 9a2.4 2.4 0 1 0 0-.001 M15.5 14a5 5 0 0 1 5.5 5.2",
  empresa: "M4 3h10v18H4z M14 9h6v12h-6z M7.5 7h1 M7.5 11h1 M7.5 15h1 M17 13h1 M17 17h1",
  documento: "M7.5 3h6l4 4v13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M13.5 3v4h4 M9 12.5h6 M9 16h6",
  carpeta: "M3.5 6.5a1 1 0 0 1 1-1h5l1.7 2h8.3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z",
  descargar: "M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 19h14",
  subir: "M12 15V4 M7.5 8.5 12 4l4.5 4.5 M5 19h14",
  buscar: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20 20l-4-4",
  flechaDerecha: "M5 12h14 M13 6l6 6-6 6",
  flechaIzquierda: "M19 12H5 M11 6l-6 6 6 6",
  tendencia: "M3 17l6-6 4 4 8-8 M15 7h6v6",
  candado: "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  escudo: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z M8.5 12l2.5 2.5 4.5-5",
  servidor: "M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01",
  rayo: "M13 3 4 14h7l-1 7 9-11h-7l1-7z",
  salir: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 8l-4 4 4 4 M6 12h10",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  puntos: "M5 12h.01 M12 12h.01 M19 12h.01",
  sol: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  luna: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
} as const;

export type NombreIcono = keyof typeof ICONOS;
