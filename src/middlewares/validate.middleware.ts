import { Response, NextFunction } from "express";
import type { ZodType } from "zod";
import type { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";

export function validateBody(schema: ZodType) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return next(new CustomError(detail, 400, { issues: result.error.issues }));
    }
    req.body = result.data;
    next();
  };
}
