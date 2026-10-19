// El correo de un aviso del CRM: corto, con el botón a la pantalla. Texto
// plano y html con lo mismo.
export function armarCorreoAviso(input: { nombre: string; titulo: string; cuerpo: string | null; url: string }) {
  const primerNombre = input.nombre.trim().split(/\s+/)[0] ?? "";
  const saludo = primerNombre ? `Hola ${primerNombre},` : "Hola,";
  const pie = "Este aviso lo manda el CRM de NANOBRIDGE. Si no quieres recibirlos por correo, apágalos desde la campanita del CRM.";

  const texto = [saludo, [input.titulo, input.cuerpo].filter(Boolean).join("\n"), `Ábrelo en el CRM: ${input.url}`, pie].join("\n\n");

  const parrafo = (t: string) => `<p>${escapar(t).replace(/\n/g, "<br>")}</p>`;
  const html = [
    parrafo(saludo),
    `<p><strong>${escapar(input.titulo)}</strong>${input.cuerpo ? `<br>${escapar(input.cuerpo).replace(/\n/g, "<br>")}` : ""}</p>`,
    `<p><a href="${escapar(input.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#101733;color:#ffffff;text-decoration:none;font-weight:bold">Abrir en el CRM</a></p>`,
    `<p style="color:#6b7280;font-size:12px">${escapar(pie)}</p>`
  ].join("");

  return { asunto: `[NANOBRIDGE] ${input.titulo}`, texto, html };
}

function escapar(texto: string) {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
