import { AVAILABLE_CAPACITY_MW, AllocationError } from "./allocation.js";

export type IncidentSeverity = "critical" | "urgent" | "stable";

export interface IncidentDemandImpact {
  incidentId: string;
  incidentTitle: string;
  incidentType: string;
  severity: IncidentSeverity;
  demandDeltaMw: number;
}

export interface DynamicSectorInput {
  sectorId: string;
  sectorName: string;
  currentAllocationMw: number;
  baselineDemandMw: number;
  minimumSafeCapacityMw: number;
  maximumRequestedCapacityMw: number;
  priorityWeight: number;
  operationalFlexibility: number;
  lifeCritical: boolean;
  incidentImpacts: readonly IncidentDemandImpact[];
}

export interface DynamicAllocationInput {
  totalAvailableCapacityMw?: number;
  sectors: readonly DynamicSectorInput[];
}

export interface ManualAllocationOverride {
  sectorId: string;
  requestedAllocationMw: number;
}

export interface DynamicSectorResult {
  sectorId: string;
  sectorName: string;
  previousAllocation: number;
  requestedAllocation: number;
  recommendedAllocation: number;
  delta: number;
  minimumSafeCapacity: number;
  safetyMargin: number;
  status: "increased" | "reduced" | "unchanged" | "below_minimum";
  rationale: string;
}

export interface DynamicAllocationResult {
  totalAvailableCapacity: number;
  totalAllocated: number;
  balance: number;
  status: "balanced" | "capacity_available" | "capacity_shortage" | "safety_floor_shortage";
  sectors: DynamicSectorResult[];
  decisionFactors: string[];
  warnings: string[];
}

const PRECISION = 1_000;
const SEVERITY_WEIGHT: Record<IncidentSeverity, number> = {
  stable: 0.3,
  urgent: 0.65,
  critical: 1,
};

function units(value: number): number {
  return Math.round(value * PRECISION);
}

function mw(value: number): number {
  return value / PRECISION;
}

function formatMw(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function impactTotal(sector: DynamicSectorInput): number {
  return sector.incidentImpacts.reduce(
    (total, impact) => total + impact.demandDeltaMw,
    0,
  );
}

function strongestIncident(sector: DynamicSectorInput): number {
  return sector.incidentImpacts.reduce(
    (strength, impact) => Math.max(strength, SEVERITY_WEIGHT[impact.severity]),
    0,
  );
}

function reliefOrderScore(sector: DynamicSectorInput): number {
  const lifeCriticalFactor = sector.lifeCritical ? 0.1 : 1;
  const severityProtection = 1 - strongestIncident(sector) * 0.75;
  return (
    sector.operationalFlexibility *
    Math.max(0, 2 - sector.priorityWeight) *
    lifeCriticalFactor *
    severityProtection
  );
}

function sectorRationale(
  sector: DynamicSectorInput,
  requested: number,
  recommended: number,
  overridden: boolean,
): string {
  const netDelta = recommended - sector.currentAllocationMw;
  const capacityReduction = requested - recommended;
  const fireIncident = sector.incidentImpacts.some((impact) =>
    /fire/i.test(impact.incidentType + " " + impact.incidentTitle),
  );
  const incidentPhrase = fireIncident
    ? "following the critical fire response"
    : "to meet active incident demand";

  if (overridden && netDelta === 0) {
    return `Manual override set the requested allocation to ${formatMw(requested)} MW; the existing allocation already satisfies that request.`;
  }
  if (overridden && netDelta > 0) {
    return `Manual override requested ${formatMw(requested)} MW; the allocation engine rebalanced remaining sectors to preserve the capacity limit and all safety floors.`;
  }
  if (overridden && netDelta < 0 && capacityReduction === 0) {
    return `Manual override reduced allocation to ${formatMw(recommended)} MW; remaining sectors were recalculated while preserving the safety floor.`;
  }

  if (capacityReduction > 0) {
    const reduction = formatMw(capacityReduction);
    if (sector.sectorId === "hospital_network") {
      return `The ${formatMw(requested)} MW request was reduced by ${reduction} MW through non-critical HVAC load while protecting ICU, trauma, and emergency surgical services.`;
    }
    if (sector.sectorId === "telecommunications") {
      return `The ${formatMw(requested)} MW request was reduced by ${reduction} MW by throttling non-essential civilian bandwidth while remaining above the ${formatMw(sector.minimumSafeCapacityMw)} MW safety floor.`;
    }
    if (sector.sectorId === "water_infrastructure") {
      return `The ${formatMw(requested)} MW request was reduced by ${reduction} MW while preserving capacity for fire hydrants and emergency pumping.`;
    }
    if (sector.sectorId === "emergency_operations") {
      return `The ${formatMw(requested)} MW request was reduced by ${reduction} MW while prioritizing fire engines, mobile command, and rescue operations.`;
    }
    return `The ${formatMw(requested)} MW request was reduced by ${reduction} MW to stay within available capacity while preserving the ${formatMw(sector.minimumSafeCapacityMw)} MW safety floor.`;
  }

  if (netDelta === 0) {
    if (sector.sectorId === "hospital_network") {
      return "Maintained capacity while protecting ICU, trauma, and emergency surgical services.";
    }
    return `Maintained the current allocation; no safe reallocation was required ${incidentPhrase}.`;
  }

  if (netDelta < 0) {
    const reduction = formatMw(Math.abs(netDelta));
    if (sector.sectorId === "hospital_network") {
      return `Reduced by ${reduction} MW by isolating non-critical HVAC while protecting ICU, trauma, and emergency surgical services.`;
    }
    if (sector.sectorId === "telecommunications") {
      return `Reduced by ${reduction} MW by throttling non-essential civilian bandwidth while remaining above the ${formatMw(sector.minimumSafeCapacityMw)} MW safety floor.`;
    }
    return `Reduced by ${reduction} MW to stay within the available emergency capacity while preserving its safety floor.`;
  }

  const increase = formatMw(netDelta);
  if (sector.sectorId === "water_infrastructure") {
    return `Received +${increase} MW because high-pressure hydrant demand increased ${incidentPhrase}; supports fire hydrants and emergency pumping.`;
  }
  if (sector.sectorId === "emergency_operations") {
    return `Received +${increase} MW ${incidentPhrase}; supports fire engines, mobile command, and rescue operations.`;
  }
  return `Received +${increase} MW ${incidentPhrase}.`;
}

function buildDecisionFactors(
  sectors: readonly DynamicSectorInput[],
  results: readonly DynamicSectorResult[],
): string[] {
  const factors: string[] = [];
  for (const result of results) {
    if (result.delta !== 0) {
      factors.push(`${result.sectorName}: ${result.rationale}`);
    }
  }

  const criticalImpacts = sectors.flatMap((sector) =>
    sector.incidentImpacts
      .filter(
        (impact) =>
          impact.severity === "critical" &&
          impact.demandDeltaMw > 0,
      )
      .map((impact) => impact),
  );
  if (criticalImpacts.length > 0) {
    const uniqueIncidents = new Map(
      criticalImpacts.map((impact) => [impact.incidentId, impact.incidentTitle]),
    );
    for (const [id, title] of uniqueIncidents) {
      factors.push(
        `Critical incident ${id} (${title}) receives priority in the capacity review; life-critical services and operational safety floors are protected first.`,
      );
    }
  }
  return factors;
}

export function calculateDynamicAllocation(
  input: DynamicAllocationInput,
  manualOverride?: ManualAllocationOverride,
): DynamicAllocationResult {
  const availableMw = input.totalAvailableCapacityMw ?? AVAILABLE_CAPACITY_MW;
  const available = units(availableMw);
  if (
    !Number.isFinite(availableMw) ||
    available <= 0 ||
    availableMw > AVAILABLE_CAPACITY_MW
  ) {
    throw new AllocationError(
      `Available capacity must be positive and cannot exceed ${AVAILABLE_CAPACITY_MW} MW.`,
      "INVALID_DEMAND",
    );
  }
  if (manualOverride) {
    const target = input.sectors.find(
      (sector) => sector.sectorId === manualOverride.sectorId,
    );
    if (!target) {
      throw new AllocationError(
        "The manual override must target a configured infrastructure sector.",
        "INVALID_DEMAND",
      );
    }
    if (
      !Number.isFinite(manualOverride.requestedAllocationMw) ||
      manualOverride.requestedAllocationMw < target.minimumSafeCapacityMw ||
      manualOverride.requestedAllocationMw > target.maximumRequestedCapacityMw
    ) {
      throw new AllocationError(
        `${target.sectorName} override must be between its ${formatMw(target.minimumSafeCapacityMw)} MW safety floor and ${formatMw(target.maximumRequestedCapacityMw)} MW sector maximum.`,
        "INVALID_DEMAND",
      );
    }
  }
  if (
    input.sectors.length === 0 ||
    new Set(input.sectors.map((sector) => sector.sectorId)).size !==
      input.sectors.length
  ) {
    throw new AllocationError(
      "At least one uniquely identified sector is required.",
      "INVALID_DEMAND",
    );
  }

  const warnings: string[] = [];
  const entries = input.sectors.map((sector) => {
    const numericValues = [
      sector.currentAllocationMw,
      sector.baselineDemandMw,
      sector.minimumSafeCapacityMw,
      sector.maximumRequestedCapacityMw,
      sector.priorityWeight,
      sector.operationalFlexibility,
      ...sector.incidentImpacts.map((impact) => impact.demandDeltaMw),
    ];
    if (
      numericValues.some((value) => !Number.isFinite(value)) ||
      sector.currentAllocationMw < 0 ||
      sector.currentAllocationMw > AVAILABLE_CAPACITY_MW ||
      sector.baselineDemandMw < 0 ||
      sector.baselineDemandMw > AVAILABLE_CAPACITY_MW ||
      sector.minimumSafeCapacityMw < 0 ||
      sector.minimumSafeCapacityMw > AVAILABLE_CAPACITY_MW ||
      sector.maximumRequestedCapacityMw < sector.minimumSafeCapacityMw ||
      sector.maximumRequestedCapacityMw > AVAILABLE_CAPACITY_MW ||
      sector.currentAllocationMw > sector.maximumRequestedCapacityMw ||
      sector.baselineDemandMw < sector.minimumSafeCapacityMw ||
      sector.priorityWeight <= 0 ||
      sector.operationalFlexibility < 0 ||
      sector.operationalFlexibility > 1
    ) {
      throw new AllocationError(
        `Sector "${sector.sectorId}" has invalid allocation, demand, safety, priority, or flexibility values.`,
        "INVALID_DEMAND",
      );
    }
    if (
      sector.incidentImpacts.some(
        (impact) => Math.abs(impact.demandDeltaMw) > AVAILABLE_CAPACITY_MW,
      )
    ) {
      throw new AllocationError(
        `Sector "${sector.sectorId}" has an incident delta outside the capacity range.`,
        "INVALID_DEMAND",
      );
    }
    if (typeof sector.lifeCritical !== "boolean") {
      throw new AllocationError(
        `Sector "${sector.sectorId}" must specify whether it is life-critical.`,
        "INVALID_DEMAND",
      );
    }
    for (const impact of sector.incidentImpacts) {
      if (!Object.hasOwn(SEVERITY_WEIGHT, impact.severity)) {
        throw new AllocationError(
          `Incident "${impact.incidentId}" has an unsupported severity.`,
          "INVALID_DEMAND",
        );
      }
    }

    const previous = units(sector.currentAllocationMw);
    // Incident deltas are baseline-relative, so repeated model runs stay idempotent.
    const unclampedRequest = units(
      sector.baselineDemandMw + impactTotal(sector),
    );
    const calculatedRequest = Math.min(
      units(sector.maximumRequestedCapacityMw),
      Math.max(units(sector.minimumSafeCapacityMw), unclampedRequest),
    );
    const requested = manualOverride?.sectorId === sector.sectorId
      ? units(manualOverride.requestedAllocationMw)
      : calculatedRequest;
    if (
      requested !== unclampedRequest &&
      manualOverride?.sectorId !== sector.sectorId
    ) {
      warnings.push(
        `${sector.sectorName} request was constrained to its ${formatMw(
          requested < unclampedRequest
            ? sector.maximumRequestedCapacityMw
            : sector.minimumSafeCapacityMw,
        )} MW ${requested < unclampedRequest ? "maximum" : "minimum safe capacity"}.`,
      );
    }

    return {
      input: sector,
      previous,
      requested,
      recommended: requested,
      minimum: units(sector.minimumSafeCapacityMw),
    };
  });

  const requestedTotal = entries.reduce((sum, entry) => sum + entry.requested, 0);

  if (requestedTotal > available) {
    let shortage = requestedTotal - available;
    const reductionCandidates = [...entries].sort(
      (left, right) =>
        reliefOrderScore(right.input) - reliefOrderScore(left.input) ||
        left.input.sectorId.localeCompare(right.input.sectorId),
    );
    for (const entry of reductionCandidates) {
      if (entry.input.sectorId === manualOverride?.sectorId) continue;
      if (shortage === 0) break;
      const availableRelief = entry.recommended - entry.minimum;
      const reduction = Math.min(shortage, availableRelief);
      if (reduction > 0) {
        entry.recommended -= reduction;
        shortage -= reduction;
      }
    }

    if (shortage > 0) {
      if (manualOverride) {
        const target = input.sectors.find(
          (sector) => sector.sectorId === manualOverride.sectorId,
        );
        throw new AllocationError(
          `The ${target?.sectorName ?? "sector"} manual override cannot be safely satisfied within ${formatMw(availableMw)} MW while preserving every sector safety floor. Reduce the requested capacity and try again.`,
          "INVALID_DEMAND",
        );
      }
      let remaining = available;
      const protectedOrder = [...entries].sort(
        (left, right) =>
          (Number(right.input.lifeCritical) * 100 +
            right.input.priorityWeight * 10 +
            strongestIncident(right.input)) -
            (Number(left.input.lifeCritical) * 100 +
              left.input.priorityWeight * 10 +
              strongestIncident(left.input)) ||
          left.input.sectorId.localeCompare(right.input.sectorId),
      );
      for (const entry of protectedOrder) {
        entry.recommended = Math.min(entry.minimum, remaining);
        remaining -= entry.recommended;
      }
      warnings.push(
        "The combined minimum safe capacities exceed available capacity; some sector safety floors cannot be met. Authority intervention is required.",
      );
    }

    if (shortage === 0) {
      warnings.push(
        `${formatMw(mw(requestedTotal - available))} MW of requested capacity was reduced to keep the total within ${formatMw(availableMw)} MW.`,
      );
    }
  }

  const totalUnits = entries.reduce(
    (sum, entry) => sum + entry.recommended,
    0,
  );
  const totalAllocated = mw(totalUnits);
  const balance = mw(available - totalUnits);
  const sectorResults = entries.map((entry): DynamicSectorResult => {
    const previous = mw(entry.previous);
    const requested = mw(entry.requested);
    const recommended = mw(entry.recommended);
    const delta = mw(entry.recommended - entry.previous);
    const safetyMargin = mw(entry.recommended - entry.minimum);
    const status =
      entry.recommended < entry.minimum
        ? "below_minimum"
        : delta > 0
          ? "increased"
          : delta < 0
            ? "reduced"
            : "unchanged";

    return {
      sectorId: entry.input.sectorId,
      sectorName: entry.input.sectorName,
      previousAllocation: previous,
      requestedAllocation: requested,
      recommendedAllocation: recommended,
      delta,
      minimumSafeCapacity: entry.input.minimumSafeCapacityMw,
      safetyMargin,
      status,
      rationale: sectorRationale(
        entry.input,
        requested,
        recommended,
        manualOverride?.sectorId === entry.input.sectorId,
      ),
    };
  });

  if (totalAllocated > availableMw) {
    throw new AllocationError(
      "Calculated allocation exceeds available emergency capacity.",
      "INVALID_DEMAND",
    );
  }

  const hasBelowMinimum = sectorResults.some(
    (sector) => sector.recommendedAllocation < sector.minimumSafeCapacity,
  );
  const wasReduced = entries.some(
    (entry) => entry.recommended < entry.requested,
  );

  return {
    totalAvailableCapacity: availableMw,
    totalAllocated,
    balance,
    status: hasBelowMinimum
      ? "safety_floor_shortage"
      : wasReduced
        ? "capacity_shortage"
        : balance === 0
          ? "balanced"
          : "capacity_available",
    sectors: sectorResults,
    decisionFactors: buildDecisionFactors(input.sectors, sectorResults),
    warnings,
  };
}
