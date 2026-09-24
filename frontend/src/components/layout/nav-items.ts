// Un solo lugar con los 8 módulos del sidebar + Administración -- mismos
// destinos y mismo orden que el sidebar de los mockups (artifact "CRM
// NANOBRIDGE — Mockups", ver cualquier .dc.html). Reportes y
// Administración solo se muestran a administrador/supervisor
// (ReportesController y UsuariosController -- ver Sidebar.tsx).
export type NavItem = {
  to: string;
  label: string;
  icon: string; // path data de un <svg viewBox="0 0 24 24">, mismo trazo que el mockup
  soloAdminSupervisor?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Inicio", icon: "M3 10.5 12 3l9 7.5 M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" },
  { to: "/empresas", label: "Empresas", icon: "M4 3h10v18H4z M14 9h6v12h-6z M7.5 7h1M7.5 11h1M7.5 15h1M17 13h1M17 17h1" },
  { to: "/contactos", label: "Contactos", icon: "M9 8a3 3 0 1 0 0-.001 M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M17 9a2.4 2.4 0 1 0 0-.001 M15.5 14a5 5 0 0 1 5.5 5.2" },
  { to: "/prospectos", label: "Prospectos", icon: "M4 12h4l1.5 3h5L16 12h4 M4 12 5.5 5A1 1 0 0 1 6.5 4h11a1 1 0 0 1 1 1L20 12v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" },
  { to: "/tareas", label: "Tareas", icon: "M4 4h16v16H4z M8 10l1.5 1.5L13 8 M8 15h8" },
  { to: "/oportunidades", label: "Oportunidades", icon: "M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0" },
  { to: "/cotizaciones", label: "Cotizaciones", icon: "M7.5 3h6l4 4v13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M13.5 3v4h4 M9 12.5h6 M9 16h6" },
  { to: "/documentos", label: "Documentos", icon: "M3.5 6.5a1 1 0 0 1 1-1h5l1.7 2h8.3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" },
  { to: "/reportes", label: "Reportes", icon: "M4.5 20V11 M12 20V5 M19.5 20v-6.5 M2.5 20h19", soloAdminSupervisor: true }
];

export const ADMIN_ITEM: NavItem = {
  to: "/administracion",
  label: "Administración",
  icon: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M12 3v2.2M12 18.8V21M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M3 12h2.2M18.8 12H21M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5",
  soloAdminSupervisor: true
};
