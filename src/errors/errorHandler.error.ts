import { Response } from "express";
import axios from "axios";

export class ErrorHandler {
  private slackWebhookUrl: string;

  constructor(slackWebhookUrl: string) {
    this.slackWebhookUrl = slackWebhookUrl;
  }

  handleHttpError(res: Response, message: string, status: number, error: any) {
    console.error(`[${status}] ${message}`, error.details || "");

    if (this.slackWebhookUrl && status >= 500) {
      this.notifySlack(message, status, error).catch(() => {});
    }

    /**
     * Los `details` viajan al cliente SOLO en errores 4xx.
     *
     * PORQUE: un 4xx es algo sobre lo que el usuario puede actuar y a veces
     * necesita el dato para hacerlo (que expediente esta duplicado, que
     * recursos de crisis mostrar, por que la captura es ilegible). Un 5xx es un
     * fallo nuestro y sus detalles pueden contener trazas, nombres de modelo o
     * fragmentos de prompt: eso no sale de aqui.
     */
    const body: Record<string, unknown> = { message };
    if (status < 500 && error.details) body.details = error.details;

    res.status(status).json(body);
  }

  private async notifySlack(message: string, status: number, error: any) {
    await axios.post(this.slackWebhookUrl, {
      text: `:rotating_light: *Error ${status}*\n>${message}\n\`\`\`${JSON.stringify(error.details || error.stack || "", null, 2)}\`\`\``,
    });
  }
}
