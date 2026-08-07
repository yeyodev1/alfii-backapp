import express, { Application } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { loadUser } from "../middlewares/optionalAuth.middleware";
import { validateBody } from "../middlewares/validate.middleware";
import { uploadScreenshot } from "../middlewares/upload.middleware";
import { analysisLimiter, chatLimiter, authLimiter } from "../middlewares/rateLimit.middleware";

import * as auth from "../controllers/auth.controller";
import * as analysis from "../controllers/analysis.controller";
import * as targets from "../controllers/target.controller";
import * as onboarding from "../controllers/onboarding.controller";
import * as card from "../controllers/card.controller";
import * as legal from "../controllers/legal.controller";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  const authed = [authMiddleware, loadUser] as const;

  // --- legal (publico: consultable antes de registrarse) ---
  router.get("/legal/current", legal.current);
  router.get("/legal/meta", legal.meta);
  router.post("/legal/accept", ...authed, validateBody(legal.acceptSchema), legal.accept);
  router.get("/legal/my-acceptances", ...authed, legal.myAcceptances);

  // --- auth ---
  router.post("/auth/anonymous", authLimiter, auth.anonymous);
  router.post(
    "/auth/register",
    authLimiter,
    ...authed,
    validateBody(auth.registerBodySchema),
    auth.register
  );
  router.post("/auth/login", authLimiter, validateBody(auth.loginBodySchema), auth.login);
  router.get("/auth/me", ...authed, auth.me);

  // --- onboarding (La Auditoria) ---
  router.get("/onboarding/opener", ...authed, onboarding.opener);
  router.post(
    "/onboarding/message",
    ...authed,
    validateBody(onboarding.onboardingBodySchema),
    onboarding.message
  );
  router.post(
    "/onboarding/lesson-seen",
    ...authed,
    validateBody(onboarding.lessonSeenSchema),
    onboarding.markLessonSeen
  );

  // --- perfil ---
  router.get("/profile", ...authed, onboarding.profile);
  router.get("/profile/completeness", ...authed, onboarding.completeness);
  // La carta de stats. El path es /me/card y no /profile/card porque es el que
  // ya consume el cliente: cambiarlo aqui romperia el frontend sin ganar nada.
  router.get("/me/card", ...authed, card.getMyCard);

  // --- analisis ---
  router.post(
    "/analyze/first",
    ...authed,
    analysisLimiter,
    uploadScreenshot,
    analysis.analyzeFirst
  );
  router.post(
    "/targets/confirm",
    ...authed,
    validateBody(analysis.confirmTargetSchema),
    analysis.confirmTarget
  );
  router.get("/analyses/:id", ...authed, analysis.getAnalysis);
  router.post("/analyses/:id/recalibrate", ...authed, analysisLimiter, analysis.recalibrate);
  router.patch(
    "/analyses/:id/script",
    ...authed,
    validateBody(analysis.scriptFeedbackSchema),
    analysis.submitScriptFeedback
  );

  // --- expedientes ---
  router.get("/targets", ...authed, targets.index);
  router.get("/targets/:id", ...authed, targets.show);
  router.patch("/targets/:id", ...authed, validateBody(targets.patchTargetSchema), targets.patch);
  router.patch(
    "/targets/:id/her-profile",
    ...authed,
    validateBody(targets.patchHerProfileSchema),
    targets.patchHerProfile
  );
  router.delete("/targets/:id", ...authed, targets.destroy);
  router.get("/targets/:id/messages", ...authed, targets.messages);
  router.get("/targets/:id/greeting", ...authed, targets.greeting);
  router.post(
    "/targets/:id/chat",
    ...authed,
    chatLimiter,
    validateBody(targets.chatBodySchema),
    targets.chat
  );
  router.post(
    "/targets/:id/analyze",
    ...authed,
    analysisLimiter,
    uploadScreenshot,
    analysis.analyzeForTarget
  );

  // --- privacidad: derechos implementados en la app, no un correo a atender ---
  router.get("/privacy/export", ...authed, legal.exportData);
  router.delete("/account/purge", ...authed, legal.purge);
}

export default routerApi;
