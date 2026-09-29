import { Button } from "./Button";

// Paginación de las listas del backend ({ page, limit, data }): la API no
// devuelve el total, así que "Siguiente" se habilita mientras la página
// venga llena.
export function Paginacion({ page, limit, cantidad, onPage }: { page: number; limit: number; cantidad: number; onPage: (page: number) => void }) {
  if (page <= 1 && cantidad < limit) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
      <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </Button>
      <span className="text-xs text-ink-3">Página {page}</span>
      <Button variant="ghost" disabled={cantidad < limit} onClick={() => onPage(page + 1)}>
        Siguiente
      </Button>
    </div>
  );
}
