import { LOGO_BAJA } from "./logo.js";

// Lo que ve el prospecto al abrir el link "Darte de baja" del correo
// (13-nov-2026). Mismo diseño que la página que se usaba en SendGrid
// (docs/sendgrid/pagina-baja.html): de "usted", con el contacto y el aviso
// de privacidad. Todo va dentro del HTML (estilos en línea, logo
// incrustado): la política de contenido del front (firebase.json) no deja
// cargar nada de otro lado.
//
// - "confirmar": la pregunta y el botón. Abrirla no cambia nada.
// - "listo": ya se dio de baja (recién, o desde antes).
// - "invalido": el link está roto o alterado.
export type VistaBaja = "confirmar" | "listo" | "invalido";

const CONTACTO = "director.general@nano-bridge-mex.com";
const AVISO = "https://nanobridge-mex.com/aviso-de-privacidad";
const AZUL = "#2a449b";

const TITULOS: Record<VistaBaja, string> = {
  confirmar: "Darse de baja · NANOBRIDGE",
  listo: "Baja confirmada · NANOBRIDGE",
  invalido: "Enlace no válido · NANOBRIDGE"
};

function circulo(fondo: string, color: string, signo: string) {
  return `<div style="width:48px;height:48px;line-height:48px;margin:0 auto 16px;border-radius:50%;background:${fondo};color:${color};font-size:24px;font-weight:bold">${signo}</div>`;
}

function contenido(vista: VistaBaja, accion: string) {
  const h1 = (texto: string) => `<h1 style="font-size:20px;margin:0 0 10px">${texto}</h1>`;
  const p = (texto: string) => `<p style="font-size:15px;line-height:1.6;color:#52606d;margin:0">${texto}</p>`;

  if (vista === "confirmar") {
    return (
      h1("¿Quiere dejar de recibir nuestros correos?") +
      p("Al confirmar, ya no le enviaremos más correos de prospección de NANOBRIDGE.") +
      `<form method="post" action="${accion}" style="margin:24px 0 0">` +
      `<button type="submit" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;background:${AZUL};border:0;border-radius:8px;padding:12px 28px;cursor:pointer">Confirmar baja</button>` +
      `</form>` +
      `<p style="font-size:13px;line-height:1.6;color:#7b8794;margin:16px 0 0">Si llegó aquí por error, cierre esta página: no cambia nada.</p>`
    );
  }
  if (vista === "listo") {
    return circulo("#e8f6ee", "#1f8a4c", "&#10003;") + h1("Listo, se dio de baja") + p("Ya no le enviaremos más correos de prospección de NANOBRIDGE.");
  }
  return circulo("#fdecec", "#b42318", "!") + h1("Este enlace no es válido") + p("El enlace está incompleto o ya no sirve. Si quiere darse de baja, escríbanos y lo hacemos por usted.");
}

export function paginaDeBaja(vista: VistaBaja, accion = ""): string {
  const ayuda = vista === "listo" ? "Si fue un error o tiene alguna duda, escríbanos a" : "Si tiene alguna duda, escríbanos a";
  return (
    `<!doctype html>` +
    `<html lang="es"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${TITULOS[vista]}</title></head>` +
    `<body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933">` +
    `<div style="padding:64px 16px">` +
    `<div style="max-width:460px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">` +
    `<div style="height:4px;background:${AZUL};background-image:linear-gradient(90deg,#2a449b,#5b2d86,#1fc8c4)"></div>` +
    `<div style="padding:36px 32px 32px;text-align:center">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px"><tr>` +
    `<td style="vertical-align:middle"><img src="${LOGO_BAJA}" width="36" height="36" alt="" style="display:block;border:0"></td>` +
    `<td style="vertical-align:middle;padding-left:10px;font-size:16px;font-weight:bold;letter-spacing:3px;color:${AZUL}">NANOBRIDGE</td>` +
    `</tr></table>` +
    contenido(vista, accion) +
    `<p style="font-size:13px;line-height:1.6;color:#7b8794;margin:24px 0 0;padding-top:20px;border-top:1px solid #e4e7eb">${ayuda} <a href="mailto:${CONTACTO}" style="color:${AZUL}">${CONTACTO}</a>.<br>Consulte nuestro <a href="${AVISO}" style="color:${AZUL}">aviso de privacidad</a>.</p>` +
    `</div></div>` +
    `<p style="text-align:center;font-size:11px;color:#9aa5b1;margin:16px 0 0">Nano Bridge SA de CV · Ignacio T Chávez 328, col. Obraje, C.P. 20230, Aguascalientes, Ags.</p>` +
    `</div></body></html>`
  );
}
