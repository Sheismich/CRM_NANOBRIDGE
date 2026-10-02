// Cliente HTTP contra el backend (CRM_NANOBRIDGE, src/shared/http-exception.filter.ts
// define el contrato de error: { error, message, details? }). Sin base URL
// fija por default: en desarrollo el proxy de Vite (vite.config.ts) sirve
// /api en el mismo origen; en producción VITE_API_URL apunta al backend
// real (Cloud Run) y el backend necesita ese origen en CORS_ORIGINS.
const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  // Código estable para distinguir un error en el cliente sin comparar el
  // texto del mensaje (ej. "RESPUESTA_YA_CLASIFICADA"); no todos lo traen.
  readonly code: string | undefined;

  constructor(status: number, message: string, details?: unknown, code?: string) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  // multipart/form-data (subida de documentos): FormData, sin Content-Type
  // manual -- el navegador pone el boundary correcto solo.
  formData?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
};

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.pathname + url.search;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    // credentials: "include" -- la sesión del backend es una cookie
    // (SessionAuthGuard), nunca un token que este cliente maneje a mano
    // (PLAN_FRONTEND.md §4). Sin esto, ninguna petición autenticada
    // funcionaría aunque el login sí hubiera puesto la cookie.
    credentials: "include",
    headers: options.formData ? undefined : { "Content-Type": "application/json" },
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
  });

  // 204 No Content (logout, DELETE): no hay body que parsear.
  if (response.status === 204) return undefined as T;

  const payload = await leerPayload(response);
  if (!response.ok) throw errorDeRespuesta(response.status, payload);
  return payload as T;
}

async function leerPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

function errorDeRespuesta(status: number, payload: unknown) {
  const message = typeof payload === "object" && payload !== null && "message" in payload ? String((payload as { message: unknown }).message) : "Error inesperado";
  const details = typeof payload === "object" && payload !== null ? (payload as { details?: unknown }).details : undefined;
  const code = typeof payload === "object" && payload !== null && typeof (payload as { code?: unknown }).code === "string" ? (payload as { code: string }).code : undefined;
  return new ApiError(status, message, details, code);
}

// Nombre real del archivo desde el Content-Disposition del backend
// (src/shared/content-disposition.ts): filename*=UTF-8''<codificado> trae
// acentos y ñ; filename="..." es el respaldo ASCII.
function nombreDeDescarga(contentDisposition: string | null) {
  const utf8 = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]!);
    } catch {
      // Codificación rota: se cae al respaldo ASCII.
    }
  }
  return contentDisposition?.match(/filename="([^"]+)"/i)?.[1] ?? "descarga";
}

// Descarga de documentos (B6 del plan de fixes del backend, 2-oct-2026): el
// backend manda el archivo con la sesión (cookie), ya no una URL firmada.
// Por eso no basta con navegar a la URL: se pide con fetch (credentials),
// se arma un Blob y se guarda con un <a download> temporal.
async function descargar(path: string) {
  const response = await fetch(buildUrl(path), { credentials: "include" });
  if (!response.ok) throw errorDeRespuesta(response.status, await leerPayload(response));

  const url = URL.createObjectURL(await response.blob());
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreDeDescarga(response.headers.get("content-disposition"));
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // El navegador ya tomó el archivo con el click; liberar la memoria del Blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => request<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", formData }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  descargar
};
