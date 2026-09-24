import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { AuthContext, type AuthState } from "./auth-context";
import type { CurrentUser } from "../types";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  useEffect(() => {
    api
      .get<CurrentUser>("/api/v1/auth/me")
      .then((current) => {
        setUser(current);
        setStatus("authenticated");
      })
      .catch((error) => {
        // 401 es el caso normal de "no hay sesión todavía", no un error
        // que deba propagarse -- cualquier otro status (500, red caída) sí
        // deja "anonymous" también (no hay nada mejor que mostrar), pero
        // vale la pena distinguirlo en consola para no confundirlo con un
        // simple logout.
        if (!(error instanceof ApiError) || error.status !== 401) console.error("GET /auth/me falló", error);
        setStatus("anonymous");
      });
  }, []);

  async function login(correo: string, password: string) {
    const current = await api.post<CurrentUser>("/api/v1/auth/login", { correo, password });
    setUser(current);
    setStatus("authenticated");
  }

  async function logout() {
    await api.post("/api/v1/auth/logout");
    setUser(null);
    setStatus("anonymous");
  }

  return <AuthContext.Provider value={{ user, status, login, logout }}>{children}</AuthContext.Provider>;
}
