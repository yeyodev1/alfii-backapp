import express, { Application } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { loadUser } from "../middlewares/optionalAuth.middleware";
import { validateBody } from "../middlewares/validate.middleware";
import { uploadScreenshot, uploadTextExport, uploadAudio } from "../middlewares/upload.middleware";
import { analysisLimiter, chatLimiter, authLimiter } from "../middlewares/rateLimit.middleware";

import * as auth from "../controllers/auth.controller";
import * as analysis from "../controllers/analysis.controller";
import * as targets from "../controllers/target.controller";
import * as onboarding from "../controllers/onboarding.controller";
import * as card from "../controllers/card.controller";
import * as legal from "../controllers/legal.controller";
import * as admin from "../controllers/admin.controller";
import { adminOnly } from "../middlewares/admin.middleware";
import * as cron from "../controllers/cron.controller";

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
  // Recuperacion de contrasena. Con authLimiter: sin el, este endpoint permite
  // sondear correos y disparar envios masivos desde nuestra cuenta de Resend.
  router.post(
    "/auth/forgot-password",
    authLimiter,
    validateBody(auth.forgotPasswordSchema),
    auth.forgotPassword
  );
  router.post(
    "/auth/reset-password",
    authLimiter,
    validateBody(auth.resetPasswordSchema),
    auth.resetPasswordHandler
  );
  router.post(
    "/auth/change-password",
    ...authed,
    validateBody(auth.changePasswordSchema),
    auth.changePasswordHandler
  );
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
  router.patch(
    "/me/persona",
    ...authed,
    validateBody(onboarding.personaSchema),
    onboarding.setPersona
  );
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
  // Import de conversacion completa: preview sin LLM, analisis con.
  router.post("/import/preview", ...authed, uploadTextExport, analysis.previewImport);
  router.post(
    "/analyze/first/text",
    ...authed,
    analysisLimiter,
    uploadTextExport,
    analysis.analyzeFirstText
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
  router.post(
    "/targets/:id/merge",
    ...authed,
    validateBody(targets.mergeTargetSchema),
    targets.merge
  );
  router.patch(
    "/targets/:id/milestone",
    ...authed,
    validateBody(targets.patchMilestoneSchema),
    targets.patchMilestone
  );
  router.patch(
    "/targets/:id/her-profile",
    ...authed,
    validateBody(targets.patchHerProfileSchema),
    targets.patchHerProfile
  );
  router.delete("/targets/:id", ...authed, targets.destroy);
  router.get("/targets/:id/messages", ...authed, targets.messages);
  router.get("/targets/:id/card", ...authed, targets.card);
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
  router.post(
    "/targets/:id/analyze/text",
    ...authed,
    analysisLimiter,
    uploadTextExport,
    analysis.analyzeTextForTarget
  );
  router.post(
    "/targets/:id/transcribe",
    ...authed,
    analysisLimiter,
    uploadAudio,
    analysis.transcribeForTarget
  );

  // --- administracion: gasto de IA global y por usuario ---
  router.get("/admin/overview", ...authed, adminOnly, admin.overview);
  router.get("/admin/users", ...authed, adminOnly, admin.users);
  router.get("/admin/users/:id", ...authed, adminOnly, admin.userDetail);
  router.patch(
    "/admin/users/:id/vip",
    ...authed,
    adminOnly,
    validateBody(admin.patchVipSchema),
    admin.patchVip
  );
  router.patch(
    "/admin/users/:id/admin",
    ...authed,
    adminOnly,
    validateBody(admin.patchAdminSchema),
    admin.patchAdmin
  );
  router.get("/admin/models", ...authed, adminOnly, admin.models);
  router.patch(
    "/admin/models",
    ...authed,
    adminOnly,
    validateBody(admin.patchModelSchema),
    admin.patchModel
  );
  router.get("/admin/providers", ...authed, adminOnly, admin.providers);

  // --- crons de Vercel (protegidos por CRON_SECRET, ver cron.controller) ---
  router.get("/cron/reengagement", cron.reengagementCron);

  // --- privacidad: derechos implementados en la app, no un correo a atender ---
  router.get("/privacy/export", ...authed, legal.exportData);
  router.delete("/account/purge", ...authed, legal.purge);
}

export default routerApi;
