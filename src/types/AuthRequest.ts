import { Request } from "express";
import type { IUser } from "../models/user.model";

export interface JwtPayload {
  userId: string;
  email?: string;
  accountType: "anonymous" | "registered";
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
  /** Documento completo, cargado por loadUser. */
  currentUser?: IUser;
  file?: Express.Multer.File;
}
