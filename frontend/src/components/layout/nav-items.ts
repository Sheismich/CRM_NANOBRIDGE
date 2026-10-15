import { ICONOS } from "../ui/iconos";

// Un solo lugar con los módulos del menú, en el orden del diseño
// (docs/diseno/inicio-aprobado.html). Administración solo se muestra a
// administrador/supervisor (UsuariosController; esto es solo UX, el
// backend aplica el permiso real). Reportes sí lo ve un agente, pero solo
// la vista Día con lo suyo (15-oct-2026).
// `celular`: los 4 que van en la barra de abajo del celular, antes del
// botón "Más" (mismo orden que el diseño); los demás salen en "Más".
export type NavItem = {
  to: string;
  label: string;
  corto?: string; // etiqueta en la barra del celular, si la normal no cabe
  icon: string; // path data de un <svg viewBox="0 0 24 24">
  soloAdminSupervisor?: boolean;
  celular?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Inicio", icon: ICONOS.inicio, celular: true },
  { to: "/empresas", label: "Empresas", icon: ICONOS.empresa },
  { to: "/contactos", label: "Contactos", icon: ICONOS.equipo },
  { to: "/prospectos", label: "Prospectos", icon: "M4 12h4l1.5 3h5L16 12h4 M4 12 5.5 5A1 1 0 0 1 6.5 4h11a1 1 0 0 1 1 1L20 12v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z", celular: true },
  { to: "/tareas", label: "Tareas", icon: "M4 4h16v16H4z M8 10l1.5 1.5L13 8 M8 15h8", celular: true },
  { to: "/oportunidades", label: "Oportunidades", corto: "Oportun.", icon: "M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0", celular: true },
  { to: "/cotizaciones", label: "Cotizaciones", icon: ICONOS.documento },
  { to: "/documentos", label: "Documentos", icon: ICONOS.carpeta },
  { to: "/reportes", label: "Reportes", icon: "M4.5 20V11 M12 20V5 M19.5 20v-6.5 M2.5 20h19" },
  {
    to: "/administracion",
    label: "Administración",
    // Engrane.
    icon: "M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    soloAdminSupervisor: true
  }
];

export function itemsVisibles(rol: string | undefined) {
  const esAdminOSupervisor = rol === "administrador" || rol === "supervisor";
  return NAV_ITEMS.filter((item) => !item.soloAdminSupervisor || esAdminOSupervisor);
}
