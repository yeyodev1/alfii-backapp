import { Schema, model, Document } from "mongoose";

/**
 * Configuracion runtime de la aplicacion, por clave.
 *
 * Existe para lo que debe poder cambiarse SIN redeploy (hoy: que modelo
 * atiende cada tarea). Lo que es secreto o estructural sigue en env. Un
 * documento por clave; el valor es Mixed a proposito: cada clave define su
 * propia forma y la valida su servicio, no el schema.
 */
export interface IAppConfig extends Document {
  key: string;
  value: unknown;
  updatedAt: Date;
  createdAt: Date;
}

const appConfigSchema = new Schema<IAppConfig>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const AppConfigModel = model<IAppConfig>("AppConfig", appConfigSchema);
