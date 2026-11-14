import type { IncidentType, Severity } from "../http/schemas.js";
import type { SectorDemand } from "./allocation.js";
import { analyzeIncidentImpact, describeIncidentType, type IncidentImpact } from "./incidents.js";

export const CITIZEN_CATEGORIES = [
  "medical",
  "fire_rescue",
  "disaster",
  "civic_hazard",
] as const;

export type CitizenCategory = (typeof CITIZEN_CATEGORIES)[number];

export const CONFIRMATION_STATUSES = [
  "report_received",
  "triaged",
  "dispatch_requested",
  "authority_review",
  "response_active",
] as const;

export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const CONFIRMATION_LABELS: Record<ConfirmationStatus, string> = {
  report_received: "REPORT RECEIVED",
  triaged: "TRIAGED",
  dispatch_requested: "DISPATCH REQUESTED",
  authority_review: "AUTHORITY REVIEW",
  response_active: "RESPONSE ACTIVE",
};

export const DEMO_FALLBACK_LOCATION = {
  location: "Indiranagar, 100ft Rd",
  address: "Plot 42, 12th Main Road, HAL 2nd Stage, Indiranagar, Bengaluru",
  latitude: 12.9716,
  longitude: 77.6412,
} as const;

const SECTOR_NAMES: Record<string, string> = {
  hospital_network: "Hospital Network",
  water_infrastructure: "Water Infrastructure",
  telecommunications: "Telecommunications",
  emergency_operations: "Emergency Operations",
};

const CATEGORY_TO_INCIDENT_TYPE: Record<CitizenCategory, IncidentType> = {
  medical: "medical",
  fire_rescue: "fire",
  disaster: "flood",
  civic_hazard: "infrastructure",
};

const INCIDENT_TYPE_TO_CATEGORY: Record<IncidentType, CitizenCategory> = {
  medical: "medical",
  fire: "fire_rescue",
  flood: "disaster",
  infrastructure: "civic_hazard",
  telecommunications: "civic_hazard",
  other: "civic_hazard",
};

const AFFECTED_SECTORS: Record<
  CitizenCategory,
  Record<Severity, readonly string[]>
> = {
  medical: {
    critical: ["hospital_network", "emergency_operations"],
    urgent: ["hospital_network", "emergency_operations"],
    stable: ["hospital_network"],
  },
  fire_rescue: {
    critical: [
      "emergency_operations",
      "water_infrastructure",
      "telecommunications",
    ],
    urgent: ["emergency_operations", "water_infrastructure"],
    stable: ["emergency_operations"],
  },
  disaster: {
    critical: [
      "water_infrastructure",
      "emergency_operations",
      "hospital_network",
    ],
    urgent: ["water_infrastructure", "emergency_operations"],
    stable: ["water_infrastructure"],
  },
  civic_hazard: {
    critical: [
      "telecommunications",
      "emergency_operations",
      "water_infrastructure",
    ],
    urgent: ["telecommunications", "emergency_operations"],
    stable: ["telecommunications"],
  },
};

export function isCitizenCategory(value: string): value is CitizenCategory {
  return (CITIZEN_CATEGORIES as readonly string[]).includes(value);
}

export function resolveCitizenCategory(
  category?: string,
  incidentType?: string,
): CitizenCategory {
  if (category && isCitizenCategory(category)) return category;
  if (incidentType && incidentType in INCIDENT_TYPE_TO_CATEGORY) {
    return INCIDENT_TYPE_TO_CATEGORY[incidentType as IncidentType];
  }
  if (incidentType === "fire_hazmat") return "fire_rescue";
  return "civic_hazard";
}

export function incidentTypeForCategory(category: CitizenCategory): IncidentType {
  return CATEGORY_TO_INCIDENT_TYPE[category];
}

export function describeCitizenCategory(category: CitizenCategory): string {
  switch (category) {
    case "medical":
      return "Medical emergency";
    case "fire_rescue":
      return "Fire rescue incident";
    case "disaster":
      return "Disaster incident";
    case "civic_hazard":
      return "Civic hazard";
  }
}

export function confirmationLabel(status: ConfirmationStatus): string {
  return CONFIRMATION_LABELS[status];
}

export function sectorDisplayName(sectorId: string): string {
  return SECTOR_NAMES[sectorId] ?? sectorId;
}

export interface CitizenTriageResult {
  category: CitizenCategory;
  incidentType: IncidentType;
  severity: Severity;
  title: string;
  affectedSectorIds: string[];
  affectedSectors: { id: string; name: string }[];
  impacts: IncidentImpact[];
  automatedTriage: true;
  isEscalated: boolean;
  responseUnits: number;
  allocationRecommended: boolean;
  rationale: string;
}

export function triageCitizenReport(
  sectors: readonly SectorDemand[],
  input: {
    category?: string;
    incidentType?: IncidentType | string;
    urgency?: Severity;
    severity?: Severity;
    location?: string;
  },
): CitizenTriageResult {
  const category = resolveCitizenCategory(input.category, input.incidentType);
  const incidentType = incidentTypeForCategory(category);
  const severity = input.urgency ?? input.severity ?? "urgent";
  const affectedSectorIds = [...AFFECTED_SECTORS[category][severity]];
  const allowed = new Set(affectedSectorIds);
  const scored = analyzeIncidentImpact(sectors, incidentType, severity);
  const impacts = scored.map((impact) => {
    if (allowed.has(impact.sectorId)) {
      return {
        ...impact,
        rationale: `Deterministic citizen-report triage: ${severity} ${describeCitizenCategory(category).toLowerCase()} affects ${sectorDisplayName(impact.sectorId)}. Simulation estimate only; not live infrastructure telemetry.`,
      };
    }
    return {
      ...impact,
      demandDeltaMw: 0,
      impactScore: 0,
      rationale:
        "No direct sector demand change estimated by the citizen-report triage rules.",
    };
  });

  const allocationRecommended = impacts.some(
    (impact) => impact.demandDeltaMw !== 0,
  );

  return {
    category,
    incidentType,
    severity,
    title: `${describeCitizenCategory(category)} — ${input.location?.trim() || DEMO_FALLBACK_LOCATION.location}`,
    affectedSectorIds,
    affectedSectors: affectedSectorIds.map((id) => ({
      id,
      name: sectorDisplayName(id),
    })),
    impacts,
    automatedTriage: true,
    isEscalated: severity === "critical",
    responseUnits: severity === "critical" ? 4 : severity === "urgent" ? 2 : 1,
    allocationRecommended,
    rationale: `Rule table: category=${category}, urgency=${severity}, incident_type=${incidentType}. ${describeIncidentType(incidentType)}.`,
  };
}

export function confirmationTimeline(
  allocationRecommended: boolean,
  options?: { isResponseActive?: boolean; includeAllStages?: boolean },
): { status: ConfirmationStatus; label: string; note: string }[] {
  const steps: { status: ConfirmationStatus; label: string; note: string }[] = [
    {
      status: "report_received",
      label: CONFIRMATION_LABELS.report_received,
      note: "Citizen emergency report accepted by the CRISISGRID simulation.",
    },
    {
      status: "triaged",
      label: CONFIRMATION_LABELS.triaged,
      note: "Deterministic triage assigned severity and affected infrastructure sectors.",
    },
    {
      status: "dispatch_requested",
      label: CONFIRMATION_LABELS.dispatch_requested,
      note: "A simulated dispatch request was recorded inside the application. This does not connect to police, ambulance, fire, 112, or government dispatch.",
    },
  ];

  if (allocationRecommended || options?.includeAllStages) {
    steps.push({
      status: "authority_review",
      label: CONFIRMATION_LABELS.authority_review,
      note: "A pending allocation recommendation was created for human authority review.",
    });
  }

  if (options?.isResponseActive || options?.includeAllStages || !allocationRecommended) {
    steps.push({
      status: "response_active",
      label: CONFIRMATION_LABELS.response_active,
      note: "Emergency response is active in the CRISISGRID simulation. Units deployed in simulation.",
    });
  }

  return steps;
}
