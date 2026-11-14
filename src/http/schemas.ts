import { z } from "zod";
import {
  DEMO_FALLBACK_LOCATION,
  incidentTypeForCategory,
  resolveCitizenCategory,
} from "../domain/citizen-reporting.js";

export const IncidentTypeSchema = z.enum([
  "medical",
  "fire",
  "flood",
  "infrastructure",
  "telecommunications",
  "other",
]);
export const SeveritySchema = z.enum(["critical", "urgent", "stable"]);
export const CitizenCategorySchema = z.enum([
  "medical",
  "fire_rescue",
  "disaster",
  "civic_hazard",
]);
export const LocationSourceSchema = z.enum([
  "geolocation",
  "manual_fallback",
  "demo_fallback",
]);
export const ReportInputModeSchema = z.enum([
  "text",
  "speech",
  "text_and_speech",
]);

export type IncidentType = z.infer<typeof IncidentTypeSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type CitizenCategory = z.infer<typeof CitizenCategorySchema>;

export const CreateEmergencyReportSchema = z
  .object({
    description: z.string().trim().min(10).max(4_000),
    incidentType: IncidentTypeSchema.optional(),
    category: z
      .union([CitizenCategorySchema, IncidentTypeSchema, z.literal("fire_hazmat")])
      .optional(),
    severity: SeveritySchema.optional(),
    urgency: SeveritySchema.optional(),
    location: z
      .string()
      .trim()
      .min(2)
      .max(160)
      .default(DEMO_FALLBACK_LOCATION.location),
    address: z.string().trim().max(240).optional(),
    reporterAlias: z.string().trim().max(80).default("Anonymous"),
    isAnonymous: z.boolean().default(true),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    locationSource: LocationSourceSchema.default("demo_fallback"),
    inputMode: ReportInputModeSchema.default("text"),
    language: z.string().trim().min(2).max(16).default("en"),
    evidencePaths: z.array(z.string().trim().min(1).max(240)).max(4).default([]),
  })
  .superRefine((report, context) => {
    if (!report.incidentType && !report.category) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "Choose a citizen emergency category.",
      });
    }
    if (!report.severity && !report.urgency) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["urgency"],
        message: "Choose Critical, Urgent, or Stable.",
      });
    }
  })
  .transform((report) => {
    const category = resolveCitizenCategory(report.category, report.incidentType);
    const incidentType =
      report.incidentType ?? incidentTypeForCategory(category);
    const severity = report.urgency ?? report.severity ?? "urgent";
    return {
      ...report,
      category,
      incidentType,
      severity,
      urgency: report.urgency ?? severity,
      address: report.address?.trim() || report.location,
    };
  });
export type CreateEmergencyReport = z.infer<
  typeof CreateEmergencyReportSchema
>;

export const EvidenceUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/jpg"]),
  contentBase64: z.string().min(32).max(6_000_000),
});
export type EvidenceUpload = z.infer<typeof EvidenceUploadSchema>;

export const UserRoleSchema = z.enum(["CITIZEN", "OPERATOR", "AUTHORITY"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const SignerRoleSchema = z.enum([
  "Gov. Operations Lead",
  "Disaster Coordinator",
  "Emergency Authority",
]);
export type SignerRole = z.infer<typeof SignerRoleSchema>;

export const AllocationItemSchema = z.object({
  sectorId: z.string().trim().min(1).max(80),
  allocatedCapacityMw: z.number().finite().min(0).max(45),
});

export const CreateReviewSchema = z
  .object({
    decision: z.enum(["approve", "sign", "modify", "reject"]),
    reviewer: z.string().trim().min(1).max(120).default("Dr. Arvind Rao"),
    role: UserRoleSchema.default("AUTHORITY"),
    signerRole: SignerRoleSchema.default("Disaster Coordinator"),
    signatureHash: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(1_000).default(""),
    items: z.array(AllocationItemSchema).length(4).optional(),
  })
  .superRefine((review, context) => {
    if (review.decision === "modify" && !review.items) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Modified plans must include all four sector allocations.",
      });
    }
    if (
      review.items &&
      review.items.reduce((total, item) => total + item.allocatedCapacityMw, 0) >
        45
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "The combined allocation cannot exceed 45 MW.",
      });
    }
  });
export type CreateReview = z.infer<typeof CreateReviewSchema>;

export const ModifyParametersSchema = z.object({
  role: UserRoleSchema.default("AUTHORITY"),
  reviewer: z.string().trim().min(1).max(120).default("City Authority"),
  sectorAllocations: z.array(AllocationItemSchema).min(1).max(4).optional(),
  incidentPriority: SeveritySchema.optional(),
  emergencyDemand: z.record(z.string(), z.number().finite().min(-45).max(45)).optional(),
  notes: z.string().trim().max(1_000).default(""),
});
export type ModifyParameters = z.infer<typeof ModifyParametersSchema>;

export const IncidentStatusSchema = z.object({
  status: z.enum(["contained", "resolved"]),
});

export const ManualOverrideSchema = z.object({
  sectorId: z.enum([
    "hospital_network",
    "water_infrastructure",
    "telecommunications",
    "emergency_operations",
  ]),
  requestedCapacityMw: z.number().finite().min(0).max(45),
});
export type ManualOverride = z.infer<typeof ManualOverrideSchema>;

export const ReviewResourceRequestSchema = z.object({
  decision: z
    .enum(["APPROVE", "MODIFY", "REJECT", "approve", "modify", "reject"])
    .transform((val) => val.toUpperCase() as "APPROVE" | "MODIFY" | "REJECT"),
  allocatedAmount: z.number().finite().positive().optional(),
  notes: z.string().trim().max(1_000).default(""),
  reviewerRole: z.string().trim().max(120).default("Authority EOC Lead"),
});
export type ReviewResourceRequest = z.infer<typeof ReviewResourceRequestSchema>;
