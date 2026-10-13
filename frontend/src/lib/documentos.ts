import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { horaEvento } from "./inicio";
import type { CatalogosDocumentos, ConteosDocumentos, Documento, Expediente } from "../types";
import type { Tono } from "../components/ui/tonos";

// Documentos del rediseño (docs/diseno/documentos.html): consultas y textos
// compartidos por la bandeja, el panel y el expediente.

export const ETIQUETA_REVISION: Record<Documento["revision"], string> = { por_revisar: "Por revisar", aprobado: "Aprobado", rechazado: "Rechazado" };
export const TONO_REVISION: Record<Documento["revision"], Tono> = { por_revisar: "warn", aprobado: "ok", rechazado: "danger" };

export function useCatalogosDocumentos() {
  return useQuery({
    queryKey: ["documentos-catalogos"],
    queryFn: () => api.get<CatalogosDocumentos>("/api/v1/documentos/catalogos"),
    staleTime: Infinity
  });
}

export function useConteosDocumentos() {
  return useQuery({
    queryKey: ["documentos", "conteos"],
    queryFn: () => api.get<ConteosDocumentos>("/api/v1/documentos/conteos")
  });
}

export function useExpediente(empresaId: number | null) {
  return useQuery({
    queryKey: ["documentos", "expediente", empresaId],
    queryFn: () => api.get<Expediente>(`/api/v1/documentos/expediente/${empresaId}`),
    enabled: empresaId !== null
  });
}

// Solo PDF e imágenes se ven dentro de la página (?modo=ver del backend).
export function tieneVistaPrevia(mime: string) {
  return mime === "application/pdf" || mime.startsWith("image/");
}

// Etiqueta y color del cuadrito del tipo de archivo (PDF rojo, JPG cyan...).
export function extension(d: Pick<Documento, "nombre_original" | "mime_type">) {
  const porMime: Record<string, string> = {
    "application/pdf": "PDF",
    "image/png": "PNG",
    "image/jpeg": "JPG",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX"
  };
  return porMime[d.mime_type] ?? d.nombre_original.split(".").pop()?.toUpperCase().slice(0, 4) ?? "ARCH";
}

export function claseExtension(ext: string) {
  if (ext === "PDF") return "bg-danger-bg text-danger";
  if (ext === "PNG" || ext === "JPG") return "bg-info-bg text-info";
  if (ext === "XLSX") return "bg-ok-bg text-ok";
  return "bg-navy-bg text-navy";
}

// Cuadrito de la empresa: iniciales y un color fijo por empresa.
const COLORES_EMPRESA = ["bg-[#2a449b]", "bg-[#5b2d86]", "bg-[#c57a0a]", "bg-[#1593ab]", "bg-[#158a5c]", "bg-[#b23a45]"];
export function inicialesEmpresa(nombre: string) {
  const palabras = nombre.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter((p) => p.length > 2 || /^\p{Lu}/u.test(p));
  return ((palabras[0]?.[0] ?? "") + (palabras[1]?.[0] ?? "")).toUpperCase() || "··";
}
export function colorEmpresa(id: number) {
  return COLORES_EMPRESA[id % COLORES_EMPRESA.length];
}

// "Hoy, 10:12", "Ayer", "7 oct".
export function cuando(fecha: string, ahora: Date) {
  const h = horaEvento(fecha, ahora);
  return /^\d\d:\d\d$/.test(h) ? `Hoy, ${h}` : h;
}
