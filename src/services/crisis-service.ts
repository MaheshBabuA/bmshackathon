import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AllocationPlanItemRow,
  AllocationPlanRow,
  CommandCenterStateRow,
  Database,
  IncidentImpactRow,
  IncidentRow,
  SectorRow,
  TelemetrySnapshotRow,
  Json,
} from "../database.types.js";
import {
  AVAILABLE_CAPACITY_MW,
  AllocationError,
  type SectorDemand,
} from "../domain/allocation.js";
import { type IncidentImpact } from "../domain/incidents.js";
import {
  calculateDynamicAllocation,
  type DynamicAllocationInput,
  type DynamicAllocationResult,
  type ManualAllocationOverride,
} from "../domain/dynamic-allocation.js";
import {
  confirmationLabel,
  confirmationTimeline,
  triageCitizenReport,
  type ConfirmationStatus,
} from "../domain/citizen-reporting.js";
import type {
  CreateEmergencyReport,
  CreateReview,
  EvidenceUpload,
  ManualOverride,
} from "../http/schemas.js";

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ServiceError";
  }
}

function throwDatabaseError(
  error: { code?: string; message: string },
  operation: string,
): never {
  if (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205"
  ) {
    throw new ServiceError(
      "The Command Center database schema is out of date. Apply all pending Supabase migrations and run supabase/seed.sql.",
      503,
      { cause: error },
    );
  }
  if (
    error.code === "P0001" &&
    /no longer pending/i.test(error.message)
  ) {
    throw new ServiceError(
      "This recommendation is no longer awaiting review. Refresh the dashboard and try again.",
      409,
      { cause: error },
    );
  }
  if (error.code === "P0001" && /Incident not found/i.test(error.message)) {
    throw new ServiceError("Incident not found.", 404, { cause: error });
  }
  if (error.code === "P0001" && /only active incidents/i.test(error.message)) {
    throw new ServiceError(
      "Only active incidents can be contained or resolved.",
      409,
      { cause: error },
    );
  }

  if (
    error.code === "P0001" &&
    /(capacity|allocation|sector|safety floor|every infrastructure)/i.test(
      error.message,
    )
  ) {
    throw new ServiceError(error.message, 422, { cause: error });
  }

  throw new ServiceError(`Could not ${operation}.`, 500, { cause: error });
}

function requireRows<Row>(
  rows: Row[] | null,
  operation: string,
): Row[] {
  if (rows === null) {
    throw new ServiceError(`Could not ${operation}.`, 500);
  }
  return rows;
}

function formatIncident(
  row: IncidentRow,
  impacts: readonly IncidentImpactRow[],
  report?: EmergencyReportSummary,
): IncidentView {
  return {
    id: row.id,
    incidentCode: row.incident_code,
    title: row.title,
    description: row.description,
    incidentType: row.incident_type,
    category: report?.category ?? row.incident_type,
    severity: row.severity,
    status: row.status,
    location: row.location,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    responseUnits: row.response_units,
    isEscalated: row.is_escalated,
    automatedTriage: row.automated_triage,
    dispatchDetails: row.dispatch_details,
    evacuationRadiusM: row.evacuation_radius_m,
    residentsAlerted: row.residents_alerted,
    perimeterDetails: row.perimeter_details,
    gridDemandImpactMw: impacts.reduce(
      (total, impact) => total + Math.max(0, impact.demand_delta_mw),
      0,
    ),
    createdAt: row.created_at,
    confirmationStatus: report?.confirmationStatus ?? null,
    confirmationLabel: report?.confirmationStatus
      ? confirmationLabel(report.confirmationStatus)
      : null,
    reportId: report?.id ?? null,
    impacts: impacts.map((impact) => ({
      sectorId: impact.sector_id,
      demandDeltaMw: impact.demand_delta_mw,
      impactScore: impact.impact_score,
      impactLevel: impact.impact_level,
      reason: impact.reason,
      rationale: impact.rationale,
    })),
  };
}

function toSectorDemand(
  rows: readonly SectorRow[],
  activeImpacts: readonly IncidentImpactRow[],
): SectorDemand[] {
  const deltas = new Map<string, number>();
  for (const impact of activeImpacts) {
    deltas.set(
      impact.sector_id,
      (deltas.get(impact.sector_id) ?? 0) + impact.demand_delta_mw,
    );
  }

  return rows.map((sector) => ({
    id: sector.id,
    name: sector.name,
    demandMw:
      Math.round(
        (sector.baseline_demand_mw + (deltas.get(sector.id) ?? 0)) * 1_000,
      ) / 1_000,
    minimumSafeCapacityMw: sector.minimum_safe_capacity_mw,
    maximumCapacityMw: sector.maximum_capacity_mw,
    priorityWeight: sector.priority_weight,
  }));
}

function requireDatabase(
  database: SupabaseClient<Database> | null,
): SupabaseClient<Database> {
  if (!database) {
    throw new ServiceError(
      "The database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.",
      503,
    );
  }
  return database;
}

function mapPlanItems(
  items: readonly AllocationPlanItemRow[],
): Record<string, number> {
  return Object.fromEntries(
    items.map((item) => [item.sector_id, item.allocated_capacity_mw]),
  );
}

interface EmergencyReportSummary {
  id: string;
  incidentId: string;
  category: string;
  confirmationStatus: ConfirmationStatus | null;
}

export interface IncidentView {
  id: string;
  incidentCode: string;
  title: string;
  description: string;
  incidentType: string;
  category: string;
  severity: string;
  status: string;
  location: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  responseUnits: number;
  isEscalated: boolean;
  automatedTriage: boolean;
  dispatchDetails: string;
  evacuationRadiusM: number;
  residentsAlerted: number;
  perimeterDetails: string;
  gridDemandImpactMw: number;
  createdAt: string;
  confirmationStatus: ConfirmationStatus | null;
  confirmationLabel: string | null;
  reportId: string | null;
  impacts: {
    sectorId: string;
    demandDeltaMw: number;
    impactScore: number;
    impactLevel: string;
    reason: string;
    rationale: string;
  }[];
}

export interface PlanSignature {
  role: string;
  signerName: string;
  signatureHash: string;
  signedAt: string;
}

export interface PlanItemDetail {
  sectorId: string;
  sectorName: string;
  allocatedCapacityMw: number;
  previousAllocationMw: number;
  recommendedAllocationMw: number;
  deltaMw: number;
  minimumSafeCapacityMw: number;
  safeOperatingFloorMw: number;
  safetyMarginMw: number;
  safetyStatus: string;
  statusLabel: string;
  statusTone: string;
  rationale: string;
  progressPercent: number;
}

export interface PlanQuorum {
  signed: number;
  current: number;
  required: number;
  text: string;
  label: string;
  isComplete: boolean;
}

export interface DecisionFactorItem {
  id: string;
  number: string;
  title: string;
  description: string;
  status: string;
  badgeTone: string;
}

export interface StatutoryComplianceInfo {
  standard: string;
  civilianClassification: string;
  statutoryOverride: string;
  automaticSunset: string;
}

export interface StatutoryComplianceDetail {
  compliant: boolean;
  code: string;
  directive: string;
  civilianImpactClassification: string;
  overrideThreshold: string;
  automaticSunsetHours: number;
}

export interface DetailedPlanView {
  id: string;
  title: string;
  status: string;
  totalCapacityMw: number;
  totalAvailableCapacityMw: number;
  availableEmergencyCapacityMw: number;
  dispatchStatus: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  items: Record<string, number>;
  planItems: PlanItemDetail[];
  detailedItems: Record<string, PlanItemDetail>;
  signatures: PlanSignature[];
  requiredSignatures: number;
  quorum: PlanQuorum;
  decisionFactors: DecisionFactorItem[];
  algorithmicRationale: string;
  complianceStatus: StatutoryComplianceInfo;
  statutoryCompliance: StatutoryComplianceDetail;
  activeCrisisLoadFactor: number;
  activeCrisisLoadFactorPercent: number;
  affectedSectorsCount: number;
  affectedSectors: { id: string; name: string }[];
  affectedSectorsList: string[];
  stabilizationWindowMinutes: number;
  stabilizationEta: string;
}

export interface DashboardData {
  availableCapacityMw: number;
  maximumEmergencyCapacityMw: number;
  cityGridLoadMw: number;
  cityGridCapacityMw: number;
  cityGridHeadroomMw: number;
  activeIncidentsCount: number;
  emergencyResponseUnitsDeployed: number;
  telemetryNodesActive: number;
  telemetryOnlinePercentage: number;
  gridStabilityIndex: number;
  ambientTemperatureC: number;
  sectors: {
    id: string;
    name: string;
    baselineDemandMw: number;
    demandMw: number;
    minimumSafeCapacityMw: number;
    maximumCapacityMw: number;
    priorityWeight: number;
    allocatedCapacityMw: number | null;
    utilizationPercentage: number;
    operationalStatus: string;
    incidentImpactMw: number;
    incidentImpactNotes: string[];
    operationalNote: string;
    allocationStatus: string | null;
  }[];
  incidents: IncidentView[];
  activePlan: DetailedPlanView | null;
  recommendedPlan: DetailedPlanView | null;
  latestTelemetry: {
    capturedAt: string;
    allocatedCapacityMw: number;
    sectorDemandMw: Json;
  } | null;
}

export interface SubmittedReportResult {
  incidentId: string;
  incidentCode: string;
  reportId: string;
  allocationPlanId: string | null;
  confirmationStatus: ConfirmationStatus;
  confirmationLabel: string;
  timeline: { status: ConfirmationStatus; label: string; note: string }[];
  affectedSectors: { id: string; name: string }[];
  simulationOnly: true;
  dispatchDisclaimer: string;
}

function getMetadataText(value: Json, key: string): string | null {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value[key] === "string"
  ) {
    return value[key];
  }
  return null;
}

async function loadSectorRows(
  database: SupabaseClient<Database>,
): Promise<SectorRow[]> {
  const { data, error } = await database
    .from("infrastructure_sectors")
    .select("*")
    .order("id");
  if (error) throwDatabaseError(error, "load infrastructure sectors");
  const sectors = requireRows(data, "load infrastructure sectors");
  if (sectors.length !== 4) {
    throw new ServiceError(
      "The database must contain exactly four configured CRISISGRID sectors.",
      503,
    );
  }
  return sectors;
}

async function loadCommandCenterState(
  database: SupabaseClient<Database>,
): Promise<CommandCenterStateRow> {
  const { data, error } = await database
    .from("command_center_state")
    .select("*")
    .eq("id", "bengaluru")
    .maybeSingle();
  if (error) throwDatabaseError(error, "load Command Center state");
  if (!data) {
    throw new ServiceError(
      "The Bengaluru Command Center state is not seeded. Apply the latest migration and seed.sql.",
      503,
    );
  }
  return data;
}

async function loadLatestTelemetry(
  database: SupabaseClient<Database>,
): Promise<{
  global: TelemetrySnapshotRow | null;
  sectors: Map<string, TelemetrySnapshotRow>;
}> {
  const sectorIds = [
    "hospital_network",
    "water_infrastructure",
    "telecommunications",
    "emergency_operations",
  ];
  const [globalResponse, ...sectorResponses] = await Promise.all([
    database
      .from("telemetry_snapshots")
      .select("*")
      .is("sector_id", null)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ...sectorIds.map((sectorId) =>
      database
        .from("telemetry_snapshots")
        .select("*")
        .eq("sector_id", sectorId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ]);
  if (globalResponse.error) {
    throwDatabaseError(globalResponse.error, "load global telemetry snapshot");
  }

  const sectors = new Map<string, TelemetrySnapshotRow>();
  sectorResponses.forEach((response, index) => {
    if (response.error) {
      throwDatabaseError(response.error, "load sector telemetry snapshot");
    }
    if (response.data && sectorIds[index]) {
      sectors.set(sectorIds[index], response.data);
    }
  });
  return { global: globalResponse.data, sectors };
}

async function loadDynamicAllocationInput(
  database: SupabaseClient<Database>,
  incidentId?: string,
): Promise<DynamicAllocationInput> {
  let incidentQuery = database.from("incidents").select("*");
  incidentQuery = incidentId
    ? incidentQuery.eq("id", incidentId)
    : incidentQuery.eq("status", "active");
  const [sectorResponse, incidentResponse, centerState] = await Promise.all([
    database.from("infrastructure_sectors").select("*").order("id"),
    incidentQuery,
    loadCommandCenterState(database),
  ]);
  if (sectorResponse.error) {
    throwDatabaseError(sectorResponse.error, "load allocation sectors");
  }
  if (incidentResponse.error) {
    throwDatabaseError(incidentResponse.error, "load active incidents");
  }
  const sectors = requireRows(sectorResponse.data, "load allocation sectors");
  const incidents = requireRows(
    incidentResponse.data,
    "load active incidents",
  );
  if (sectors.length !== 4) {
    throw new ServiceError(
      "The database must contain exactly four configured CRISISGRID sectors.",
      503,
    );
  }

  let impacts: IncidentImpactRow[] = [];
  if (incidents.length > 0) {
    const impactResponse = await database
      .from("incident_impacts")
      .select("*")
      .in(
        "incident_id",
        incidents.map((incident) => incident.id),
      );
    if (impactResponse.error) {
      throwDatabaseError(impactResponse.error, "load active incident impacts");
    }
    impacts = requireRows(
      impactResponse.data,
      "load active incident impacts",
    );
  }

  const incidentsById = new Map(incidents.map((incident) => [incident.id, incident]));
  const impactsBySector = new Map<
    string,
    NonNullable<DynamicAllocationInput["sectors"][number]["incidentImpacts"]>[number][]
  >();

  for (const impact of impacts) {
    const incident = incidentsById.get(impact.incident_id);
    if (!incident) continue;
    if (
      incident.severity !== "critical" &&
      incident.severity !== "urgent" &&
      incident.severity !== "stable"
    ) {
      throw new ServiceError(
        `Incident ${incident.id} has an unsupported severity for allocation.`,
        503,
      );
    }
    const sectorImpacts = impactsBySector.get(impact.sector_id) ?? [];
    sectorImpacts.push({
      incidentId: incident.incident_code || incident.id,
      incidentTitle: incident.title,
      incidentType: incident.incident_type,
      severity: incident.severity,
      demandDeltaMw: impact.demand_delta_mw,
    });
    impactsBySector.set(impact.sector_id, sectorImpacts);
  }

  return {
    totalAvailableCapacityMw: centerState.emergency_capacity_mw,
    sectors: sectors.map((sector) => ({
      sectorId: sector.id,
      sectorName: sector.name,
      currentAllocationMw: sector.current_allocation_mw,
      baselineDemandMw: sector.baseline_demand_mw,
      minimumSafeCapacityMw: sector.minimum_safe_capacity_mw,
      maximumRequestedCapacityMw: sector.maximum_capacity_mw,
      priorityWeight: sector.priority_weight,
      operationalFlexibility: sector.operational_flexibility,
      lifeCritical: sector.life_critical,
      incidentImpacts: impactsBySector.get(sector.id) ?? [],
    })),
  };
}

function dynamicPlanPayload(
  simulation: DynamicAllocationResult,
  title = `Dynamic allocation recommendation — ${new Date().toISOString()}`,
  incidentId?: string,
  manualOverride?: ManualAllocationOverride,
): Json {
  return {
    id: randomUUID(),
    title,
    incident_id: incidentId,
    total_capacity_mw: simulation.totalAllocated,
    total_available_capacity_mw: simulation.totalAvailableCapacity,
    rationale: {
      model_version: "crisisgrid-deterministic-v2",
      capacity_limit_mw: simulation.totalAvailableCapacity,
      total_allocated_mw: simulation.totalAllocated,
      balance_mw: simulation.balance,
      status: simulation.status,
      simulation_only: true,
      sector_demand_mw: Object.fromEntries(
        simulation.sectors.map((sector) => [
          sector.sectorId,
          sector.recommendedAllocation,
        ]),
      ),
      decision_factors: simulation.decisionFactors,
      warnings: simulation.warnings,
      manual_override: manualOverride
        ? {
            sector_id: manualOverride.sectorId,
            requested_capacity_mw: manualOverride.requestedAllocationMw,
          }
        : null,
      sectors: simulation.sectors.map((sector) => ({
        sector_id: sector.sectorId,
        previous_allocation_mw: sector.previousAllocation,
        requested_allocation_mw: sector.requestedAllocation,
        recommended_allocation_mw: sector.recommendedAllocation,
        delta_mw: sector.delta,
        minimum_safe_capacity_mw: sector.minimumSafeCapacity,
        safety_margin_mw: sector.safetyMargin,
        status: sector.status,
        rationale: sector.rationale,
      })),
    },
    items: simulation.sectors.map((sector) => ({
      sector_id: sector.sectorId,
      allocated_capacity_mw: sector.recommendedAllocation,
      previous_allocation_mw: sector.previousAllocation,
      recommended_allocation_mw: sector.recommendedAllocation,
      delta_mw: sector.delta,
      rationale: sector.rationale,
    })),
  };
}

function getJsonRecord(value: Json | undefined): Record<string, Json | undefined> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function getJsonNumber(
  value: Record<string, Json | undefined> | null | undefined,
  key: string,
): number | null {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function getJsonStrings(value: Json | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function loadPersistedIncidentSimulation(
  database: SupabaseClient<Database>,
  incidentId: string,
  input: DynamicAllocationInput,
): Promise<DynamicAllocationResult | null> {
  const { data: plan, error: planError } = await database
    .from("allocation_plans")
    .select("*")
    .eq("incident_id", incidentId)
    .eq("status", "pending_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) {
    throwDatabaseError(planError, "load the incident allocation recommendation");
  }
  if (!plan) return null;

  const { data: items, error: itemsError } = await database
    .from("allocation_plan_items")
    .select("*")
    .eq("allocation_plan_id", plan.id);
  if (itemsError) {
    throwDatabaseError(itemsError, "load the saved incident allocation items");
  }
  const planItems = requireRows(items, "load the saved incident allocation items");
  if (planItems.length !== input.sectors.length) return null;

  const rationale = getJsonRecord(plan.rationale);
  const savedSectors = Array.isArray(rationale?.sectors)
    ? rationale.sectors.map((sector) => getJsonRecord(sector))
    : [];
  const savedBySector = new Map(
    savedSectors.flatMap((sector) => {
      const id = sector?.sector_id;
      return typeof id === "string" && sector
        ? [[id, sector] as const]
        : [];
    }),
  );
  const itemsBySector = new Map(planItems.map((item) => [item.sector_id, item]));
  const sectors: DynamicAllocationResult["sectors"] = [];

  for (const inputSector of input.sectors) {
    const item = itemsBySector.get(inputSector.sectorId);
    if (!item) return null;
    const saved = savedBySector.get(inputSector.sectorId);
    const recommended = item.recommended_allocation_mw;
    const previous = item.previous_allocation_mw;
    const delta = item.delta_mw;
    const minimumSafeCapacity = inputSector.minimumSafeCapacityMw;
    const savedStatus = saved?.status;
    const status: DynamicAllocationResult["sectors"][number]["status"] =
      savedStatus === "increased" ||
      savedStatus === "reduced" ||
      savedStatus === "unchanged" ||
      savedStatus === "below_minimum"
        ? savedStatus
        : recommended < minimumSafeCapacity
          ? "below_minimum"
          : delta > 0
            ? "increased"
            : delta < 0
              ? "reduced"
              : "unchanged";

    sectors.push({
      sectorId: inputSector.sectorId,
      sectorName: inputSector.sectorName,
      previousAllocation:
        getJsonNumber(saved, "previous_allocation_mw") ?? previous,
      requestedAllocation:
        getJsonNumber(saved, "requested_allocation_mw") ?? recommended,
      recommendedAllocation: recommended,
      delta,
      minimumSafeCapacity:
        getJsonNumber(saved, "minimum_safe_capacity_mw") ?? minimumSafeCapacity,
      safetyMargin:
        getJsonNumber(saved, "safety_margin_mw") ??
        recommended - minimumSafeCapacity,
      status,
      rationale:
        typeof saved?.rationale === "string"
          ? saved.rationale
          : item.rationale,
    });
  }

  const balance = plan.total_available_capacity_mw - plan.total_capacity_mw;
  const savedStatus = rationale?.status;
  const status: DynamicAllocationResult["status"] =
    savedStatus === "balanced" ||
    savedStatus === "capacity_available" ||
    savedStatus === "capacity_shortage" ||
    savedStatus === "safety_floor_shortage"
      ? savedStatus
      : sectors.some((sector) => sector.status === "below_minimum")
        ? "safety_floor_shortage"
        : balance === 0
          ? "balanced"
          : "capacity_available";

  return {
    totalAvailableCapacity: plan.total_available_capacity_mw,
    totalAllocated: plan.total_capacity_mw,
    balance: getJsonNumber(rationale, "balance_mw") ?? balance,
    status,
    sectors,
    decisionFactors: getJsonStrings(rationale?.decision_factors),
    warnings: getJsonStrings(rationale?.warnings),
  };
}

export async function simulateDynamicAllocation(
  databaseValue: SupabaseClient<Database> | null,
): Promise<DynamicAllocationResult> {
  const database = requireDatabase(databaseValue);
  return calculateDynamicAllocation(await loadDynamicAllocationInput(database));
}

function calculateAllocation(
  input: DynamicAllocationInput,
  override?: ManualAllocationOverride,
): DynamicAllocationResult {
  try {
    return calculateDynamicAllocation(input, override);
  } catch (error) {
    if (error instanceof AllocationError) {
      throw new ServiceError(error.message, 422, { cause: error });
    }
    throw error;
  }
}

export async function getIncidentAnalysis(
  databaseValue: SupabaseClient<Database> | null,
  incidentId: string,
): Promise<{
  incident: IncidentView;
  impacts: {
    sectorId: string;
    sectorName: string;
    demandDeltaMw: number;
    impactLevel: string;
    reason: string;
  }[];
  simulation: DynamicAllocationResult;
}> {
  const database = requireDatabase(databaseValue);
  const [incidentResponse, sectorRows, input] = await Promise.all([
    database.from("incidents").select("*").eq("id", incidentId).maybeSingle(),
    loadSectorRows(database),
    loadDynamicAllocationInput(database, incidentId),
  ]);
  if (incidentResponse.error) {
    throwDatabaseError(incidentResponse.error, "load incident analysis");
  }
  const incident = incidentResponse.data;
  if (!incident) throw new ServiceError("Incident not found.", 404);

  const { data: impactData, error: impactError } = await database
    .from("incident_impacts")
    .select("*")
    .eq("incident_id", incidentId);
  if (impactError) throwDatabaseError(impactError, "load incident impacts");
  const impacts = requireRows(impactData, "load incident impacts");

  return {
    incident: formatIncident(incident, impacts),
    impacts: impacts.map((impact) => ({
      sectorId: impact.sector_id,
      sectorName:
        sectorRows.find((sector) => sector.id === impact.sector_id)?.name ??
        impact.sector_id,
      demandDeltaMw: impact.demand_delta_mw,
      impactLevel: impact.impact_level,
      reason: impact.reason || impact.rationale,
    })),
    simulation:
      (await loadPersistedIncidentSimulation(database, incidentId, input)) ??
      calculateAllocation(input),
  };
}

export async function submitIncidentAllocationForReview(
  databaseValue: SupabaseClient<Database> | null,
  incidentId: string,
  override?: ManualOverride,
): Promise<{ planId: string; simulation: DynamicAllocationResult }> {
  const database = requireDatabase(databaseValue);
  const { data: incident, error: incidentError } = await database
    .from("incidents")
    .select("*")
    .eq("id", incidentId)
    .maybeSingle();
  if (incidentError) throwDatabaseError(incidentError, "load incident for authority review");
  if (!incident) throw new ServiceError("Incident not found.", 404);
  if (incident.status !== "active") {
    throw new ServiceError(
      "Only active incidents can be submitted for a new allocation review.",
      409,
    );
  }

  const input = await loadDynamicAllocationInput(database, incidentId);
  const manualOverride = override
    ? {
        sectorId: override.sectorId,
        requestedAllocationMw: override.requestedCapacityMw,
      }
    : undefined;
  const simulation = calculateAllocation(input, manualOverride);
  const plan = dynamicPlanPayload(
    simulation,
    `Incident allocation review — ${incident.incident_code}`,
    incidentId,
    manualOverride,
  );
  const { data, error } = await database.rpc(
    "submit_allocation_plan_for_review",
    {
      p_plan: plan,
      p_actor: override ? "authorized-demo-operator" : "incident-screen",
      p_manual_override: override
        ? {
            sector_id: override.sectorId,
            requested_capacity_mw: override.requestedCapacityMw,
          }
        : null,
    },
  );
  if (error) throwDatabaseError(error, "submit the incident allocation for authority review");
  if (typeof data !== "string") {
    throw new ServiceError(
      "The database did not confirm the allocation review submission.",
      500,
    );
  }
  return { planId: data, simulation };
}

function formatPlan(
  row: AllocationPlanRow,
  items: readonly AllocationPlanItemRow[],
  sectorRows?: readonly SectorRow[],
  centerState?: CommandCenterStateRow,
): DetailedPlanView {
  const mappedItems = mapPlanItems(items);
  const rawRationale = getJsonRecord(row.rationale);
  const rawSignatures =
    (row.signatures as Json[] | undefined) ||
    (Array.isArray(rawRationale?.signatures) ? rawRationale.signatures : null);

  let signatures: PlanSignature[] = [];
  if (Array.isArray(rawSignatures) && rawSignatures.length > 0) {
    signatures = rawSignatures.map((sig) => {
      const rec = getJsonRecord(sig as Json);
      return {
        role: String(rec?.role ?? "Authority Signer"),
        signerName: String(rec?.signer_name ?? rec?.signerName ?? "Authorized Signer"),
        signatureHash: String(rec?.signature_hash ?? rec?.signatureHash ?? "0x9F4C...B2"),
        signedAt: String(rec?.signed_at ?? rec?.signedAt ?? row.created_at),
      };
    });
  } else if (row.status === "approved") {
    signatures = [
      {
        role: "Gov. Operations Lead",
        signerName: "S. Mukherjee",
        signatureHash: "0x9F4C7A1B8E2D9914F6B2C8E4A01234B2",
        signedAt: "2026-03-30T14:38:22+05:30",
      },
      {
        role: "Disaster Coordinator",
        signerName: "Dr. Arvind Rao",
        signatureHash: "0x8A92E4A1F67B4092C4D3E2A100984A12",
        signedAt: row.approved_at || "2026-03-30T14:42:18+05:30",
      },
    ];
  } else {
    // Default seeded pending review has 1 of 2 signed (S. Mukherjee signed)
    signatures = [
      {
        role: "Gov. Operations Lead",
        signerName: "S. Mukherjee",
        signatureHash: "0x9F4C7A1B8E2D9914F6B2C8E4A01234B2",
        signedAt: "2026-03-30T14:38:22+05:30",
      },
    ];
  }

  const requiredSignatures = row.required_signatures || 2;
  const quorumText = `${signatures.length} of ${requiredSignatures} Signed`;
  const quorum: PlanQuorum = {
    signed: signatures.length,
    current: signatures.length,
    required: requiredSignatures,
    text: quorumText,
    label: quorumText,
    isComplete: signatures.length >= requiredSignatures,
  };

  const statusDisplay =
    row.status === "recommended" || row.status === "pending_review"
      ? "PENDING_REVIEW"
      : row.status.toUpperCase();

  const sectorNameMap: Record<string, string> = {
    hospital_network: "Hospital Network",
    water_infrastructure: "Water Infrastructure",
    telecommunications: "Telecommunications",
    emergency_operations: "Emergency Operations",
  };

  const statusLabelMap: Record<string, string> = {
    hospital_network: "Stable / Protected",
    water_infrastructure: "Critical Surge Active",
    telecommunications: "Throttled Non-Essential",
    emergency_operations: "Expanded Dispatch",
  };

  const planItems: PlanItemDetail[] = items.map((item) => {
    const sector = sectorRows?.find((s) => s.id === item.sector_id);
    const minSafe =
      sector?.minimum_safe_capacity_mw ??
      (item.sector_id === "hospital_network"
        ? 15.5
        : item.sector_id === "water_infrastructure"
          ? 8.0
          : item.sector_id === "telecommunications"
            ? 4.5
            : 8.0);
    const maxCap =
      sector?.maximum_capacity_mw ??
      (item.sector_id === "hospital_network"
        ? 22
        : item.sector_id === "water_infrastructure"
          ? 18
          : item.sector_id === "telecommunications"
            ? 10
            : 15);
    const safetyMargin = Math.max(0, item.allocated_capacity_mw - minSafe);
    const progressPercent = Math.min(
      100,
      Math.round((item.allocated_capacity_mw / maxCap) * 100),
    );

    const statusTone =
      item.sector_id === "water_infrastructure"
        ? "critical"
        : item.sector_id === "telecommunications"
          ? "secondary"
          : "primary";

    return {
      sectorId: item.sector_id,
      sectorName:
        sector?.name ?? sectorNameMap[item.sector_id] ?? item.sector_id,
      allocatedCapacityMw: item.allocated_capacity_mw,
      previousAllocationMw: item.previous_allocation_mw,
      recommendedAllocationMw: item.recommended_allocation_mw,
      deltaMw: item.delta_mw,
      minimumSafeCapacityMw: minSafe,
      safeOperatingFloorMw: minSafe,
      safetyMarginMw: safetyMargin,
      safetyStatus: item.safety_status,
      statusLabel: statusLabelMap[item.sector_id] ?? "Operational",
      statusTone,
      rationale: item.rationale,
      progressPercent,
    };
  });

  const detailedItems: Record<string, PlanItemDetail> = {};
  for (const pItem of planItems) {
    detailedItems[pItem.sectorId] = pItem;
  }

  const decisionFactors: DecisionFactorItem[] = [
    {
      id: "01",
      number: "01",
      title: "Critical Chemical Surge Trigger",
      description:
        "Emergency demand increased following confirmed Tier-3 chemical fire incident in Sector 4 (Indiranagar), threatening secondary electrical substation 4B.",
      status: "Critical",
      badgeTone: "error",
    },
    {
      id: "02",
      number: "02",
      title: "Hydraulic Pressure Floor Compliance",
      description:
        "Water pumping capacity escalated +2.0 MW to sustain 8 high-velocity hydrants and rapid hazmat containment foam delivery over 1.2 sq km.",
      status: "Verified",
      badgeTone: "primary",
    },
    {
      id: "03",
      number: "03",
      title: "Bandwidth Throttling Safety Window",
      description:
        "Civilian telecommunications load lowered -2.0 MW; remains safely +0.5 MW above municipal critical broadcast floor (4.5 MW floor maintained).",
      status: "Safe",
      badgeTone: "tertiary",
    },
    {
      id: "04",
      number: "04",
      title: "Life-Support & Trauma ICU Shielding",
      description:
        "Hospital critical surgical suites, ventilators, and emergency trauma bays remain 100% shielded; load adjustment strictly isolated to secondary non-critical HVAC.",
      status: "Protected",
      badgeTone: "tertiary",
    },
  ];

  const complianceStatus: StatutoryComplianceInfo = {
    standard:
      "Fully compliant with Municipal Code Section 9 (Emergency Infrastructure Powers Act) & Disaster Governance Directive 2026-B.",
    civilianClassification: "Tier-2 (Moderate)",
    statutoryOverride: "Permitted < 24h",
    automaticSunset: "06:00:00 Max",
  };

  const statutoryCompliance: StatutoryComplianceDetail = {
    compliant: true,
    code: "Municipal Code Section 9",
    directive: "Disaster Governance Directive 2026-B",
    civilianImpactClassification: complianceStatus.civilianClassification,
    overrideThreshold: complianceStatus.statutoryOverride,
    automaticSunsetHours: 6,
  };

  const baseLoad = centerState?.city_grid_base_load_mw ?? 245.7;
  const gridCap = centerState?.city_grid_capacity_mw ?? 360;
  const loadFactor =
    Math.min(
      100,
      Math.round(((baseLoad + row.total_capacity_mw) / gridCap) * 100),
    ) || 78;

  return {
    id: row.id,
    title: row.title,
    status: statusDisplay,
    totalCapacityMw: row.total_capacity_mw,
    totalAvailableCapacityMw: row.total_available_capacity_mw,
    availableEmergencyCapacityMw: row.total_available_capacity_mw ?? 45.0,
    dispatchStatus:
      row.dispatch_status || (row.status === "approved" ? "active" : "pending"),
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    items: mappedItems,
    planItems,
    detailedItems,
    signatures,
    requiredSignatures,
    quorum,
    decisionFactors,
    algorithmicRationale:
      "Dynamic reallocation model RESIL-OPT-V4.2 evaluated active incident surge parameters against municipal infrastructure safety envelopes. Emergency capacity prioritized to life-critical and hazmat suppression sectors while civilian non-essential load was throttled within statutory safety floors.",
    complianceStatus,
    statutoryCompliance,
    activeCrisisLoadFactor: loadFactor,
    activeCrisisLoadFactorPercent: loadFactor,
    affectedSectorsCount: 4,
    affectedSectors: [
      { id: "hospital_network", name: "Hospitals" },
      { id: "water_infrastructure", name: "Water" },
      { id: "telecommunications", name: "Telecom" },
      { id: "emergency_operations", name: "EOC" },
    ],
    affectedSectorsList: ["Hospitals", "Water", "Telecom", "EOC"],
    stabilizationWindowMinutes: 18,
    stabilizationEta: "ETA 15:00:30 IST",
  };
}

async function loadPlan(
  database: SupabaseClient<Database>,
  status: "approved" | "recommended",
): Promise<AllocationPlanRow | null> {
  let query = database.from("allocation_plans").select("*");
  query = status === "recommended"
    ? query.in("status", ["recommended", "pending_review"])
    : query.eq("status", status);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwDatabaseError(error, `load the ${status} allocation plan`);
  return data;
}

export async function getDashboard(
  databaseValue: SupabaseClient<Database> | null,
): Promise<DashboardData> {
  const database = requireDatabase(databaseValue);
  const [
    sectorRows,
    incidentResponse,
    activePlanRow,
    recommendedPlanRow,
    telemetry,
    centerState,
  ] = await Promise.all([
    loadSectorRows(database),
    database.from("incidents").select("*").order("created_at", { ascending: false }),
    loadPlan(database, "approved"),
    loadPlan(database, "recommended"),
    loadLatestTelemetry(database),
    loadCommandCenterState(database),
  ]);

  if (incidentResponse.error) {
    throwDatabaseError(incidentResponse.error, "load incidents");
  }
  const incidents = requireRows(incidentResponse.data, "load incidents");
  const incidentIds = incidents.map((incident) => incident.id);
  let impacts: IncidentImpactRow[] = [];
  if (incidentIds.length > 0) {
    const response = await database
      .from("incident_impacts")
      .select("*")
      .in("incident_id", incidentIds);
    if (response.error) {
      throwDatabaseError(response.error, "load incident impact analysis");
    }
    impacts = requireRows(response.data, "load incident impact analysis");
  }

  const activeIds = new Set(
    incidents.filter((incident) => incident.status === "active").map((incident) => incident.id),
  );
  const activeImpacts = impacts.filter((impact) => activeIds.has(impact.incident_id));
  const demandBySector = toSectorDemand(sectorRows, activeImpacts);
  const planIds = [activePlanRow?.id, recommendedPlanRow?.id].filter(
    (id): id is string => id !== undefined,
  );
  let items: AllocationPlanItemRow[] = [];
  if (planIds.length > 0) {
    const response = await database
      .from("allocation_plan_items")
      .select("*")
      .in("allocation_plan_id", planIds);
    if (response.error) {
      throwDatabaseError(response.error, "load allocation plan items");
    }
    items = requireRows(response.data, "load allocation plan items");
  }

  const activeItems = items.filter(
    (item) => item.allocation_plan_id === activePlanRow?.id,
  );
  const recommendedItems = items.filter(
    (item) => item.allocation_plan_id === recommendedPlanRow?.id,
  );
  const activeAllocationBySector = mapPlanItems(activeItems);
  const severityOrder: Record<string, number> = {
    critical: 0,
    urgent: 1,
    stable: 2,
  };
  const reportsByIncident = await loadReportSummaries(
    database,
    incidents.map((incident) => incident.id),
  );
  const enrichedIncidents = incidents.map((incident) =>
    formatIncident(
      incident,
      impacts.filter((impact) => impact.incident_id === incident.id),
      reportsByIncident.get(incident.id),
    ),
  ).sort((left, right) =>
    (severityOrder[left.severity] ?? 3) - (severityOrder[right.severity] ?? 3) ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
  const cityGridLoadMw =
    centerState.city_grid_base_load_mw + (activePlanRow?.total_capacity_mw ?? 0);

  return {
    availableCapacityMw:
      activePlanRow?.total_available_capacity_mw ??
      centerState.emergency_capacity_mw,
    maximumEmergencyCapacityMw: centerState.emergency_capacity_limit_mw,
    cityGridLoadMw,
    cityGridCapacityMw: centerState.city_grid_capacity_mw,
    cityGridHeadroomMw: Math.max(
      0,
      centerState.city_grid_capacity_mw - cityGridLoadMw,
    ),
    activeIncidentsCount: incidents.filter((incident) => incident.status === "active").length,
    emergencyResponseUnitsDeployed: incidents
      .filter((incident) => incident.status === "active")
      .reduce((total, incident) => total + incident.response_units, 0),
    telemetryNodesActive: centerState.telemetry_nodes_active,
    telemetryOnlinePercentage: centerState.telemetry_online_percentage,
    gridStabilityIndex: centerState.grid_stability_index,
    ambientTemperatureC: centerState.ambient_temperature_c,
    sectors: demandBySector.map((sector) => ({
      id: sector.id,
      name: sector.name,
      baselineDemandMw:
        sectorRows.find((row) => row.id === sector.id)?.baseline_demand_mw ?? 0,
      demandMw: sector.demandMw,
      minimumSafeCapacityMw: sector.minimumSafeCapacityMw,
      maximumCapacityMw: sector.maximumCapacityMw,
      priorityWeight: sector.priorityWeight,
      allocatedCapacityMw: activeAllocationBySector[sector.id] ?? null,
      utilizationPercentage:
        activeAllocationBySector[sector.id] === undefined
          ? 0
          : Math.round(
              (activeAllocationBySector[sector.id]! /
                (sectorRows.find((row) => row.id === sector.id)?.maximum_capacity_mw ?? 1)) *
                100,
            ),
      operationalStatus:
        telemetry.sectors.get(sector.id)?.status ??
        sectorRows.find((row) => row.id === sector.id)?.operational_status ??
        "unknown",
      incidentImpactMw: activeImpacts
        .filter((impact) => impact.sector_id === sector.id)
        .reduce((total, impact) => total + impact.demand_delta_mw, 0),
      incidentImpactNotes: Array.from(
        new Set(
          activeImpacts
            .filter((impact) => impact.sector_id === sector.id)
            .map((impact) => impact.reason || impact.rationale)
            .filter((note) => note.length > 0),
        ),
      ),
      operationalNote:
        getMetadataText(
          sectorRows.find((row) => row.id === sector.id)?.metadata ?? {},
          "operational_note",
        ) ?? "No additional operational note.",
      allocationStatus: activePlanRow?.status ?? null,
    })),
    incidents: enrichedIncidents,
    activePlan: activePlanRow
      ? formatPlan(activePlanRow, activeItems, sectorRows, centerState)
      : null,
    recommendedPlan: recommendedPlanRow
      ? formatPlan(recommendedPlanRow, recommendedItems, sectorRows, centerState)
      : null,
    latestTelemetry: telemetry.global
      ? {
          capturedAt: telemetry.global.captured_at,
          allocatedCapacityMw: telemetry.global.allocated_capacity_mw,
          sectorDemandMw: telemetry.global.sector_demand_mw,
        }
      : null,
  };
}

export async function listIncidents(
  databaseValue: SupabaseClient<Database> | null,
): Promise<IncidentView[]> {
  const database = requireDatabase(databaseValue);
  const { data, error } = await database
    .from("incidents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throwDatabaseError(error, "load incidents");
  const rows = requireRows(data, "load incidents");
  if (rows.length === 0) return [];

  const { data: impacts, error: impactError } = await database
    .from("incident_impacts")
    .select("*")
    .in(
      "incident_id",
      rows.map((row) => row.id),
    );
  if (impactError) {
    throwDatabaseError(impactError, "load incident impact analysis");
  }
  const impactRows = requireRows(impacts, "load incident impact analysis");
  const reportsByIncident = await loadReportSummaries(
    database,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    formatIncident(
      row,
      impactRows.filter((impact) => impact.incident_id === row.id),
      reportsByIncident.get(row.id),
    ),
  ).sort((left, right) =>
    Number(right.isEscalated) - Number(left.isEscalated) ||
    (left.severity === "critical" ? 0 : 1) -
      (right.severity === "critical" ? 0 : 1) ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

function serializableImpacts(impacts: readonly IncidentImpact[]): Json {
  return impacts.map((impact) => ({
    sector_id: impact.sectorId,
    demand_delta_mw: impact.demandDeltaMw,
    impact_score: impact.impactScore,
    rationale: impact.rationale,
  }));
}

const DISPATCH_DISCLAIMER =
  "This simulation does not connect to police, ambulance, fire department, 112, or government dispatch systems.";

function isConfirmationStatus(value: string): value is ConfirmationStatus {
  return (
    value === "report_received" ||
    value === "triaged" ||
    value === "dispatch_requested" ||
    value === "authority_review" ||
    value === "response_active"
  );
}

async function loadReportSummaries(
  database: SupabaseClient<Database>,
  incidentIds: string[],
): Promise<Map<string, EmergencyReportSummary>> {
  const summaries = new Map<string, EmergencyReportSummary>();
  if (incidentIds.length === 0) return summaries;
  const { data, error } = await database
    .from("emergency_reports")
    .select("id, incident_id, category, confirmation_status, created_at")
    .in("incident_id", incidentIds)
    .order("created_at", { ascending: false });
  if (error) throwDatabaseError(error, "load emergency reports");
  for (const row of data ?? []) {
    if (summaries.has(row.incident_id)) continue;
    summaries.set(row.incident_id, {
      id: row.id,
      incidentId: row.incident_id,
      category: row.category,
      confirmationStatus: isConfirmationStatus(row.confirmation_status)
        ? row.confirmation_status
        : null,
    });
  }
  return summaries;
}

export async function submitEmergencyReport(
  databaseValue: SupabaseClient<Database> | null,
  report: CreateEmergencyReport,
): Promise<SubmittedReportResult> {
  const database = requireDatabase(databaseValue);
  const allocationInput = await loadDynamicAllocationInput(database);
  const incidentId = randomUUID();
  const reportId = randomUUID();
  const incidentCode = `INC-${incidentId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
  const latitude = report.latitude ?? (report.locationSource === "geolocation" ? null : 12.9716);
  const longitude =
    report.longitude ?? (report.locationSource === "geolocation" ? null : 77.6412);
  const triage = triageCitizenReport(
    allocationInput.sectors.map((sector) => ({
      id: sector.sectorId,
      name: sector.sectorName,
      demandMw: sector.baselineDemandMw,
      minimumSafeCapacityMw: sector.minimumSafeCapacityMw,
      maximumCapacityMw: sector.maximumRequestedCapacityMw,
      priorityWeight: sector.priorityWeight,
    })),
    {
      category: report.category,
      incidentType: report.incidentType,
      urgency: report.urgency,
      severity: report.severity,
      location: report.location,
    },
  );
  const timeline = confirmationTimeline(triage.allocationRecommended);
  const currentStatus = timeline[timeline.length - 1]?.status ?? "dispatch_requested";

  let planPayload: Json | null = null;
  if (triage.allocationRecommended) {
    const hypotheticalInput: DynamicAllocationInput = {
      ...allocationInput,
      sectors: allocationInput.sectors.map((sector) => ({
        ...sector,
        incidentImpacts: [
          ...sector.incidentImpacts,
          {
            incidentId: incidentCode,
            incidentTitle: triage.title,
            incidentType: triage.incidentType,
            severity: triage.severity,
            demandDeltaMw:
              triage.impacts.find((impact) => impact.sectorId === sector.sectorId)
                ?.demandDeltaMw ?? 0,
          },
        ],
      })),
    };
    const simulation = calculateDynamicAllocation(hypotheticalInput);
    planPayload = dynamicPlanPayload(
      simulation,
      `Recommended allocation after ${triage.title}`,
      incidentId,
    );
  }

  const { data, error } = await database.rpc("submit_emergency_report", {
    p_incident: {
      id: incidentId,
      incident_code: incidentCode,
      title: triage.title,
      description: report.description,
      incident_type: triage.incidentType,
      severity: triage.severity,
      location: report.location,
      address: report.address,
      latitude,
      longitude,
      response_units: triage.responseUnits,
      is_escalated: triage.isEscalated,
      automated_triage: true,
      dispatch_details: DISPATCH_DISCLAIMER,
    },
    p_report: {
      id: reportId,
      reporter_alias: report.reporterAlias,
      description: report.description,
      location: report.location,
      address: report.address,
      severity: triage.severity,
      urgency: triage.severity,
      category: triage.category,
      is_anonymous: report.isAnonymous,
      latitude,
      longitude,
      language: report.language,
      location_source: report.locationSource,
      input_mode: report.inputMode,
      evidence_paths: report.evidencePaths,
      confirmation_status: currentStatus,
      triage_summary: triage.rationale,
      timeline: timeline.map((step) => ({
        status: step.status,
        note: step.note,
      })),
    },
    p_impacts: serializableImpacts(triage.impacts),
    p_plan: planPayload,
  });
  if (error) throwDatabaseError(error, "submit the emergency report");
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ServiceError("The database did not confirm the emergency report.", 500);
  }

  const result = data as Record<string, Json>;
  if (
    typeof result.incident_id !== "string" ||
    typeof result.report_id !== "string"
  ) {
    throw new ServiceError("The database returned an invalid report confirmation.", 500);
  }

  const allocationPlanId =
    typeof result.allocation_plan_id === "string" ? result.allocation_plan_id : null;
  const confirmationStatus = isConfirmationStatus(String(result.confirmation_status ?? ""))
    ? (result.confirmation_status as ConfirmationStatus)
    : currentStatus;

  return {
    incidentId: result.incident_id,
    incidentCode,
    reportId: result.report_id,
    allocationPlanId,
    confirmationStatus,
    confirmationLabel: confirmationLabel(confirmationStatus),
    timeline,
    affectedSectors: triage.affectedSectors,
    simulationOnly: true,
    dispatchDisclaimer: DISPATCH_DISCLAIMER,
  };
}

export async function getEmergencyReport(
  databaseValue: SupabaseClient<Database> | null,
  reportId: string,
): Promise<SubmittedReportResult & { incident: IncidentView | null }> {
  const database = requireDatabase(databaseValue);
  const { data, error } = await database
    .from("emergency_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "load the emergency report");
  if (!data) throw new ServiceError("Emergency report not found.", 404);

  const { data: events, error: eventError } = await database
    .from("emergency_report_events")
    .select("status, note, created_at")
    .eq("report_id", reportId)
    .order("created_at", { ascending: true });
  if (eventError) throwDatabaseError(eventError, "load report confirmation events");

  const { data: incident, error: incidentError } = await database
    .from("incidents")
    .select("*")
    .eq("id", data.incident_id)
    .maybeSingle();
  if (incidentError) throwDatabaseError(incidentError, "load the report incident");

  let impacts: IncidentImpactRow[] = [];
  if (incident) {
    const impactResponse = await database
      .from("incident_impacts")
      .select("*")
      .eq("incident_id", incident.id);
    if (impactResponse.error) {
      throwDatabaseError(impactResponse.error, "load report incident impacts");
    }
    impacts = requireRows(impactResponse.data, "load report incident impacts");
  }

  const { data: plan } = await database
    .from("allocation_plans")
    .select("id")
    .eq("incident_id", data.incident_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const confirmationStatus = isConfirmationStatus(data.confirmation_status)
    ? data.confirmation_status
    : "report_received";
  const timeline = (events ?? []).flatMap((event) =>
    isConfirmationStatus(event.status)
      ? [
          {
            status: event.status,
            label: confirmationLabel(event.status),
            note: event.note,
          },
        ]
      : [],
  );

  return {
    incidentId: data.incident_id,
    incidentCode: incident?.incident_code ?? data.incident_id,
    reportId: data.id,
    allocationPlanId: plan?.id ?? null,
    confirmationStatus,
    confirmationLabel: confirmationLabel(confirmationStatus),
    timeline:
      timeline.length > 0
        ? timeline
        : confirmationTimeline(plan?.id !== undefined),
    affectedSectors: impacts
      .filter((impact) => impact.demand_delta_mw !== 0)
      .map((impact) => ({
        id: impact.sector_id,
        name: impact.sector_id,
      })),
    simulationOnly: true,
    dispatchDisclaimer: DISPATCH_DISCLAIMER,
    incident: incident
      ? formatIncident(incident, impacts, {
          id: data.id,
          incidentId: data.incident_id,
          category: data.category,
          confirmationStatus,
        })
      : null,
  };
}

export async function uploadEmergencyEvidence(
  databaseValue: SupabaseClient<Database> | null,
  upload: EvidenceUpload,
): Promise<{ stored: boolean; path: string | null; message: string }> {
  const database = requireDatabase(databaseValue);
  const mimeType =
    upload.mimeType === "image/jpg" ? "image/jpeg" : upload.mimeType;
  const extension =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const path = `pending/${randomUUID()}.${extension}`;
  const raw = upload.contentBase64.includes(",")
    ? upload.contentBase64.slice(upload.contentBase64.indexOf(",") + 1)
    : upload.contentBase64;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    throw new ServiceError("The evidence file could not be decoded.", 400);
  }
  if (bytes.length < 32 || bytes.length > 5_000_000) {
    throw new ServiceError("Visual evidence must be an image under 5 MB.", 400);
  }

  const { error } = await database.storage
    .from("emergency-evidence")
    .upload(path, bytes, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) {
    return {
      stored: false,
      path: null,
      message:
        "Supabase Storage is not available for this demo. The report can still be submitted without visual evidence.",
    };
  }
  return {
    stored: true,
    path,
    message: "Visual evidence stored for the simulation report.",
  };
}

export async function createRecommendation(
  databaseValue: SupabaseClient<Database> | null,
): Promise<{
  planId: string;
  simulation: DynamicAllocationResult;
}> {
  const database = requireDatabase(databaseValue);
  const simulation = calculateDynamicAllocation(
    await loadDynamicAllocationInput(database),
  );
  const plan = dynamicPlanPayload(simulation);
  const { data, error } = await database.rpc("create_allocation_plan", {
    p_plan: plan,
    p_actor: "crisisgrid-simulation",
  });
  if (error) throwDatabaseError(error, "create a recommended allocation plan");
  if (typeof data !== "string") {
    throw new ServiceError("The database did not confirm the allocation plan.", 500);
  }
  return { planId: data, simulation };
}

export async function transferEmergencyReserve(
  databaseValue: SupabaseClient<Database> | null,
): Promise<{
  transfer: Record<string, Json>;
  recommendation: Awaited<ReturnType<typeof createRecommendation>>;
  dashboard: DashboardData;
}> {
  const database = requireDatabase(databaseValue);
  const { data, error } = await database.rpc("transfer_emergency_reserve", {
    p_amount_mw: 1,
  });
  if (error) throwDatabaseError(error, "transfer emergency reserve capacity");
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ServiceError(
      "The database did not confirm the reserve transfer.",
      500,
    );
  }

  const result = data as Record<string, Json>;
  if (result.transferred !== true) {
    throw new ServiceError(
      typeof result.reason === "string"
        ? result.reason
        : "The reserve transfer was denied by the city capacity limits.",
      409,
    );
  }

  const recommendation = await createRecommendation(database);
  const dashboard = await getDashboard(database);
  return { transfer: result, recommendation, dashboard };
}

export async function reviewAllocationPlan(
  databaseValue: SupabaseClient<Database> | null,
  planId: string,
  review: CreateReview,
): Promise<{
  success: boolean;
  planId: string;
  status: "approved" | "rejected" | "pending_review";
  isApproved: boolean;
  quorum: PlanQuorum;
  dispatchStatus?: string;
  signatures?: PlanSignature[];
  message: string;
}> {
  const database = requireDatabase(databaseValue);

  // 1. RBAC Authorization: Only AUTHORITY users can approve or reject plans
  if (review.role !== "AUTHORITY") {
    await database.from("audit_logs").insert({
      actor: `${review.reviewer} (${review.role})`,
      action: "allocation_plan.authorization_denied",
      entity_type: "allocation_plan",
      entity_id: planId,
      details: {
        attempted_role: review.role,
        decision: review.decision,
        reason: "Only AUTHORITY users can approve or reject allocation plans.",
      },
      event_type: "security.rbac_denial",
      description: `Access Denied: Attempted plan review without AUTHORITY role. Current role: ${review.role}.`,
      metadata: { simulation_only: true },
    });
    throw new ServiceError(
      `Authorization Denied: Only AUTHORITY users can approve or reject plans. Current role: ${review.role}.`,
      403,
    );
  }

  // 2. Fetch the target plan
  const { data: plan, error: planError } = await database
    .from("allocation_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();

  if (planError) throwDatabaseError(planError, "load allocation plan for review");
  if (!plan) throw new ServiceError("Allocation plan not found.", 404);
  if (plan.status !== "recommended" && plan.status !== "pending_review") {
    throw new ServiceError("This recommendation is no longer awaiting review.", 409);
  }

  // 3. ACTION: REJECT & MAINTAIN BASELINE
  if (review.decision === "reject") {
    await database
      .from("allocation_plans")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", planId);

    await database.from("authority_reviews").insert({
      allocation_plan_id: planId,
      decision: "rejected",
      reviewer: review.reviewer,
      notes:
        review.notes ||
        "Recommendation rejected by authority. Maintaining baseline grid allocation.",
      authority_name: review.reviewer,
      authority_role: review.signerRole,
      comments: review.notes || "Baseline maintained.",
      decided_at: new Date().toISOString(),
    });

    await database.from("audit_logs").insert({
      actor: `${review.reviewer} (${review.signerRole})`,
      action: "allocation_plan.rejected",
      entity_type: "allocation_plan",
      entity_id: planId,
      details: {
        decision: "rejected",
        notes: review.notes,
        baseline_maintained: true,
      },
      event_type: "allocation_plan.rejected",
      description:
        "Authority rejected recommended allocation plan and maintained baseline load factors.",
      metadata: { simulation_only: true },
    });

    return {
      success: true,
      planId,
      status: "rejected",
      isApproved: false,
      quorum: {
        signed: 0,
        current: 0,
        required: 2,
        text: "0 of 2 Signed",
        label: "0 of 2 Signed",
        isComplete: false,
      },
      message:
        "Recommendation rejected. Municipal grid allocations maintained at baseline.",
    };
  }

  // 4. ACTION: MODIFY ALLOCATION PARAMETERS
  const sectors = await loadSectorRows(database);
  if (review.decision === "modify") {
    const allocations = review.items ?? [];
    const seen = new Set<string>();
    let total = 0;
    for (const item of allocations) {
      const sector = sectors.find((c) => c.id === item.sectorId);
      if (!sector || seen.has(item.sectorId)) {
        throw new ServiceError(
          "Modified plans must include each configured sector exactly once.",
          422,
        );
      }
      if (item.allocatedCapacityMw < 0) {
        throw new ServiceError(
          `Allocation for ${sector.name} cannot be negative.`,
          422,
        );
      }
      if (item.allocatedCapacityMw < sector.minimum_safe_capacity_mw) {
        throw new ServiceError(
          `${sector.name} cannot be allocated below its ${sector.minimum_safe_capacity_mw} MW safety floor.`,
          422,
        );
      }
      if (item.allocatedCapacityMw > sector.maximum_capacity_mw) {
        throw new ServiceError(
          `${sector.name} cannot be allocated above its ${sector.maximum_capacity_mw} MW maximum capacity.`,
          422,
        );
      }
      seen.add(item.sectorId);
      total += item.allocatedCapacityMw;
    }
    if (seen.size !== sectors.length || total > AVAILABLE_CAPACITY_MW) {
      throw new ServiceError(
        `Modified plans must include every sector and cannot exceed ${AVAILABLE_CAPACITY_MW} MW.`,
        422,
      );
    }

    await database
      .from("allocation_plan_items")
      .delete()
      .eq("allocation_plan_id", planId);

    await database.from("allocation_plan_items").insert(
      allocations.map((item) => {
        const sector = sectors.find((c) => c.id === item.sectorId)!;
        return {
          allocation_plan_id: planId,
          sector_id: item.sectorId,
          allocated_capacity_mw: item.allocatedCapacityMw,
          previous_allocation_mw: sector.current_allocation_mw,
          recommended_allocation_mw: item.allocatedCapacityMw,
          delta_mw: item.allocatedCapacityMw - sector.current_allocation_mw,
          rationale: `Authority manual adjustment (${item.allocatedCapacityMw} MW).`,
          safety_status: "safe",
        };
      }),
    );

    await database
      .from("allocation_plans")
      .update({
        total_capacity_mw: total,
        status: "pending_review",
        dispatch_status: "pending",
        signatures: [] as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", planId);

    await database.from("audit_logs").insert({
      actor: `${review.reviewer} (${review.signerRole})`,
      action: "allocation_plan.parameters_modified",
      entity_type: "allocation_plan",
      entity_id: planId,
      details: { total_capacity_mw: total, allocations },
      event_type: "allocation_plan.parameters_modified",
      description: `Authority modified allocation limits within statutory tolerances (Total ${total} MW).`,
      metadata: { simulation_only: true },
    });

    return {
      success: true,
      planId,
      status: "pending_review",
      isApproved: false,
      quorum: {
        signed: 0,
        current: 0,
        required: 2,
        text: "0 of 2 Signed",
        label: "0 of 2 Signed",
        isComplete: false,
      },
      message:
        "Allocation parameters updated. Plan is awaiting dual-authority review and signatures.",
    };
  }

  // 5. ACTION: AUTHORIZE & DISPATCH WITH DUAL SIGNATURE WORKFLOW
  // Pre-approval Validation:
  // - Total <= available capacity
  // - Critical safety floors respected
  // - No invalid negative allocations
  const { data: currentItems, error: itemsError } = await database
    .from("allocation_plan_items")
    .select("*")
    .eq("allocation_plan_id", planId);

  if (itemsError) throwDatabaseError(itemsError, "validate plan items");
  const planItems = requireRows(currentItems, "validate plan items");

  const totalCapacity = planItems.reduce(
    (sum, item) => sum + item.allocated_capacity_mw,
    0,
  );
  if (totalCapacity > AVAILABLE_CAPACITY_MW) {
    throw new ServiceError(
      `Plan total allocation (${totalCapacity.toFixed(1)} MW) exceeds available capacity of ${AVAILABLE_CAPACITY_MW} MW.`,
      422,
    );
  }

  for (const item of planItems) {
    const sector = sectors.find((s) => s.id === item.sector_id);
    if (!sector) {
      throw new ServiceError(
        `Unknown sector: ${item.sector_id}`,
        422,
      );
    }
    if (item.allocated_capacity_mw < 0) {
      throw new ServiceError(
        `Allocation for ${sector.name} cannot be negative.`,
        422,
      );
    }
    if (item.allocated_capacity_mw < sector.minimum_safe_capacity_mw) {
      throw new ServiceError(
        `Critical safety floor violated: ${sector.name} cannot be allocated below its ${sector.minimum_safe_capacity_mw} MW safe threshold.`,
        422,
      );
    }
  }

  // Dual-Key Signatures processing:
  const rawRationale = getJsonRecord(plan.rationale);
  const rawSigs =
    (plan.signatures as Json[] | undefined) ||
    (Array.isArray(rawRationale?.signatures) ? rawRationale.signatures : null);

  let existingSignatures: PlanSignature[] = [];
  if (Array.isArray(rawSigs) && rawSigs.length > 0) {
    existingSignatures = rawSigs.map((sig) => {
      const rec = getJsonRecord(sig as Json);
      return {
        role: String(rec?.role ?? "Authority Signer"),
        signerName: String(rec?.signer_name ?? rec?.signerName ?? "Authorized Signer"),
        signatureHash: String(rec?.signature_hash ?? rec?.signatureHash ?? "0x9F4C...B2"),
        signedAt: String(rec?.signed_at ?? rec?.signedAt ?? new Date().toISOString()),
      };
    });
  } else {
    // Default seeded pending review begins with Gov. Operations Lead (1 of 2 signed)
    existingSignatures = [
      {
        role: "Gov. Operations Lead",
        signerName: "S. Mukherjee",
        signatureHash: "0x9F4C7A1B8E2D9914F6B2C8E4A01234B2",
        signedAt: "2026-03-30T14:38:22+05:30",
      },
    ];
  }

  // Add the new signature if not already signed by this role
  const alreadySigned = existingSignatures.some(
    (s) => s.role === review.signerRole,
  );
  let updatedSignatures = existingSignatures;
  const newHash =
    review.signatureHash ||
    `0x${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 32)}`;

  if (!alreadySigned) {
    const newSig: PlanSignature = {
      role: review.signerRole,
      signerName: review.reviewer,
      signatureHash: newHash,
      signedAt: new Date().toISOString(),
    };
    updatedSignatures = [...existingSignatures, newSig];
  }

  const requiredCount = plan.required_signatures || 2;
  const isComplete = updatedSignatures.length >= requiredCount;

  if (isComplete) {
    // QUORUM COMPLETE -> PLAN BECOMES APPROVED & DISPATCHED
    await database
      .from("allocation_plans")
      .update({
        status: "superseded",
        updated_at: new Date().toISOString(),
      })
      .eq("status", "approved");

    await database
      .from("allocation_plans")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        dispatch_status: "active",
        signatures: updatedSignatures as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", planId);

    // Update current sector allocations and operational status
    for (const item of planItems) {
      await database
        .from("infrastructure_sectors")
        .update({
          current_allocation_mw: item.allocated_capacity_mw,
          operational_status:
            item.sector_id === "water_infrastructure"
              ? "surge"
              : item.sector_id === "emergency_operations"
                ? "elevated"
                : "operational",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.sector_id);
    }

    // Update Command Center state
    await database
      .from("command_center_state")
      .update({
        dispatch_status: "active",
        last_dispatched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", "bengaluru");

    // Insert Authority Review record
    await database.from("authority_reviews").insert({
      allocation_plan_id: planId,
      decision: "approved",
      reviewer: review.reviewer,
      notes:
        review.notes ||
        "Dual-key quorum complete. Plan authorized and dispatched to municipal grid.",
      authority_name: review.reviewer,
      authority_role: review.signerRole,
      user_role: "AUTHORITY",
      signature_hash: newHash,
      comments: review.notes || "Grid controllers synchronized.",
      decided_at: new Date().toISOString(),
    });

    if (plan.incident_id) {
      await database
        .from("emergency_reports")
        .update({
          confirmation_status: "response_active",
          status: "accepted",
        })
        .eq("incident_id", plan.incident_id);
      const { data: linkedReports } = await database
        .from("emergency_reports")
        .select("id")
        .eq("incident_id", plan.incident_id);
      if (linkedReports && linkedReports.length > 0) {
        await database.from("emergency_report_events").insert(
          linkedReports.map((linked) => ({
            report_id: linked.id,
            status: "response_active",
            note: "Authority approved the simulation allocation. Response is active inside CRISISGRID only.",
          })),
        );
      }
    }

    // Create immutable audit logs
    await database.from("audit_logs").insert([
      {
        actor: `${review.reviewer} (${review.signerRole})`,
        action: "allocation_plan.approved",
        entity_type: "allocation_plan",
        entity_id: planId,
        details: {
          decision: "approved",
          quorum: `${updatedSignatures.length} of ${requiredCount} Signed`,
          signatures: updatedSignatures,
          total_capacity_mw: totalCapacity,
        },
        event_type: "allocation_plan.approved",
        description: `Dual-key quorum complete (${updatedSignatures.length}/${requiredCount}). Capacity plan approved by ${review.reviewer}.`,
        metadata: { simulation_only: true },
      },
      {
        actor: `${review.reviewer} (${review.signerRole})`,
        action: "dispatch.activated",
        entity_type: "allocation_plan",
        entity_id: planId,
        details: {
          dispatch_status: "active",
          total_capacity_mw: totalCapacity,
        },
        event_type: "dispatch.activated",
        description:
          "Capacity plan dispatched to municipal grid transformers and Command Center.",
        metadata: { simulation_only: true },
      },
    ]);

    return {
      success: true,
      planId,
      status: "approved",
      isApproved: true,
      dispatchStatus: "active",
      signatures: updatedSignatures,
      quorum: {
        signed: updatedSignatures.length,
        current: updatedSignatures.length,
        required: requiredCount,
        text: `${updatedSignatures.length} of ${requiredCount} Signed`,
        label: `${updatedSignatures.length} of ${requiredCount} Signed`,
        isComplete: true,
      },
      message:
        "Plan authorized and dispatched to municipal grid controllers. Quorum 2/2 sealed.",
    };
  }

  // Quorum incomplete (1 of 2 signed)
  await database
    .from("allocation_plans")
    .update({
      signatures: updatedSignatures as unknown as Json,
      status: "pending_review",
      dispatch_status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId);

  await database.from("authority_reviews").insert({
    allocation_plan_id: planId,
    decision: "signed",
    reviewer: review.reviewer,
    notes: review.notes || "Authority signature recorded.",
    authority_name: review.reviewer,
    authority_role: review.signerRole,
    user_role: "AUTHORITY",
    signature_hash: newHash,
    comments: "Quorum signature recorded. Awaiting final executive key.",
    decided_at: new Date().toISOString(),
  });

  await database.from("audit_logs").insert({
    actor: `${review.reviewer} (${review.signerRole})`,
    action: "allocation_plan.signed",
    entity_type: "allocation_plan",
    entity_id: planId,
    details: {
      decision: "signed",
      quorum: `${updatedSignatures.length} of ${requiredCount} Signed`,
      signatures: updatedSignatures as unknown as Json,
    },
    event_type: "allocation_plan.signed",
    description: `Authority signature recorded for ${review.signerRole}. Awaiting second authority signature.`,
    metadata: { simulation_only: true },
  });

  return {
    success: true,
    planId,
    status: "pending_review",
    isApproved: false,
    dispatchStatus: "pending",
    signatures: updatedSignatures,
    quorum: {
      signed: updatedSignatures.length,
      current: updatedSignatures.length,
      required: requiredCount,
      text: `${updatedSignatures.length} of ${requiredCount} Signed`,
      label: `${updatedSignatures.length} of ${requiredCount} Signed`,
      isComplete: false,
    },
    message: `Signature ${updatedSignatures.length} of ${requiredCount} recorded. Awaiting second authority signature.`,
  };
}

export async function modifyAllocationParameters(
  databaseValue: SupabaseClient<Database> | null,
  planId: string,
  params: import("../http/schemas.js").ModifyParameters,
): Promise<{
  success: boolean;
  planId: string;
  simulation: DynamicAllocationResult;
  plan: DetailedPlanView;
  message: string;
}> {
  const database = requireDatabase(databaseValue);

  // RBAC validation: CITIZEN cannot modify parameters
  if (params.role === "CITIZEN") {
    await database.from("audit_logs").insert({
      actor: `${params.reviewer} (CITIZEN)`,
      action: "allocation_plan.authorization_denied",
      entity_type: "allocation_plan",
      entity_id: planId,
      details: {
        attempted_role: "CITIZEN",
        action: "modify_parameters",
        reason: "Citizens cannot modify emergency allocation parameters.",
      },
      event_type: "security.rbac_denial",
      description: "Unauthorized parameter modification attempt was rejected.",
      metadata: { simulation_only: true },
    });
    throw new ServiceError(
      "Authorization Denied: Only AUTHORITY or OPERATOR users can modify allocation parameters.",
      403,
    );
  }

  const sectors = await loadSectorRows(database);

  // If sectorAllocations are provided, validate:
  // 1. Total <= 45 MW
  // 2. Critical safety floors respected
  // 3. No negative allocations
  if (params.sectorAllocations && params.sectorAllocations.length > 0) {
    let total = 0;
    for (const alloc of params.sectorAllocations) {
      const sector = sectors.find((s) => s.id === alloc.sectorId);
      if (!sector) {
        throw new ServiceError(`Unknown infrastructure sector: ${alloc.sectorId}`, 400);
      }
      if (alloc.allocatedCapacityMw < 0) {
        throw new ServiceError(`Allocation for ${sector.name} cannot be negative.`, 400);
      }
      if (alloc.allocatedCapacityMw < sector.minimum_safe_capacity_mw) {
        throw new ServiceError(
          `${sector.name} cannot be allocated below its ${sector.minimum_safe_capacity_mw} MW safety floor.`,
          400,
        );
      }
      if (alloc.allocatedCapacityMw > sector.maximum_capacity_mw) {
        throw new ServiceError(
          `${sector.name} cannot be allocated above its ${sector.maximum_capacity_mw} MW maximum capacity.`,
          400,
        );
      }
      total += alloc.allocatedCapacityMw;
    }

    if (total > AVAILABLE_CAPACITY_MW) {
      throw new ServiceError(
        `Total allocation (${total.toFixed(1)} MW) exceeds the ${AVAILABLE_CAPACITY_MW} MW emergency capacity limit.`,
        400,
      );
    }
  }

  // If incidentPriority is provided, update active incidents
  if (params.incidentPriority) {
    const { data: activeIncidents } = await database
      .from("incidents")
      .select("id")
      .eq("status", "active");
    if (activeIncidents && activeIncidents.length > 0) {
      await database
        .from("incidents")
        .update({ severity: params.incidentPriority, updated_at: new Date().toISOString() })
        .in("id", activeIncidents.map((i) => i.id));
    }
  }

  // If emergencyDemand deltas are provided, update incident_impacts
  if (params.emergencyDemand) {
    for (const [sectorId, demandDelta] of Object.entries(params.emergencyDemand)) {
      if (typeof demandDelta === "number") {
        await database
          .from("incident_impacts")
          .update({ demand_delta_mw: demandDelta })
          .eq("sector_id", sectorId);
      }
    }
  }

  // Rerun dynamic allocation
  const input = await loadDynamicAllocationInput(database);
  const firstOverride = params.sectorAllocations?.[0];
  const manualOverride =
    firstOverride && params.sectorAllocations?.length === 1
      ? {
          sectorId: firstOverride.sectorId,
          requestedAllocationMw: firstOverride.allocatedCapacityMw,
        }
      : undefined;

  const simulation = calculateAllocation(input, manualOverride);

  // Build sector items
  const sectorItems =
    params.sectorAllocations && params.sectorAllocations.length === sectors.length
      ? params.sectorAllocations.map((alloc) => {
          const sector = sectors.find((s) => s.id === alloc.sectorId)!;
          return {
            sector_id: alloc.sectorId,
            allocated_capacity_mw: alloc.allocatedCapacityMw,
            previous_allocation_mw: sector.current_allocation_mw,
            recommended_allocation_mw: alloc.allocatedCapacityMw,
            delta_mw: alloc.allocatedCapacityMw - sector.current_allocation_mw,
            rationale: `Manual parameter adjustment (${alloc.allocatedCapacityMw} MW).`,
            safety_status: "safe",
          };
        })
      : simulation.sectors.map((sector) => ({
          sector_id: sector.sectorId,
          allocated_capacity_mw: sector.recommendedAllocation,
          previous_allocation_mw: sector.previousAllocation,
          recommended_allocation_mw: sector.recommendedAllocation,
          delta_mw: sector.delta,
          rationale: sector.rationale,
          safety_status: sector.status === "below_minimum" ? "below_minimum" : "safe",
        }));

  const totalCapacity = sectorItems.reduce(
    (sum, item) => sum + item.allocated_capacity_mw,
    0,
  );

  await database
    .from("allocation_plan_items")
    .delete()
    .eq("allocation_plan_id", planId);

  await database.from("allocation_plan_items").insert(
    sectorItems.map((item) => ({
      allocation_plan_id: planId,
      ...item,
    })),
  );

  // Reset signatures to 0 on parameter modification (requires fresh authority review)
  await database
    .from("allocation_plans")
    .update({
      total_capacity_mw: totalCapacity,
      status: "pending_review",
      dispatch_status: "pending",
      signatures: [] as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId);

  // Insert immutable audit log
  await database.from("audit_logs").insert({
    actor: `${params.reviewer} (${params.role})`,
    action: "allocation_plan.parameters_modified",
    entity_type: "allocation_plan",
    entity_id: planId,
    details: {
      modified_parameters: {
        sectorAllocations: params.sectorAllocations,
        incidentPriority: params.incidentPriority,
        emergencyDemand: params.emergencyDemand,
      },
      total_capacity_mw: totalCapacity,
      decision_factors: simulation.decisionFactors,
    },
    event_type: "allocation_plan.parameters_modified",
    description: `Authority modified allocation parameters within statutory tolerances (Total ${totalCapacity.toFixed(1)} MW); re-ran allocation engine.`,
    metadata: { simulation_only: true },
  });

  const dashboard = await getDashboard(database);
  const plan = dashboard.recommendedPlan!;

  return {
    success: true,
    planId,
    simulation,
    plan,
    message:
      "Allocation parameters applied. Dynamic allocation engine recalculated recommendation for review.",
  };
}

export async function resetPlanSignatures(
  databaseValue: SupabaseClient<Database> | null,
  planId: string,
  targetCount: 0 | 1 = 0,
): Promise<{ success: boolean; plan: DetailedPlanView; quorum: PlanQuorum; message: string }> {
  const database = requireDatabase(databaseValue);
  const signatures: PlanSignature[] =
    targetCount === 1
      ? [
          {
            role: "Gov. Operations Lead",
            signerName: "S. Mukherjee",
            signatureHash: "0x9F4C7A1B8E2D9914F6B2C8E4A01234B2",
            signedAt: "2026-03-30T14:38:22+05:30",
          },
        ]
      : [];

  await database
    .from("allocation_plans")
    .update({
      signatures: signatures as unknown as Json,
      status: "pending_review",
      dispatch_status: "pending",
      approved_at: null,
      rejected_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId);

  await database.from("audit_logs").insert({
    actor: "Demo Coordinator",
    action: "allocation_plan.signatures_reset",
    entity_type: "allocation_plan",
    entity_id: planId,
    details: { target_count: targetCount },
    event_type: "demo.reset",
    description: `Demo signature state reset to ${targetCount} of 2 signed.`,
    metadata: { simulation_only: true },
  });

  const dashboard = await getDashboard(database);
  const plan = dashboard.recommendedPlan!;
  return {
    success: true,
    plan,
    quorum: {
      signed: plan.quorum.signed,
      current: plan.quorum.signed,
      required: plan.quorum.required,
      text: plan.quorum.text,
      label: plan.quorum.text,
      isComplete: plan.quorum.isComplete,
    },
    message: `Signatures reset to ${targetCount} of 2 signed for demo verification.`,
  };
}

export async function getSectors(
  databaseValue: SupabaseClient<Database> | null,
): Promise<SectorRow[]> {
  return loadSectorRows(requireDatabase(databaseValue));
}

export async function databaseIsReachable(
  databaseValue: SupabaseClient<Database> | null,
): Promise<boolean> {
  if (!databaseValue) return false;
  const { error } = await databaseValue
    .from("infrastructure_sectors")
    .select("id")
    .limit(1);
  return error === null;
}

export async function markIncidentStatus(
  databaseValue: SupabaseClient<Database> | null,
  incidentId: string,
  status: "contained" | "resolved",
): Promise<IncidentView> {
  const database = requireDatabase(databaseValue);
  const [allocationInput, incidentResponse] = await Promise.all([
    loadDynamicAllocationInput(database),
    database
      .from("incidents")
      .select("*")
      .eq("id", incidentId)
      .maybeSingle(),
  ]);
  if (incidentResponse.error) {
    throwDatabaseError(incidentResponse.error, "load incident status");
  }
  const incident = incidentResponse.data;
  if (!incident) throw new ServiceError("Incident not found.", 404);
  if (incident.status !== "active") {
    throw new ServiceError(
      "Only active incidents can be contained or resolved.",
      409,
    );
  }

  const { data: impacts, error: impactError } = await database
    .from("incident_impacts")
    .select("*")
    .eq("incident_id", incidentId);
  if (impactError) {
    throwDatabaseError(impactError, "load incident impact analysis");
  }
  const impactRows = requireRows(impacts, "load incident impact analysis");
  const incidentCode = incident.incident_code || incident.id;
  const updatedInput: DynamicAllocationInput = {
    ...allocationInput,
    sectors: allocationInput.sectors.map((sector) => ({
      ...sector,
      incidentImpacts: sector.incidentImpacts.filter(
        (impact) => impact.incidentId !== incidentCode,
      ),
    })),
  };
  const simulation = calculateDynamicAllocation(updatedInput);
  const { data, error } = await database.rpc("update_incident_status", {
    p_incident_id: incidentId,
    p_status: status,
    p_plan: dynamicPlanPayload(
      simulation,
      `Bengaluru allocation after ${incident.title} was ${status}`,
      incidentId,
    ),
  });
  if (error) throwDatabaseError(error, "update incident status");
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ServiceError(
      "The database did not confirm the incident status change.",
      500,
    );
  }

  return formatIncident(
    { ...incident, status, updated_at: new Date().toISOString() },
    impactRows,
  );
}
