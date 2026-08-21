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
 * Lo que si se envia: recuperacion de contrasena, aviso de cambio de contrasena,
 * logros del propio usuario y recordatorios de re-enganche (que hablan solo de
 * la cuenta y la "partida" en abstracto). Nada mas.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

import { createHmac } from "crypto";

/** Enlace de gestion de correos (baja con un clic, sin login). Misma derivacion
 *  que emailPrefs.service.unsubscribeToken; se duplica aqui para no importar
 *  ese modulo desde el de correo (importa appUrl de este). */
function prefsUrlFor(userId?: string): string | undefined {
  if (!userId) return undefined;
  const t = createHmac("sha256", env.JWT_SECRET).update(`unsub:${userId}`).digest("hex").slice(0, 40);
  return appUrl(`/correos?u=${encodeURIComponent(userId)}&t=${t}`);
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
function layout(input: { title: string; body: string; cta?: { label: string; url: string }; prefsUrl?: string }) {
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
        <br><span style="color:rgba(251,240,204,0.55);">Pronto: Alfii en WhatsApp, con el mismo contexto de tus expedientes.</span>
        ${input.prefsUrl ? `<br><a href="${input.prefsUrl}" style="color:rgba(251,240,204,0.6);text-decoration:underline;">Gestionar mis correos o darme de baja</a>` : ""}
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

export async function sendProfileCompleted(input: { userId?: string; to: string; name?: string; overall: number; tier: string }) {
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
          prefsUrl: prefsUrlFor(input.userId),
    }),
    text: `${hola}completaste tu Matriz de Identidad. Tu carta quedo en ${input.overall} (${input.tier}).\n\n${appUrl("/heroe")}`,
  });
}

export async function sendAchievement(input: {
  userId?: string;
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
          prefsUrl: prefsUrlFor(input.userId),
    }),
    text: `${hola}${input.detail}\n\n${appUrl("/heroe")}`,
  });
}

/**
 * Re-enganche por inactividad, en tres etapas de tono creciente.
 *
 * Regla dura intacta: aqui no se menciona a NADIE que el usuario analice.
 * Solo se habla de su cuenta y de "la partida" en abstracto. Cada etapa trae
 * un par de variantes de asunto para que la secuencia no huela a robot.
 */
const REENGAGEMENT_STAGES: {
  subjects: string[];
  title: string;
  body: (hola: string) => string;
  text: (hola: string) => string;
}[] = [
  {
    subjects: ["¿Sigues en la partida?", "Te guardamos el sitio"],
    title: "La partida sigue abierta",
    body: (hola) =>
      `<p>${hola}hace unos dias que no pasas por aqui y solo queria decirte que ` +
      `todo sigue donde lo dejaste.</p>` +
      `<p>Si hay una conversacion dandote vueltas, subela y la miramos juntos. ` +
      `Dos minutos y sales con la jugada clara.</p>`,
    text: (hola) =>
      `${hola}hace unos dias que no pasas por aqui. Todo sigue donde lo dejaste.\n\n` +
      `Si hay una conversacion dandote vueltas, subela y la miramos juntos.`,
  },
  {
    subjects: ["Tu estratega sigue aqui", "Una jugada te espera"],
    title: "Sigo de tu lado",
    body: (hola) =>
      `<p>${hola}una semana sin ti. No pasa nada — pero si dejaste algo a medias, ` +
      `recuerda que el que deja de jugar no empata: pierde por abandono.</p>` +
      `<p>Entra, revisa tu expediente y te digo cual es el siguiente movimiento.</p>`,
    text: (hola) =>
      `${hola}una semana sin ti. Si dejaste algo a medias, entra y te digo el siguiente movimiento.`,
  },
  {
    subjects: ["¿Lo dejamos aqui?", "Ultima jugada"],
    title: "Ultima jugada",
    body: (hola) =>
      `<p>${hola}llevo dos semanas guardandote el sitio y no quiero llenarte el ` +
      `correo. Este es el ultimo recordatorio que te mando.</p>` +
      `<p>Si vuelves, seguimos exactamente donde lo dejamos. Y si no, aqui me ` +
      `quedo: tu cuenta no caduca.</p>`,
    text: (hola) =>
      `${hola}este es el ultimo recordatorio que te mando. Si vuelves, seguimos donde lo dejamos. Tu cuenta no caduca.`,
  },
];

export async function sendReengagement(input: { userId?: string; to: string; name?: string; stage: number }) {
  const tpl = REENGAGEMENT_STAGES[Math.min(input.stage, REENGAGEMENT_STAGES.length - 1)];
  const hola = input.name ? `${input.name}, ` : "";
  // Variante pseudo-aleatoria pero estable por destinatario+etapa, para que un
  // reintento del cron no cambie el asunto del mismo correo.
  const subject = tpl.subjects[(input.to.length + input.stage) % tpl.subjects.length];

  return send({
    to: input.to,
    subject,
    html: layout({
      title: tpl.title,
      body: tpl.body(hola),
      cta: { label: "Volver a la partida", url: appUrl("/") },
          prefsUrl: prefsUrlFor(input.userId),
    }),
    text: `${tpl.text(hola)}\n\n${appUrl("/")}\n\n¿No quieres estos recordatorios? Date de baja aqui: ${prefsUrlFor(input.userId) ?? appUrl("/settings")}`,
  });
}
