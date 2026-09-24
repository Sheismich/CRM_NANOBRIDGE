// Cliente HTTP contra el backend (CRM_NANOBRIDGE, src/shared/http-exception.filter.ts
// define el contrato de error: { error, message, details? }). Sin base URL
// fija por default: en desarrollo el proxy de Vite (vite.config.ts) sirve
// /api en el mismo origen; en producción VITE_API_URL apunta al backend
// real (Cloud Run) y el backend necesita ese origen en CORS_ORIGINS.
const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
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

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "message" in payload ? String((payload as { message: unknown }).message) : "Error inesperado";
    const details = typeof payload === "object" && payload !== null ? (payload as { details?: unknown }).details : undefined;
    throw new ApiError(response.status, message, details);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => request<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", formData }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" })
};
