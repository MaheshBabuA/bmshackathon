import type { IncidentType, Severity } from "../http/schemas.js";
import type { SectorDemand } from "./allocation.js";

export interface IncidentImpact {
  sectorId: string;
  demandDeltaMw: number;
  impactScore: number;
  rationale: string;
}

const SECTOR_IMPACTS: Record<
  IncidentType,
  Partial<Record<SectorDemand["id"], number>>
> = {
  medical: {
    hospital_network: 1.8,
    emergency_operations: 0.8,
  },
  fire: {
    hospital_network: 0.8,
    water_infrastructure: 2.4,
    telecommunications: 0.3,
    emergency_operations: 1.5,
  },
  flood: {
    hospital_network: 0.4,
    water_infrastructure: 2.2,
    telecommunications: 0.2,
    emergency_operations: 1.3,
  },
  infrastructure: {
    hospital_network: 1,
    water_infrastructure: 0.5,
    telecommunications: 1.6,
    emergency_operations: 1.2,
  },
  telecommunications: {
    hospital_network: 0.5,
    telecommunications: 2,
    emergency_operations: 1,
  },
  other: {
    hospital_network: 0.6,
    water_infrastructure: 0.4,
    telecommunications: 0.3,
    emergency_operations: 0.6,
  },
};

const SEVERITY_MULTIPLIER: Record<Severity, number> = {
  critical: 1,
  urgent: 0.65,
  stable: 0.3,
};

export function analyzeIncidentImpact(
  sectors: readonly SectorDemand[],
  incidentType: IncidentType,
  severity: Severity,
): IncidentImpact[] {
  const multiplier = SEVERITY_MULTIPLIER[severity];
  const baseImpacts = SECTOR_IMPACTS[incidentType];

  return sectors.map((sector) => {
    const demandDeltaMw =
      Math.round(((baseImpacts[sector.id] ?? 0) * multiplier) * 1_000) /
      1_000;
    return {
      sectorId: sector.id,
      demandDeltaMw,
      impactScore: multiplier,
      rationale:
        demandDeltaMw === 0
          ? "No direct demand change estimated by the simulation rules."
          : `Rule-based simulation estimate for a ${severity} ${incidentType} incident; not a live infrastructure measurement.`,
    };
  });
}

export function describeIncidentType(incidentType: IncidentType): string {
  switch (incidentType) {
    case "medical":
      return "Medical emergency";
    case "fire":
      return "Fire and hazardous-material incident";
    case "flood":
      return "Flood and water incident";
    case "infrastructure":
      return "Infrastructure incident";
    case "telecommunications":
      return "Telecommunications incident";
    case "other":
      return "Emergency incident";
  }
}
