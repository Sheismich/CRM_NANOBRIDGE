// Enlaces externos guardados en el CRM (sitio web, redes). El backend solo
// acepta http/https (src/shared/http-url.ts), así que es seguro usarlos
// como href; se abren en otra pestaña sin pasarle window.opener.

export function EnlaceExterno({ url, children }: { url: string; children?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-navy hover:underline">
      {children ?? url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
    </a>
  );
}

// LinkedIn / Facebook / Instagram de un contacto; nada si no tiene ninguna.
export function RedesContacto({ linkedin, facebook, instagram, className = "" }: { linkedin: string | null; facebook: string | null; instagram: string | null; className?: string }) {
  const redes: [string, string][] = [];
  if (linkedin) redes.push(["LinkedIn", linkedin]);
  if (facebook) redes.push(["Facebook", facebook]);
  if (instagram) redes.push(["Instagram", instagram]);
  if (redes.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 text-xs ${className}`}>
      {redes.map(([red, url]) => (
        <EnlaceExterno key={red} url={url}>
          {red}
        </EnlaceExterno>
      ))}
    </div>
  );
}
