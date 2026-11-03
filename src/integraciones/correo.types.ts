export const CORREO_SERVICE = Symbol("CORREO_SERVICE");

// Un correo que la API manda directo (avisos del CRM; después, responder al
// prospecto). El remitente sale de env (CORREO_REMITENTE); `nombreRemitente`
// lo cambia solo para ese correo ("Daniel Pérez · NANOBRIDGE").
export type CorreoSaliente = {
  para: string;
  nombrePara?: string;
  asunto: string;
  texto: string;
  html: string;
  nombreRemitente?: string;
  replyTo?: string;
  // Cabeceras extra, p. ej. In-Reply-To/References para contestar en el
  // mismo hilo del cliente (etapa 3).
  cabeceras?: Record<string, string>;
  // Para separar en SendGrid estos correos de los de prospección.
  categoria: string;
  // Correos a prospectos: SendGrid cambia ETIQUETA_BAJA (en texto y html)
  // por su link de baja. Los avisos internos no lo llevan.
  linkDeBaja?: boolean;
  // Archivos adjuntos, p. ej. el PDF de la cotización (3-nov-2026).
  adjuntos?: Adjunto[];
};

export type Adjunto = { nombre: string; tipo: string; contenidoBase64: string };

export { ETIQUETA_BAJA } from "../shared/plantillas.js";

export interface CorreoService {
  // Lanza error si no salió; regresa el id que dio el proveedor, si dio uno.
  enviar(correo: CorreoSaliente): Promise<{ id: string | null }>;
}
