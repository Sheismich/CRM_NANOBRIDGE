import { createContext, useContext } from "react";
import type { CurrentUser } from "../types";

export type AuthState = {
  user: CurrentUser | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (correo: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() usado fuera de <AuthProvider>");
  return ctx;
}
