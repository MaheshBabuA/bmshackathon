import { readFile } from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { ZodError } from "zod";
import type { Database } from "./database.types.js";
import { loadConfig } from "./config.js";
import {
  CreateEmergencyReportSchema,
  CreateReviewSchema,
  EvidenceUploadSchema,
  IncidentStatusSchema,
  ManualOverrideSchema,
  ModifyParametersSchema,
  ReviewResourceRequestSchema,
} from "./http/schemas.js";
import {
  createRecommendation,
  databaseIsReachable,
  getDashboard,
  getEmergencyReport,
  getIncidentAnalysis,
  getLiveResourceNegotiation,
  getPublicAlerts,
  publishCivicBroadcast,
  getResourceRequest,
  getResourceRequestRecommendation,
  getSectors,
  getSimulationScenarios,
  initiateCrisisSimulation,
  listIncidents,
  listResourceRequests,
  markIncidentStatus,
  modifyAllocationParameters,
  resetCrisisSimulation,
  resetPlanSignatures,
  reviewAllocationPlan,
  reviewResourceRequest,
  ServiceError,
  simulateDynamicAllocation,
  submitEmergencyReport,
  submitIncidentAllocationForReview,
  transferEmergencyReserve,
  uploadEmergencyEvidence,
} from "./services/crisis-service.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PROJECT_ROOT = process.cwd();
const SCREENS_DIRECTORY = path.join(
  PROJECT_ROOT,
  "stitch_crisisgrid_emergency_command_platform",
);
const SCREEN_SLUGS = new Set([
  "allocation_confirmed_dispatched",
  "authority_review_authorization",
  "citizen_emergency_home",
  "city_command_center",
  "emergency_incident_intake",
  "live_incidents_system_impact",
]);

function createDatabaseClient(): SupabaseClient<Database> | null {
  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return null;
  return createClient<Database>(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function asyncRoute(
  handler: (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "invalid_request",
      message: "Check the submitted values and try again.",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    response.status(400).json({
      error: "invalid_json",
      message: "The request body must be valid JSON.",
    });
    return;
  }

  if (error instanceof ServiceError) {
    if (error.statusCode >= 500) {
      console.error("CRISISGRID service error:", {
        message: error.message,
        cause: error.cause,
        path: request.path,
      });
    }
    response.status(error.statusCode).json({
      error:
        error.statusCode === 503
          ? "service_unavailable"
          : error.statusCode === 404
            ? "not_found"
            : error.statusCode === 409
              ? "conflict"
              : error.statusCode === 422
                ? "invalid_state"
                : "service_error",
      message: error.message,
    });
    return;
  }

  console.error("Unhandled CRISISGRID request error:", {
    error,
    path: request.path,
  });
  response.status(500).json({
    error: "internal_error",
    message: "The request could not be completed. Check the server logs.",
  });
};

export function createApp(
  database: SupabaseClient<Database> | null = createDatabaseClient(),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    if (request.path === "/api/emergency-reports/evidence") {
      express.json({ limit: "4mb", strict: true })(request, response, next);
      return;
    }
    express.json({ limit: "16kb", strict: true })(request, response, next);
  });

  const api = express.Router();

  api.get(
    "/health",
    asyncRoute(async (_request, response) => {
      const reachable = await databaseIsReachable(database);
      response.status(reachable ? 200 : 503).json({
        status: reachable ? "ok" : database ? "unavailable" : "not_configured",
        database: reachable ? "connected" : "not_connected",
        simulationOnly: true,
      });
    }),
  );

  api.get(
    "/dashboard",
    asyncRoute(async (_request, response) => {
      response.json(await getDashboard(database));
    }),
  );

  api.get(
    "/timeline",
    asyncRoute(async (_request, response) => {
      const data = await getDashboard(database);
      response.json({ timeline: data.incidentTimeline || [] });
    }),
  );

  api.get(
    "/sectors",
    asyncRoute(async (_request, response) => {
      response.json(await getSectors(database));
    }),
  );

  api.get(
    "/incidents",
    asyncRoute(async (_request, response) => {
      response.json(await listIncidents(database));
    }),
  );

  api.get(
    "/incidents/:incidentId/analysis",
    asyncRoute(async (request, response) => {
      const incidentId = request.params.incidentId;
      if (!incidentId || !isUuid(incidentId)) {
        throw new ServiceError("A valid incident ID is required.", 400);
      }
      response.json(await getIncidentAnalysis(database, incidentId));
    }),
  );

  api.post(
    "/incidents/:incidentId/authority-review",
    asyncRoute(async (request, response) => {
      const incidentId = request.params.incidentId;
      if (!incidentId || !isUuid(incidentId)) {
        throw new ServiceError("A valid incident ID is required.", 400);
      }
      response.status(201).json(
        await submitIncidentAllocationForReview(database, incidentId),
      );
    }),
  );

  api.post(
    "/incidents/:incidentId/manual-override",
    asyncRoute(async (request, response) => {
      const incidentId = request.params.incidentId;
      if (!incidentId || !isUuid(incidentId)) {
        throw new ServiceError("A valid incident ID is required.", 400);
      }
      const config = loadConfig();
      if (!config.demoAuthorityToken) {
        throw new ServiceError(
          "Manual overrides are disabled. Configure CRISISGRID_DEMO_AUTHORITY_TOKEN on the server.",
          503,
        );
      }
      const suppliedToken = request.get("x-crisisgrid-authority-token") ?? "";
      const expected = Buffer.from(config.demoAuthorityToken);
      const supplied = Buffer.from(suppliedToken);
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      ) {
        throw new ServiceError("A valid demo authority token is required.", 401);
      }
      const override = ManualOverrideSchema.parse(request.body);
      response.status(201).json(
        await submitIncidentAllocationForReview(
          database,
          incidentId,
          override,
        ),
      );
    }),
  );

  api.post(
    "/incidents",
    asyncRoute(async (request, response) => {
      const report = CreateEmergencyReportSchema.parse(request.body);
      response.status(201).json(
        await submitEmergencyReport(database, report),
      );
    }),
  );

  api.post(
    "/emergency-reports",
    asyncRoute(async (request, response) => {
      const report = CreateEmergencyReportSchema.parse(request.body);
      response.status(201).json(
        await submitEmergencyReport(database, report),
      );
    }),
  );

  api.post(
    "/emergency-reports/evidence",
    asyncRoute(async (request, response) => {
      const upload = EvidenceUploadSchema.parse(request.body);
      const result = await uploadEmergencyEvidence(database, upload);
      response.status(result.stored ? 201 : 200).json(result);
    }),
  );

  api.get(
    "/emergency-reports/:reportId",
    asyncRoute(async (request, response) => {
      const reportId = request.params.reportId;
      if (!reportId || !isUuid(reportId)) {
        throw new ServiceError("A valid emergency report ID is required.", 400);
      }
      response.json(await getEmergencyReport(database, reportId));
    }),
  );

  api.patch(
    "/incidents/:incidentId/status",
    asyncRoute(async (request, response) => {
      const incidentId = request.params.incidentId;
      if (
        !incidentId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          incidentId,
        )
      ) {
        throw new ServiceError("A valid incident ID is required.", 400);
      }
      const body = IncidentStatusSchema.parse(request.body);
      response.json(
        await markIncidentStatus(database, incidentId, body.status),
      );
    }),
  );

  api.post(
    "/allocation/simulate",
    asyncRoute(async (_request, response) => {
      response.json(await simulateDynamicAllocation(database));
    }),
  );

  api.post(
    "/reserve/transfer",
    asyncRoute(async (_request, response) => {
      response.json(await transferEmergencyReserve(database));
    }),
  );

  api.post(
    "/allocation-plans/recommend",
    asyncRoute(async (_request, response) => {
      response.status(201).json(await createRecommendation(database));
    }),
  );

  api.get(
    "/allocation-plans/pending-review",
    asyncRoute(async (_request, response) => {
      const dashboard = await getDashboard(database);
      if (!dashboard.recommendedPlan) {
        throw new ServiceError(
          "No allocation plan is currently pending review.",
          404,
        );
      }
      response.json({
        success: true,
        plan: dashboard.recommendedPlan,
        ...dashboard.recommendedPlan,
      });
    }),
  );

  api.post(
    "/allocation-plans/:planId/review",
    asyncRoute(async (request, response) => {
      const planId = request.params.planId;
      if (
        !planId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          planId,
        )
      ) {
        throw new ServiceError("A valid allocation plan ID is required.", 400);
      }
      const roleHeader = request.header("x-user-role")?.toUpperCase();
      const body = {
        ...request.body,
        ...(roleHeader ? { role: roleHeader } : {}),
      };
      const review = CreateReviewSchema.parse(body);
      response.json(await reviewAllocationPlan(database, planId, review));
    }),
  );

  api.post(
    "/allocation-plans/:planId/modify",
    asyncRoute(async (request, response) => {
      const planId = request.params.planId;
      if (
        !planId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          planId,
        )
      ) {
        throw new ServiceError("A valid allocation plan ID is required.", 400);
      }
      const roleHeader = request.header("x-user-role")?.toUpperCase();
      const body = {
        ...request.body,
        ...(roleHeader ? { role: roleHeader } : {}),
      };
      const params = ModifyParametersSchema.parse(body);
      response.json(await modifyAllocationParameters(database, planId, params));
    }),
  );

  api.post(
    "/allocation-plans/:planId/reset-signatures",
    asyncRoute(async (request, response) => {
      const planId = request.params.planId;
      if (
        !planId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          planId,
        )
      ) {
        throw new ServiceError("A valid allocation plan ID is required.", 400);
      }
      const targetCount = request.body?.count === 1 ? 1 : 0;
      response.json(await resetPlanSignatures(database, planId, targetCount));
    }),
  );

  api.get(
    "/simulation/scenarios",
    asyncRoute(async (_request, response) => {
      response.json(getSimulationScenarios());
    }),
  );

  api.post(
    "/simulation/initiate",
    asyncRoute(async (request, response) => {
      const scenario =
        typeof request.body?.scenario === "string"
          ? request.body.scenario
          : typeof request.body?.scenarioKey === "string"
            ? request.body.scenarioKey
            : "industrial_fire";
      response
        .status(201)
        .json(await initiateCrisisSimulation(database, scenario));
    }),
  );

  api.post(
    "/simulation/reset",
    asyncRoute(async (_request, response) => {
      response.json(await resetCrisisSimulation(database));
    }),
  );

  api.get(
    "/resource-requests",
    asyncRoute(async (request, response) => {
      const incidentId =
        typeof request.query?.incident_id === "string"
          ? request.query.incident_id
          : undefined;
      response.json(await listResourceRequests(database, incidentId));
    }),
  );

  api.get(
    "/resource-requests/:id",
    asyncRoute(async (request, response) => {
      const id = request.params.id;
      if (!id) throw new ServiceError("Resource request ID is required.", 400);
      response.json(await getResourceRequest(database, id));
    }),
  );

  api.get(
    "/resource-requests/:id/recommendation",
    asyncRoute(async (request, response) => {
      const id = request.params.id;
      if (!id) throw new ServiceError("Resource request ID is required.", 400);
      response.json(await getResourceRequestRecommendation(database, id));
    }),
  );

  api.post(
    "/resource-requests/:id/review",
    asyncRoute(async (request, response) => {
      const id = request.params.id;
      if (!id) throw new ServiceError("Resource request ID is required.", 400);
      const review = ReviewResourceRequestSchema.parse(request.body);
      response.json(await reviewResourceRequest(database, id, review));
    }),
  );

  api.get(
    "/negotiation/current",
    asyncRoute(async (request, response) => {
      const scenario =
        typeof request.query?.scenario === "string"
          ? request.query.scenario
          : undefined;
      response.json(await getLiveResourceNegotiation(database, scenario));
    }),
  );

  api.post(
    "/negotiation/reallocate",
    asyncRoute(async (request, response) => {
      const { organizationName, resourceType, requestedAmountMw, reason, scenario } = request.body ?? {};
      response.json(
        await getLiveResourceNegotiation(database, scenario, {
          organizationName: typeof organizationName === "string" ? organizationName : "BMS Hospital",
          resourceType: typeof resourceType === "string" ? resourceType : "Emergency Electricity",
          requestedAmountMw: typeof requestedAmountMw === "number" ? requestedAmountMw : 3,
          reason: typeof reason === "string" ? reason : "Critical ICU trauma surge",
        }),
      );
    }),
  );

  api.get(
    "/public/alerts",
    asyncRoute(async (_request, response) => {
      response.json(await getPublicAlerts(database));
    }),
  );

  api.post(
    "/public/broadcast",
    asyncRoute(async (request, response) => {
      response.json(await publishCivicBroadcast(database, request.body ?? {}));
    }),
  );

  app.use("/api", api);

  app.get("/login", (_request, response) => {
    response.sendFile(path.join(PROJECT_ROOT, "public", "login.html"));
  });

  app.get("/access", (_request, response) => {
    response.sendFile(path.join(PROJECT_ROOT, "public", "access.html"));
  });

  app.get("/public", (_request, response) => {
    response.sendFile(path.join(PROJECT_ROOT, "public", "public_information.html"));
  });

  app.get("/public-alerts", (_request, response) => {
    response.redirect("/public");
  });

  app.get("/command", (_request, response) => {
    response.redirect(
      "/stitch_crisisgrid_emergency_command_platform/city_command_center/code.html",
    );
  });

  app.get("/incidents", (_request, response) => {
    response.redirect(
      "/stitch_crisisgrid_emergency_command_platform/live_incidents_system_impact/code.html",
    );
  });

  app.get("/authority", (_request, response) => {
    response.redirect(
      "/stitch_crisisgrid_emergency_command_platform/authority_review_authorization/code.html",
    );
  });

  app.get("/capacity", (_request, response) => {
    response.redirect(
      "/stitch_crisisgrid_emergency_command_platform/city_command_center/code.html#section-infrastructure-sectors",
    );
  });

  app.get("/negotiation", (_request, response) => {
    response.redirect(
      "/stitch_crisisgrid_emergency_command_platform/city_command_center/code.html?action=negotiate",
    );
  });

  app.get(
    "/stitch_crisisgrid_emergency_command_platform/:screen/code.html",
    asyncRoute(async (request, response, next) => {
      const screen = request.params.screen;
      if (!screen || !SCREEN_SLUGS.has(screen)) {
        next();
        return;
      }

      const screenPath = path.join(SCREENS_DIRECTORY, screen, "code.html");
      const html = await readFile(screenPath, "utf8");
      const wiredHtml = html.replace(
        /<\/body\s*>/i,
        '<script src="/crisisgrid.js" defer></script></body>',
      );
      if (wiredHtml === html) {
        throw new Error(`Could not inject the data client into ${screen}/code.html.`);
      }

      response.type("html").send(wiredHtml);
    }),
  );

  app.get("/crisisgrid.js", (_request, response, next) => {
    response.sendFile(path.join(PROJECT_ROOT, "public", "crisisgrid.js"), (error) => {
      if (error) next(error);
    });
  });

  app.get("/crisisgrid_logo.png", (_request, response, next) => {
    response.sendFile(path.join(PROJECT_ROOT, "public", "crisisgrid_logo.png"), (error) => {
      if (error) next(error);
    });
  });

  app.use(express.static(path.join(PROJECT_ROOT, "public")));

  app.get("/", (_request, response) => {
    response.redirect("/access");
  });

  app.use(
    "/stitch_crisisgrid_emergency_command_platform",
    express.static(SCREENS_DIRECTORY, {
      dotfiles: "deny",
      index: false,
      fallthrough: true,
    }),
  );

  app.use((_request, response) => {
    response.status(404).json({
      error: "not_found",
      message: "The requested resource was not found.",
    });
  });

  app.use(errorHandler);
  return app;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
