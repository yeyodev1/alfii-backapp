import { Resend } from "resend";
import { env } from "../../config/env";

/**
 * Correo transaccional.
 *
 * REGLA INNEGOCIABLE: ningun correo menciona a las chicas. Ni nombres, ni
 * arquetipos, ni fragmentos de conversacion, ni capturas. El correo es el canal
 * menos privado del producto: se reenvia, se previsualiza en la pantalla de
 * bloqueo del telefono y queda alojado en un tercero. Todo lo que toque el
 * expediente de una persona real vive dentro de la app y solo ahi.
 *
 * Lo que si se envia: recuperacion de contrasena, aviso de cambio de contrasena
 * y logros del propio usuario. Nada mas.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

export function appUrl(path = ""): string {
  const base = env.APP_URL.replace(/\/+$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return path ? `${base}${clean}` : base;
}

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function send(input: SendInput): Promise<boolean> {
  // Sin envio activo se registra y se sigue: en desarrollo no queremos gastar
  // cuota ni mandar correos reales por accidente.
  if (!env.MAIL_ENABLED) {
    console.log(`[alfii:mail] (simulado) para=${input.to} asunto="${input.subject}"`);
    return true;
  }

  const resend = getClient();
  if (!resend) {
    console.error("[alfii:mail] MAIL_ENABLED=true sin cliente disponible");
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: env.MAIL_FROM,
      replyTo: env.MAIL_REPLY_TO,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (error) {
      console.error(`[alfii:mail] fallo el envio: ${error.message}`);
      return false;
    }

    console.log(`[alfii:mail] enviado para=${input.to} asunto="${input.subject}"`);
    return true;
  } catch (error: any) {
    // Un fallo de correo no puede tumbar la operacion que lo disparo: el usuario
    // ya cambio su contrasena o completo su perfil, y eso vale mas que el aviso.
    console.error(`[alfii:mail] excepcion en el envio: ${error?.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Plantilla base
// ---------------------------------------------------------------------------

const COLORS = {
  navy: "#0d1321",
  plum: "#2a1f2d",
  cream: "#fbf0cc",
  red: "#d7022c",
  sage: "#629678",
};

/**
 * Envoltorio HTML con tablas y estilos en linea.
 *
 * No es nostalgia: los clientes de correo (Outlook y Gmail sobre todo) ignoran
 * buena parte del CSS moderno y no soportan flexbox de forma fiable. Las tablas
 * son la unica maquetacion que se ve igual en todos.
 */
function layout(input: { title: string; body: string; cta?: { label: string; url: string } }) {
  const button = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0;">
         <tr><td style="border-radius:12px;background:${COLORS.red};">
           <a href="${input.cta.url}" style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:${COLORS.cream};text-decoration:none;">${input.cta.label}</a>
         </td></tr>
       </table>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${input.title}</title></head>
<body style="margin:0;padding:0;background:${COLORS.navy};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.navy};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${COLORS.plum};border-radius:18px;border:1px solid rgba(251,240,204,0.12);">
        <tr><td style="padding:30px 28px;font-family:Helvetica,Arial,sans-serif;color:${COLORS.cream};">
          <div style="font-size:23px;font-weight:bold;letter-spacing:-0.5px;color:${COLORS.cream};">alfii</div>
          <div style="height:1px;background:rgba(251,240,204,0.12);margin:18px 0 22px;"></div>
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.25;color:${COLORS.cream};">${input.title}</h1>
          <div style="font-size:15px;line-height:1.65;color:rgba(251,240,204,0.85);">${input.body}</div>
          ${button}
        </td></tr>
      </table>
      <div style="max-width:520px;margin-top:16px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:rgba(251,240,204,0.4);text-align:center;">
        Este correo es solo sobre tu cuenta. Alfii nunca menciona por correo a las personas que analizas.
      </div>
    </td></tr>
  </table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Correos
// ---------------------------------------------------------------------------

export async function sendPasswordReset(input: { to: string; name?: string; token: string }) {
  const url = appUrl(`/nueva-contrasena?token=${encodeURIComponent(input.token)}`);
  const hola = input.name ? `${input.name}, ` : "";

  return send({
    to: input.to,
    subject: "Recupera el acceso a tu cuenta",
    html: layout({
      title: "Recupera tu acceso",
      body:
        `<p>${hola}pediste restablecer tu contrasena. El enlace caduca en 1 hora y ` +
        `solo se puede usar una vez.</p>` +
        `<p>Si no fuiste tu, ignora este correo: tu cuenta sigue como esta y nadie ` +
        `ha entrado.</p>`,
      cta: { label: "Crear contrasena nueva", url },
    }),
    text: `${hola}pediste restablecer tu contrasena.\n\nAbre este enlace (caduca en 1 hora):\n${url}\n\nSi no fuiste tu, ignora este correo.`,
  });
}

export async function sendPasswordChanged(input: { to: string; name?: string }) {
  const hola = input.name ? `${input.name}, ` : "";

  return send({
    to: input.to,
    subject: "Tu contrasena ha cambiado",
    html: layout({
      title: "Tu contrasena ha cambiado",
      body:
        `<p>${hola}la contrasena de tu cuenta se acaba de cambiar.</p>` +
        `<p><strong>Si no fuiste tu</strong>, escribe a team@alfii.ec ahora mismo: ` +
        `alguien podria tener acceso a tu cuenta.</p>`,
    }),
    text: `${hola}la contrasena de tu cuenta se acaba de cambiar.\n\nSi no fuiste tu, escribe a team@alfii.ec ahora mismo.`,
  });
}

export async function sendProfileCompleted(input: { to: string; name?: string; overall: number; tier: string }) {
  const hola = input.name ? `${input.name}, ` : "";

  return send({
    to: input.to,
    subject: "Matriz de Identidad completa",
    html: layout({
      title: "Ya te conozco",
      body:
        `<p>${hola}completaste tu Matriz de Identidad. Desde ahora cada analisis se ` +
        `calibra contigo: los scripts van a sonar a ti y no a un manual.</p>` +
        `<p>Tu carta quedo en <strong>${input.overall}</strong> (${input.tier}).</p>`,
      cta: { label: "Ver mi carta", url: appUrl("/heroe") },
    }),
    text: `${hola}completaste tu Matriz de Identidad. Tu carta quedo en ${input.overall} (${input.tier}).\n\n${appUrl("/heroe")}`,
  });
}

export async function sendAchievement(input: {
  to: string;
  name?: string;
  title: string;
  detail: string;
}) {
  const hola = input.name ? `${input.name}, ` : "";

  return send({
    to: input.to,
    subject: `Nuevo logro: ${input.title}`,
    html: layout({
      title: input.title,
      body: `<p>${hola}${input.detail}</p>`,
      cta: { label: "Ver mi progreso", url: appUrl("/heroe") },
    }),
    text: `${hola}${input.detail}\n\n${appUrl("/heroe")}`,
  });
}
