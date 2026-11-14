import { randomUUID } from "node:crypto";
import type {
  AllocationPlanItemRow,
  AllocationPlanRow,
  AuditLogRow,
  CommandCenterStateRow,
  EmergencyReportEventRow,
  EmergencyReportRow,
  IncidentImpactRow,
  IncidentRow,
  SectorRow,
  TelemetrySnapshotRow,
} from "../database.types.js";
import {
  AVAILABLE_CAPACITY_MW,
  type SectorDemand,
} from "../domain/allocation.js";
import {
  confirmationLabel,
  confirmationTimeline,
  DEMO_FALLBACK_LOCATION,
  triageCitizenReport,
  type ConfirmationStatus,
} from "../domain/citizen-reporting.js";
import {
  calculateDynamicAllocation,
  type DynamicAllocationInput,
} from "../domain/dynamic-allocation.js";
import type {
  CreateEmergencyReport,
  CreateReview,
  EvidenceUpload,
} from "../http/schemas.js";

const DISPATCH_DISCLAIMER =
  "This simulation does not connect to police, ambulance, fire department, 112, or government dispatch systems.";

export interface CrisisScenario {
  key: string;
  title: string;
  incidentType: string;
  severity: "critical" | "urgent" | "stable";
  location: string;
  address: string;
  description: string;
  responseUnits: number;
  dispatchDetails: string;
  evacuationRadius: number;
  residentsAlerted: number;
  perimeterDetails: string;
  impacts: {
    sectorId: string;
    demandDeltaMw: number;
    impactScore: number;
    rationale: string;
    impactLevel: "high" | "medium" | "low";
    reason: string;
  }[];
}

export const CRISIS_SCENARIOS: Record<string, CrisisScenario> = {
  industrial_fire: {
    key: "industrial_fire",
    title: "Industrial Fire",
    incidentType: "fire_hazmat",
    severity: "critical",
    location: "Indiranagar Industrial Zone",
    address: "Indiranagar Industrial Complex, Sector 4",
    description: "Large-scale industrial fire requiring coordinated emergency response.",
    responseUnits: 14,
    dispatchDetails: "8 Fire Engines · 3 HAZMAT · 3 ALS Units",
    evacuationRadius: 450,
    residentsAlerted: 1420,
    perimeterDetails: "450 m perimeter around Indiranagar Industrial Zone; hazardous-material response active.",
    impacts: [
      {
        sectorId: "water_infrastructure",
        demandDeltaMw: 2,
        impactScore: 1.0,
        impactLevel: "high",
        reason: "Increase water infrastructure capacity by 2 MW for high-pressure fire suppression.",
        rationale: "Water Infrastructure: +2 MW demand for fire suppression and hydrant pressure.",
      },
      {
        sectorId: "emergency_operations",
        demandDeltaMw: 1,
        impactScore: 1.0,
        impactLevel: "high",
        reason: "Increase emergency operations capacity by 1 MW for command and rescue units.",
        rationale: "Emergency Operations: +1 MW demand for mobile command and rescue operations.",
      },
      {
        sectorId: "telecommunications",
        demandDeltaMw: -2,
        impactScore: 0.8,
        impactLevel: "high",
        reason: "Reduce telecommunications allocation by 2 MW; remaining 5 MW stays above safety floor.",
        rationale: "Telecommunications: -2 MW available for reallocation from non-essential bandwidth.",
      },
      {
        sectorId: "hospital_network",
        demandDeltaMw: -1,
        impactScore: 0.8,
        impactLevel: "high",
        reason: "Reduce non-critical hospital load by 1 MW; ICU, trauma, and surgical loads remain protected.",
        rationale: "Hospital Network: -1 MW available for reallocation from non-critical HVAC/facility systems.",
      },
    ],
  },
  urban_flood: {
    key: "urban_flood",
    title: "Urban Flood",
    incidentType: "flood",
    severity: "critical",
    location: "Bellandur & Koramangala Drainage Basin",
    address: "Bellandur Outer Ring Road Corridor",
    description: "Major flooding affecting infrastructure, transport and emergency access.",
    responseUnits: 18,
    dispatchDetails: "10 Rescue Boats · 4 High-Capacity Pumps · 4 NDRF Teams",
    evacuationRadius: 600,
    residentsAlerted: 2800,
    perimeterDetails: "Flood diversion active along Outer Ring Road.",
    impacts: [
      {
        sectorId: "water_infrastructure",
        demandDeltaMw: 3,
        impactScore: 1.0,
        impactLevel: "high",
        reason: "High-volume stormwater pumping and drainage operations require +3 MW.",
        rationale: "Water Infrastructure: +3 MW demand for emergency dewatering and pumping arrays.",
      },
      {
        sectorId: "emergency_operations",
        demandDeltaMw: 2,
        impactScore: 1.0,
        impactLevel: "high",
        reason: "Amphibious rescue, evacuation boats, and field operations require +2 MW.",
        rationale: "Emergency Operations: +2 MW demand for rescue logistics and flood relief.",
      },
      {
        sectorId: "telecommunications",
        demandDeltaMw: -3,
        impactScore: 0.8,
        impactLevel: "high",
        reason: "Throttling commercial bandwidth while maintaining emergency radio channels above safety floor.",
        rationale: "Telecommunications: Priority communications required (-3 MW non-critical capacity reallocated).",
      },
      {
        sectorId: "hospital_network",
        demandDeltaMw: -2,
        impactScore: 0.8,
        impactLevel: "high",
        reason: "Emergency preparedness surge with non-critical load reallocation (-2 MW).",
        rationale: "Hospital Network: Emergency preparedness increase (-2 MW non-critical reallocated).",
      },
    ],
  },
  power_failure: {
    key: "power_failure",
    title: "Power Infrastructure Failure",
    incidentType: "infrastructure",
    severity: "urgent",
    location: "Peenya Substation 220kV Grid",
    address: "Peenya Industrial Area Stage 1",
    description: "Critical substation failure reducing available infrastructure capacity.",
    responseUnits: 10,
    dispatchDetails: "6 Mobile Transformers · 4 Technical Repair Crews",
    evacuationRadius: 200,
    residentsAlerted: 600,
    perimeterDetails: "Electrical containment perimeter around Peenya Substation.",
    impacts: [
      {
        sectorId: "emergency_operations",
        demandDeltaMw: 2,
        impactScore: 1.0,
        impactLevel: "high",
        reason: "Auxiliary generation and rapid repair crews require +2 MW.",
        rationale: "Emergency Operations: +2 MW demand for mobile generators and repair squads.",
      },
      {
        sectorId: "telecommunications",
        demandDeltaMw: -2,
        impactScore: 0.8,
        impactLevel: "high",
        reason: "Cellular towers switched to emergency battery conservation mode (-2 MW).",
        rationale: "Telecommunications: -2 MW available for reallocation within safety floor.",
      },
      {
        sectorId: "water_infrastructure",
        demandDeltaMw: -1,
        impactScore: 0.6,
        impactLevel: "medium",
        reason: "Pumping schedules rebalanced to off-peak periods (-1 MW).",
        rationale: "Water Infrastructure: -1 MW temporary reduction while protecting reservoir reserves.",
      },
      {
        sectorId: "hospital_network",
        demandDeltaMw: 1,
        impactScore: 0.9,
        impactLevel: "high",
        reason: "Standby power feeds to regional hospital network reinforced (+1 MW).",
        rationale: "Hospital Network: +1 MW demand to maintain critical medical life-support circuits.",
      },
    ],
  },
  hazmat: {
    key: "hazmat",
    title: "Hazardous Material Incident",
    incidentType: "fire_hazmat",
    severity: "critical",
    location: "Whitefield Chemical Corridor",
    address: "Whitefield Export Promotion Industrial Park",
    description: "Chemical or hazardous material incident requiring containment and evacuation.",
    responseUnits: 16,
    dispatchDetails: "8 HAZMAT Containment Units · 4 Decon Teams · 4 ALS Ambulances",
    evacuationRadius: 500,
    residentsAlerted: 1950,
    perimeterDetails: "Chemical plume containment perimeter established.",
    impacts: [
      {
        sectorId: "emergency_operations",
        demandDeltaMw: 2,
        impactScore: 1.0,
        impactLevel: "high",
        reason: "HAZMAT response, decontamination protocols, and mobile command require +2 MW.",
        rationale: "Emergency Operations: +2 MW demand for HAZMAT suppression and cordon logistics.",
      },
      {
        sectorId: "water_infrastructure",
        demandDeltaMw: 1,
        impactScore: 0.9,
        impactLevel: "high",
        reason: "Decontamination water curtain and containment washdown require +1 MW.",
        rationale: "Water Infrastructure: +1 MW demand for chemical washdown curtains.",
      },
      {
        sectorId: "telecommunications",
        demandDeltaMw: -2,
        impactScore: 0.8,
        impactLevel: "high",
        reason: "Public alert broadcasting prioritized over general traffic (-2 MW).",
        rationale: "Telecommunications: -2 MW available for reallocation to emergency services.",
      },
      {
        sectorId: "hospital_network",
        demandDeltaMw: -1,
        impactScore: 0.8,
        impactLevel: "high",
        reason: "Toxicology and trauma ICU beds prepared; non-urgent facility loads dialed back (-1 MW).",
        rationale: "Hospital Network: -1 MW non-critical load reallocation while trauma stays protected.",
      },
    ],
  },
};

export class InMemoryCrisisRepository {
  private sectors: SectorRow[] = [];
  private commandCenterState!: CommandCenterStateRow;
  private incidents: IncidentRow[] = [];
  private incidentImpacts: IncidentImpactRow[] = [];
  private emergencyReports: EmergencyReportRow[] = [];
  private emergencyReportEvents: EmergencyReportEventRow[] = [];
  private allocationPlans: AllocationPlanRow[] = [];
  private allocationPlanItems: AllocationPlanItemRow[] = [];
  private auditLogs: AuditLogRow[] = [];
  private telemetrySnapshots: TelemetrySnapshotRow[] = [];

  constructor() {
    this.seed();
  }

  private seed(): void {
    const now = new Date().toISOString();

    this.sectors = [
      {
        id: "hospital_network",
        name: "Hospital Network",
        icon: "local_hospital",
        baseline_demand_mw: 18,
        current_allocation_mw: 18,
        minimum_safe_capacity_mw: 15.5,
        maximum_capacity_mw: 22,
        priority_weight: 1.0,
        operational_flexibility: 0.15,
        life_critical: true,
        operational_status: "operational",
        metadata: {
          critical_services: ["trauma", "ICU"],
          operational_note:
            "ICU, trauma, and emergency surgical loads protected; non-critical HVAC is flexible.",
          city: "Bengaluru Metropolitan Region",
        },
        created_at: now,
        updated_at: now,
      },
      {
        id: "water_infrastructure",
        name: "Water Infrastructure",
        icon: "water_drop",
        baseline_demand_mw: 10,
        current_allocation_mw: 10,
        minimum_safe_capacity_mw: 8,
        maximum_capacity_mw: 18,
        priority_weight: 0.9,
        operational_flexibility: 0.2,
        life_critical: true,
        operational_status: "operational",
        metadata: {
          operational_note:
            "Hydrant pressure and emergency pumping demand elevated for the active fire response.",
          city: "Bengaluru Metropolitan Region",
        },
        created_at: now,
        updated_at: now,
      },
      {
        id: "telecommunications",
        name: "Telecommunications",
        icon: "cell_tower",
        baseline_demand_mw: 7,
        current_allocation_mw: 7,
        minimum_safe_capacity_mw: 4.5,
        maximum_capacity_mw: 10,
        priority_weight: 0.6,
        operational_flexibility: 0.95,
        life_critical: false,
        operational_status: "operational",
        metadata: {
          operational_note:
            "Non-essential civilian bandwidth can be throttled while preserving the 4.5 MW safety floor.",
          city: "Bengaluru Metropolitan Region",
        },
        created_at: now,
        updated_at: now,
      },
      {
        id: "emergency_operations",
        name: "Emergency Operations",
        icon: "emergency",
        baseline_demand_mw: 10,
        current_allocation_mw: 10,
        minimum_safe_capacity_mw: 8,
        maximum_capacity_mw: 15,
        priority_weight: 1.0,
        operational_flexibility: 0.3,
        life_critical: true,
        operational_status: "operational",
        metadata: {
          operational_note:
            "Fire engines, mobile command, and rescue operations are prioritized.",
          city: "Bengaluru Metropolitan Region",
        },
        created_at: now,
        updated_at: now,
      },
    ];

    this.commandCenterState = {
      id: "bengaluru",
      emergency_capacity_mw: 45,
      emergency_capacity_limit_mw: 45,
      city_grid_capacity_mw: 120,
      city_grid_base_load_mw: 75,
      telemetry_nodes_active: 84,
      telemetry_online_percentage: 97.4,
      grid_stability_index: 0.94,
      ambient_temperature_c: 29.4,
      dispatch_status: "standby",
      city_status: "STABLE",
      active_crisis: "NONE",
      active_incident_id: null,
      last_dispatched_at: null,
      updated_at: now,
    };

    this.incidents = [];
    this.incidentImpacts = [];
    this.emergencyReports = [];
    this.emergencyReportEvents = [];

    const baselinePlanId = "00000000-0000-4000-8000-000000000201";

    this.allocationPlans = [
      {
        id: baselinePlanId,
        incident_id: null,
        title: "Bengaluru pre-incident baseline allocation",
        status: "approved",
        total_capacity_mw: 45,
        total_available_capacity_mw: 45,
        rationale: {
          city: "Bengaluru Metropolitan Region",
          model_version: "crisisgrid-rules-v2",
          simulation_only: true,
        },
        approved_at: now,
        rejected_at: null,
        created_by: "system-baseline",
        dispatch_status: "synchronized",
        created_at: now,
        updated_at: now,
      },
    ];

    this.allocationPlanItems = [
      {
        id: randomUUID(),
        allocation_plan_id: baselinePlanId,
        sector_id: "hospital_network",
        allocated_capacity_mw: 18,
        previous_allocation_mw: 18,
        recommended_allocation_mw: 18,
        delta_mw: 0,
        rationale: "Pre-incident baseline allocation.",
        safety_status: "safe",
        created_at: now,
      },
      {
        id: randomUUID(),
        allocation_plan_id: baselinePlanId,
        sector_id: "water_infrastructure",
        allocated_capacity_mw: 10,
        previous_allocation_mw: 10,
        recommended_allocation_mw: 10,
        delta_mw: 0,
        rationale: "Pre-incident baseline allocation.",
        safety_status: "safe",
        created_at: now,
      },
      {
        id: randomUUID(),
        allocation_plan_id: baselinePlanId,
        sector_id: "telecommunications",
        allocated_capacity_mw: 7,
        previous_allocation_mw: 7,
        recommended_allocation_mw: 7,
        delta_mw: 0,
        rationale: "Pre-incident baseline allocation.",
        safety_status: "safe",
        created_at: now,
      },
      {
        id: randomUUID(),
        allocation_plan_id: baselinePlanId,
        sector_id: "emergency_operations",
        allocated_capacity_mw: 10,
        previous_allocation_mw: 10,
        recommended_allocation_mw: 10,
        delta_mw: 0,
        rationale: "Pre-incident baseline allocation.",
        safety_status: "safe",
        created_at: now,
      },
    ];

    this.auditLogs = [
      {
        id: randomUUID(),
        actor: "system",
        action: "system.initialized",
        entity_type: "command_center",
        entity_id: "bengaluru",
        details: {
          city: "Bengaluru Metropolitan Region",
          emergency_capacity_mw: 45,
          city_status: "STABLE",
          simulation_only: true,
        },
        event_type: "system.normal_operations",
        description:
          "Bengaluru Urban Command Ops operating within normal baseline parameters.",
        metadata: { simulation_only: true },
        created_at: now,
      },
    ];
  }

  getSectors(): SectorRow[] {
    return [...this.sectors];
  }

  getCommandCenterState(): CommandCenterStateRow {
    return { ...this.commandCenterState };
  }

  listIncidents(): IncidentRow[] {
    return [...this.incidents];
  }

  getIncidentImpacts(incidentId?: string): IncidentImpactRow[] {
    if (incidentId) {
      return this.incidentImpacts.filter((i) => i.incident_id === incidentId);
    }
    return [...this.incidentImpacts];
  }

  getEmergencyReports(): EmergencyReportRow[] {
    return [...this.emergencyReports];
  }

  getEmergencyReportEvents(reportId?: string): EmergencyReportEventRow[] {
    if (reportId) {
      return this.emergencyReportEvents.filter((e) => e.report_id === reportId);
    }
    return [...this.emergencyReportEvents];
  }

  getAllocationPlans(): AllocationPlanRow[] {
    return [...this.allocationPlans];
  }

  getAllocationPlanItems(planId?: string): AllocationPlanItemRow[] {
    if (planId) {
      return this.allocationPlanItems.filter(
        (item) => item.allocation_plan_id === planId,
      );
    }
    return [...this.allocationPlanItems];
  }

  getAuditLogs(): AuditLogRow[] {
    return [...this.auditLogs];
  }

  getSimulationScenarios(): CrisisScenario[] {
    return Object.values(CRISIS_SCENARIOS);
  }

  initiateSimulation(scenarioKey = "industrial_fire"): {
    success: boolean;
    incidentId: string;
    incidentCode: string;
    title: string;
    severity: string;
    status: string;
    location: string;
    affectedDomains: string[];
    cityStatus: string;
    activeIncidents: number;
    planId: string;
  } {
    const normalizedKey =
      scenarioKey === "power_infrastructure_failure"
        ? "power_failure"
        : scenarioKey === "hazardous_material"
          ? "hazmat"
          : scenarioKey;
    const scenario: CrisisScenario =
      CRISIS_SCENARIOS[normalizedKey] ?? CRISIS_SCENARIOS.industrial_fire!;
    const now = new Date().toISOString();
    const incidentId = randomUUID();
    const incidentCode = `INC-SIM-${Math.floor(1000 + Math.random() * 9000)}`;

    const incident: IncidentRow = {
      id: incidentId,
      incident_code: incidentCode,
      title: scenario.title,
      description: scenario.description,
      incident_type: scenario.incidentType,
      severity: scenario.severity,
      status: "active",
      location: scenario.location,
      address: scenario.address,
      latitude: 12.9719,
      longitude: 77.6412,
      response_units: scenario.responseUnits,
      is_escalated: true,
      automated_triage: true,
      dispatch_details: scenario.dispatchDetails,
      evacuation_radius_m: scenario.evacuationRadius,
      residents_alerted: scenario.residentsAlerted,
      perimeter_details: scenario.perimeterDetails,
      is_simulation: true,
      scenario_type: scenario.key,
      created_at: now,
      updated_at: now,
    };

    this.incidents.unshift(incident);

    for (const impact of scenario.impacts) {
      this.incidentImpacts.push({
        id: randomUUID(),
        incident_id: incidentId,
        sector_id: impact.sectorId,
        demand_delta_mw: impact.demandDeltaMw,
        impact_score: impact.impactScore,
        impact_level: impact.impactLevel,
        reason: impact.reason,
        rationale: impact.rationale,
        created_at: now,
      });
    }

    this.commandCenterState.city_status = "CRISIS ACTIVE";
    this.commandCenterState.active_crisis = scenario.title;
    this.commandCenterState.active_incident_id = incidentId;
    this.commandCenterState.dispatch_status = "active";
    this.commandCenterState.updated_at = now;

    this.auditLogs.unshift({
      id: randomUUID(),
      actor: "Command Center",
      action: "SIMULATION_INITIATED",
      entity_type: "incident",
      entity_id: incidentId,
      details: {
        incidentId,
        incidentCode,
        scenarioType: scenario.key,
        initiatingUser: "Command Center Operator",
        timestamp: now,
        message: `${scenario.title} crisis simulation initiated from Command Center.`,
      },
      event_type: "SIMULATION_INITIATED",
      description: `${scenario.title} crisis simulation initiated from Command Center.`,
      metadata: {
        simulation_only: true,
        scenario_type: scenario.key,
      },
      created_at: now,
    });

    const currentActivePlan =
      this.allocationPlans.find((p) => p.status === "approved") ??
      this.allocationPlans[0];
    const activeItems = this.allocationPlanItems.filter(
      (i) => i.allocation_plan_id === currentActivePlan?.id,
    );

    const dynInput: DynamicAllocationInput = {
      totalAvailableCapacityMw: this.commandCenterState.emergency_capacity_mw,
      sectors: this.sectors.map((s) => {
        const item = activeItems.find((ai) => ai.sector_id === s.id);
        const currentAlloc = item ? item.allocated_capacity_mw : s.current_allocation_mw;
        return {
          sectorId: s.id,
          sectorName: s.name,
          currentAllocationMw: currentAlloc,
          baselineDemandMw: s.baseline_demand_mw,
          minimumSafeCapacityMw: s.minimum_safe_capacity_mw,
          maximumRequestedCapacityMw: s.maximum_capacity_mw,
          priorityWeight: s.priority_weight,
          operationalFlexibility: s.operational_flexibility,
          lifeCritical: s.life_critical,
          incidentImpacts: scenario.impacts
            .filter((imp) => imp.sectorId === s.id)
            .map((imp) => ({
              incidentId,
              incidentTitle: scenario.title,
              incidentType: scenario.incidentType,
              severity: scenario.severity,
              demandDeltaMw: imp.demandDeltaMw,
            })),
        };
      }),
    };

    const dynResult = calculateDynamicAllocation(dynInput);

    const planId = randomUUID();
    const recommendationPlan: AllocationPlanRow = {
      id: planId,
      incident_id: incidentId,
      title: `Deterministic recommendation for ${incidentCode}`,
      status: "recommended",
      total_capacity_mw: dynResult.totalAllocated,
      total_available_capacity_mw: dynResult.totalAvailableCapacity,
      rationale: {
        city: "Bengaluru Metropolitan Region",
        model_version: "crisisgrid-rules-v2",
        simulation_only: true,
        scenario_type: scenario.key,
        signatures: [
          {
            role: "Gov. Operations Lead",
            signerName: "S. Mukherjee",
            signatureHash: "0x9F4C7A1B8E2D9914F6B2C8E4A01234B2",
            signedAt: now,
          },
        ],
      },
      approved_at: null,
      rejected_at: null,
      created_by: "crisisgrid-rules-v2",
      dispatch_status: "standby",
      signatures: [
        {
          role: "Gov. Operations Lead",
          signer_name: "S. Mukherjee",
          signature_hash: "0x9F4C7A1B8E2D9914F6B2C8E4A01234B2",
          signed_at: now,
        },
      ],
      required_signatures: 2,
      created_at: now,
      updated_at: now,
    };

    for (const p of this.allocationPlans) {
      if (p.status === "recommended" || p.status === "pending_review") {
        p.status = "superseded";
        p.updated_at = now;
      }
    }

    this.allocationPlans.unshift(recommendationPlan);

    for (const sectorRes of dynResult.sectors) {
      this.allocationPlanItems.push({
        id: randomUUID(),
        allocation_plan_id: planId,
        sector_id: sectorRes.sectorId,
        allocated_capacity_mw: sectorRes.recommendedAllocation,
        previous_allocation_mw: sectorRes.previousAllocation,
        recommended_allocation_mw: sectorRes.recommendedAllocation,
        delta_mw: sectorRes.delta,
        rationale: sectorRes.rationale,
        safety_status: sectorRes.safetyMargin >= 0 ? "safe" : "floor_breached",
        created_at: now,
      });
    }

    return {
      success: true,
      incidentId,
      incidentCode,
      title: scenario.title,
      severity: scenario.severity,
      status: "active",
      location: scenario.location,
      affectedDomains: scenario.impacts.map((i) => i.sectorId),
      cityStatus: "CRISIS ACTIVE",
      activeIncidents: this.incidents.filter((i) => i.status === "active").length,
      planId,
    };
  }

  resetDemo(): {
    success: true;
    cityStatus: "STABLE";
    activeIncidents: 0;
    message: string;
  } {
    const now = new Date().toISOString();

    this.incidents = this.incidents.filter(
      (i) => !i.is_simulation && !i.incident_code.startsWith("INC-SIM-"),
    );

    const remainingIncidentIds = new Set(this.incidents.map((i) => i.id));
    this.incidentImpacts = this.incidentImpacts.filter((imp) =>
      remainingIncidentIds.has(imp.incident_id),
    );
    this.emergencyReports = this.emergencyReports.filter((r) =>
      remainingIncidentIds.has(r.incident_id),
    );

    this.allocationPlans = this.allocationPlans.filter(
      (p) => p.status === "approved" && p.incident_id === null,
    );

    const baselinePlanId = "00000000-0000-4000-8000-000000000201";
    if (this.allocationPlans.length === 0) {
      this.allocationPlans.push({
        id: baselinePlanId,
        incident_id: null,
        title: "Bengaluru pre-incident baseline allocation",
        status: "approved",
        total_capacity_mw: 45,
        total_available_capacity_mw: 45,
        rationale: {
          city: "Bengaluru Metropolitan Region",
          model_version: "crisisgrid-rules-v2",
          simulation_only: true,
        },
        approved_at: now,
        rejected_at: null,
        created_by: "system-baseline",
        dispatch_status: "synchronized",
        created_at: now,
        updated_at: now,
      });
    }

    const activePlanId = this.allocationPlans[0]?.id ?? baselinePlanId;
    this.allocationPlanItems = [
      {
        id: randomUUID(),
        allocation_plan_id: activePlanId,
        sector_id: "hospital_network",
        allocated_capacity_mw: 18,
        previous_allocation_mw: 18,
        recommended_allocation_mw: 18,
        delta_mw: 0,
        rationale: "Pre-incident baseline allocation.",
        safety_status: "safe",
        created_at: now,
      },
      {
        id: randomUUID(),
        allocation_plan_id: activePlanId,
        sector_id: "water_infrastructure",
        allocated_capacity_mw: 10,
        previous_allocation_mw: 10,
        recommended_allocation_mw: 10,
        delta_mw: 0,
        rationale: "Pre-incident baseline allocation.",
        safety_status: "safe",
        created_at: now,
      },
      {
        id: randomUUID(),
        allocation_plan_id: activePlanId,
        sector_id: "telecommunications",
        allocated_capacity_mw: 7,
        previous_allocation_mw: 7,
        recommended_allocation_mw: 7,
        delta_mw: 0,
        rationale: "Pre-incident baseline allocation.",
        safety_status: "safe",
        created_at: now,
      },
      {
        id: randomUUID(),
        allocation_plan_id: activePlanId,
        sector_id: "emergency_operations",
        allocated_capacity_mw: 10,
        previous_allocation_mw: 10,
        recommended_allocation_mw: 10,
        delta_mw: 0,
        rationale: "Pre-incident baseline allocation.",
        safety_status: "safe",
        created_at: now,
      },
    ];

    for (const sector of this.sectors) {
      sector.current_allocation_mw = sector.baseline_demand_mw;
      sector.operational_status =
        sector.id === "emergency_operations" ? "READY" : "STABLE";
    }

    this.commandCenterState.city_status = "STABLE";
    this.commandCenterState.active_crisis = "NONE";
    this.commandCenterState.active_incident_id = null;
    this.commandCenterState.dispatch_status = "standby";
    this.commandCenterState.emergency_capacity_mw = 45;
    this.commandCenterState.updated_at = now;

    this.auditLogs.unshift({
      id: randomUUID(),
      actor: "System Operator",
      action: "DEMO_RESET_COMPLETED",
      entity_type: "command_center_state",
      entity_id: "bengaluru",
      details: {
        message: "Demo reset: Normal operations restored, baseline 45 MW active.",
        city_status: "STABLE",
        active_incidents: 0,
        timestamp: now,
      },
      event_type: "DEMO_RESET_COMPLETED",
      description: "Demo reset: Normal operations restored, baseline 45 MW active.",
      metadata: { simulation_only: true },
      created_at: now,
    });

    return {
      success: true,
      cityStatus: "STABLE",
      activeIncidents: 0,
      message: "Demo reset complete. Normal operations restored.",
    };
  }

  submitEmergencyReport(report: CreateEmergencyReport): {
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
  } {
    const now = new Date().toISOString();
    const incidentId = randomUUID();
    const reportId = randomUUID();
    const incidentCode = `INC-${incidentId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
    const latitude =
      report.latitude ??
      (report.locationSource === "geolocation"
        ? null
        : DEMO_FALLBACK_LOCATION.latitude);
    const longitude =
      report.longitude ??
      (report.locationSource === "geolocation"
        ? null
        : DEMO_FALLBACK_LOCATION.longitude);

    const activeImpacts = this.incidentImpacts.filter((impact) =>
      this.incidents.some(
        (inc) => inc.id === impact.incident_id && inc.status === "active",
      ),
    );

    const sectorDemands: SectorDemand[] = this.sectors.map((s) => {
      const activeSectorImpacts = activeImpacts.filter(
        (imp) => imp.sector_id === s.id,
      );
      const totalDelta = activeSectorImpacts.reduce(
        (sum, imp) => sum + imp.demand_delta_mw,
        0,
      );
      return {
        id: s.id,
        name: s.name,
        demandMw: s.baseline_demand_mw + totalDelta,
        minimumSafeCapacityMw: s.minimum_safe_capacity_mw,
        maximumCapacityMw: s.maximum_capacity_mw,
        priorityWeight: s.priority_weight,
      };
    });

    const triage = triageCitizenReport(sectorDemands, {
      category: report.category,
      incidentType: report.incidentType,
      urgency: report.urgency,
      severity: report.severity,
      location: report.location,
    });

    const timeline = confirmationTimeline(triage.allocationRecommended);
    const currentStatus =
      timeline[timeline.length - 1]?.status ?? "dispatch_requested";

    // 1. Create Incident
    const newIncident: IncidentRow = {
      id: incidentId,
      incident_code: incidentCode,
      title: triage.title,
      description: report.description,
      incident_type: triage.incidentType,
      severity: triage.severity,
      status: "active",
      location: report.location,
      address: report.address || report.location,
      latitude,
      longitude,
      response_units: triage.responseUnits,
      is_escalated: triage.isEscalated,
      automated_triage: true,
      dispatch_details: DISPATCH_DISCLAIMER,
      evacuation_radius_m: triage.severity === "critical" ? 300 : 0,
      residents_alerted: triage.severity === "critical" ? 850 : 0,
      perimeter_details:
        triage.severity === "critical"
          ? `300m safety perimeter active around ${report.location}.`
          : "Standard monitoring perimeter active.",
      created_at: now,
      updated_at: now,
    };
    this.incidents.unshift(newIncident);

    // 2. Create Incident Impacts
    for (const impact of triage.impacts) {
      this.incidentImpacts.push({
        id: randomUUID(),
        incident_id: incidentId,
        sector_id: impact.sectorId,
        demand_delta_mw: impact.demandDeltaMw,
        impact_score: impact.impactScore,
        rationale: impact.rationale,
        impact_level:
          impact.demandDeltaMw > 1.5
            ? "critical"
            : impact.demandDeltaMw > 0
              ? "high"
              : "medium",
        reason: impact.rationale,
        created_at: now,
      });
    }

    // 3. Update Crisis State
    this.commandCenterState.city_status = "CRISIS ACTIVE";
    this.commandCenterState.active_crisis = triage.title;
    this.commandCenterState.active_incident_id = incidentId;
    this.commandCenterState.dispatch_status = "active";
    this.commandCenterState.updated_at = now;

    // 4 & 5. Trigger Allocation Engine & Create Pending Recommendation
    let allocationPlanId: string | null = null;
    if (triage.allocationRecommended) {
      allocationPlanId = randomUUID();
      const currentActivePlan =
        this.allocationPlans.find((p) => p.status === "approved") ??
        this.allocationPlans[0];
      const activeItems = this.allocationPlanItems.filter(
        (i) => i.allocation_plan_id === currentActivePlan?.id,
      );

      const dynInput: DynamicAllocationInput = {
        totalAvailableCapacityMw: AVAILABLE_CAPACITY_MW,
        sectors: this.sectors.map((s) => {
          const sImpacts = this.incidentImpacts.filter(
            (imp) => imp.sector_id === s.id,
          );
          return {
            sectorId: s.id,
            sectorName: s.name,
            currentAllocationMw:
              activeItems.find((i) => i.sector_id === s.id)
                ?.allocated_capacity_mw ?? s.current_allocation_mw,
            baselineDemandMw: s.baseline_demand_mw,
            minimumSafeCapacityMw: s.minimum_safe_capacity_mw,
            maximumRequestedCapacityMw: s.maximum_capacity_mw,
            priorityWeight: s.priority_weight,
            operationalFlexibility: s.operational_flexibility,
            lifeCritical: s.life_critical,
            incidentImpacts: sImpacts.map((imp) => ({
              incidentId: imp.incident_id,
              incidentTitle:
                this.incidents.find((inc) => inc.id === imp.incident_id)
                  ?.title ?? "Incident",
              incidentType:
                this.incidents.find((inc) => inc.id === imp.incident_id)
                  ?.incident_type ?? "emergency",
              severity: (this.incidents.find((inc) => inc.id === imp.incident_id)
                ?.severity ?? "urgent") as "critical" | "urgent" | "stable",
              demandDeltaMw: imp.demand_delta_mw,
            })),
          };
        }),
      };

      const dynResult = calculateDynamicAllocation(dynInput);

      // Archive previous recommendations to pending_review
      for (const p of this.allocationPlans) {
        if (p.status === "recommended" || p.status === "pending_review") {
          p.status = "archived";
        }
      }

      this.allocationPlans.unshift({
        id: allocationPlanId,
        incident_id: incidentId,
        title: `Recommended allocation after ${triage.title}`,
        status: "recommended",
        total_capacity_mw: dynResult.totalAllocated,
        total_available_capacity_mw: dynResult.totalAvailableCapacity,
        rationale: {
          incidentId,
          explanation: dynResult.decisionFactors.join(" "),
          warnings: dynResult.warnings,
          status: dynResult.status,
          balance: dynResult.balance,
          signatures: [
            {
              role: "Gov. Operations Lead",
              signerName: "S. Mukherjee",
              signatureHash: `0x${randomUUID().replace(/-/g, "").slice(0, 32).toUpperCase()}`,
              signedAt: now,
            },
          ],
        },
        approved_at: null,
        rejected_at: null,
        created_by: "crisisgrid-simulation",
        dispatch_status: "standby",
        signatures: [
          {
            role: "Gov. Operations Lead",
            signer_name: "S. Mukherjee",
            signature_hash: `0x${randomUUID().replace(/-/g, "").slice(0, 32).toUpperCase()}`,
            signed_at: now,
          },
        ],
        required_signatures: 2,
        created_at: now,
        updated_at: now,
      });

      for (const sectorRes of dynResult.sectors) {
        this.allocationPlanItems.push({
          id: randomUUID(),
          allocation_plan_id: allocationPlanId,
          sector_id: sectorRes.sectorId,
          allocated_capacity_mw: sectorRes.recommendedAllocation,
          previous_allocation_mw: sectorRes.previousAllocation,
          recommended_allocation_mw: sectorRes.recommendedAllocation,
          delta_mw: sectorRes.delta,
          rationale: sectorRes.rationale,
          safety_status: sectorRes.safetyMargin >= 0 ? "safe" : "breached",
          created_at: now,
        });
      }
    }

    // 6. Create Emergency Report
    const newReport: EmergencyReportRow = {
      id: reportId,
      incident_id: incidentId,
      reporter_alias: report.reporterAlias || "Anonymous",
      description: report.description,
      location: report.location,
      severity: triage.severity,
      is_anonymous: report.isAnonymous ?? true,
      category: triage.category,
      urgency: triage.severity,
      latitude,
      longitude,
      address: report.address || report.location,
      language: report.language || "en",
      status: "accepted",
      confirmation_status: currentStatus,
      location_source: report.locationSource || "demo_fallback",
      input_mode: report.inputMode || "text",
      evidence_paths: report.evidencePaths || [],
      location_accuracy_m: null,
      triage_summary: triage.rationale,
      created_at: now,
    };
    this.emergencyReports.unshift(newReport);

    // Timeline Events
    for (const step of timeline) {
      this.emergencyReportEvents.push({
        id: randomUUID(),
        report_id: reportId,
        status: step.status,
        note: step.note,
        created_at: now,
      });
    }

    // Audit Log
    this.auditLogs.unshift({
      id: randomUUID(),
      actor: "citizen-report",
      action: "emergency_report.submitted",
      entity_type: "incident",
      entity_id: incidentId,
      details: {
        report_id: reportId,
        allocation_plan_id: allocationPlanId,
        confirmation_status: currentStatus,
        simulation_only: true,
      },
      event_type: "emergency_report.submitted",
      description:
        "A citizen emergency report created a live incident in the simulation Command Center.",
      metadata: {
        report_id: reportId,
        allocation_plan_id: allocationPlanId,
        simulation_only: true,
      },
      created_at: now,
    });

    return {
      incidentId,
      incidentCode,
      reportId,
      allocationPlanId,
      confirmationStatus: currentStatus,
      confirmationLabel: confirmationLabel(currentStatus),
      timeline,
      affectedSectors: triage.affectedSectors,
      simulationOnly: true,
      dispatchDisclaimer: DISPATCH_DISCLAIMER,
    };
  }

  uploadEmergencyEvidence(upload: EvidenceUpload): {
    stored: boolean;
    path: string | null;
    message: string;
  } {
    const mimeType =
      upload.mimeType === "image/jpg" ? "image/jpeg" : upload.mimeType;
    const extension =
      mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
          ? "webp"
          : "jpg";
    const path = `emergency-evidence/simulated-${randomUUID()}.${extension}`;

    const raw = upload.contentBase64.includes(",")
      ? upload.contentBase64.slice(upload.contentBase64.indexOf(",") + 1)
      : upload.contentBase64;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(raw, "base64");
    } catch {
      throw new Error("The evidence file could not be decoded.");
    }
    if (bytes.length < 32 || bytes.length > 5_000_000) {
      throw new Error("Visual evidence must be an image under 5 MB.");
    }

    return {
      stored: true,
      path,
      message: "Visual evidence stored for the simulation report.",
    };
  }

  getEmergencyReport(reportId: string): {
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
    report: EmergencyReportRow;
    incident: IncidentRow | null;
    events: EmergencyReportEventRow[];
  } {
    const report = this.emergencyReports.find((r) => r.id === reportId);
    if (!report) {
      throw new Error("Emergency report not found.");
    }
    const incident =
      this.incidents.find((i) => i.id === report.incident_id) ?? null;
    const events = this.emergencyReportEvents
      .filter((e) => e.report_id === reportId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    const plan = this.allocationPlans.find(
      (p) => p.incident_id === report.incident_id,
    );
    const confirmationStatus = (
      [
        "report_received",
        "triaged",
        "dispatch_requested",
        "authority_review",
        "response_active",
      ].includes(report.confirmation_status)
        ? report.confirmation_status
        : "report_received"
    ) as ConfirmationStatus;

    const timeline = events.map((event) => ({
      status: event.status as ConfirmationStatus,
      label: confirmationLabel(event.status as ConfirmationStatus),
      note: event.note,
    }));

    const impacts = incident
      ? this.incidentImpacts.filter((imp) => imp.incident_id === incident.id)
      : [];

    return {
      incidentId: report.incident_id,
      incidentCode: incident?.incident_code ?? report.incident_id,
      reportId: report.id,
      allocationPlanId: plan?.id ?? null,
      confirmationStatus,
      confirmationLabel: confirmationLabel(confirmationStatus),
      timeline:
        timeline.length > 0 ? timeline : confirmationTimeline(plan !== undefined),
      affectedSectors: impacts
        .filter((imp) => imp.demand_delta_mw !== 0)
        .map((imp) => ({
          id: imp.sector_id,
          name: imp.sector_id,
        })),
      simulationOnly: true,
      dispatchDisclaimer: DISPATCH_DISCLAIMER,
      report,
      incident,
      events,
    };
  }

  reviewAllocationPlan(
    planId: string,
    review: CreateReview,
  ): {
    plan: AllocationPlanRow;
    items: AllocationPlanItemRow[];
    isApproved: boolean;
  } {
    const now = new Date().toISOString();
    const plan = this.allocationPlans.find((p) => p.id === planId);
    if (!plan) {
      throw new Error("Allocation plan not found.");
    }
    if (plan.status !== "recommended" && plan.status !== "pending_review") {
      throw new Error(
        "This recommendation is no longer awaiting review. Refresh the dashboard and try again.",
      );
    }

    if (review.decision === "reject") {
      plan.status = "rejected";
      plan.rejected_at = now;
      plan.updated_at = now;

      this.auditLogs.unshift({
        id: randomUUID(),
        actor: `${review.reviewer} (${review.signerRole})`,
        action: "allocation_plan.rejected",
        entity_type: "allocation_plan",
        entity_id: planId,
        details: { decision: "rejected", notes: review.notes },
        event_type: "allocation_plan.rejected",
        description: `Allocation plan ${planId} rejected by authority. Baseline maintained.`,
        metadata: { decision: "rejected" },
        created_at: now,
      });

      return {
        plan,
        items: this.allocationPlanItems.filter(
          (i) => i.allocation_plan_id === planId,
        ),
        isApproved: false,
      };
    }

    // Approve / Modify
    plan.status = "approved";
    plan.approved_at = now;
    plan.updated_at = now;
    plan.dispatch_status = "synchronized";

    // Mark previous approved plans as archived
    for (const p of this.allocationPlans) {
      if (p.id !== planId && p.status === "approved") {
        p.status = "archived";
      }
    }

    const items = this.allocationPlanItems.filter(
      (i) => i.allocation_plan_id === planId,
    );

    // Update sector current allocations
    for (const item of items) {
      const sector = this.sectors.find((s) => s.id === item.sector_id);
      if (sector) {
        sector.current_allocation_mw = item.allocated_capacity_mw;
        sector.updated_at = now;
      }
    }

    // Update linked emergency reports to response_active
    if (plan.incident_id) {
      const linkedReports = this.emergencyReports.filter(
        (r) => r.incident_id === plan.incident_id,
      );
      for (const rep of linkedReports) {
        rep.confirmation_status = "response_active";
        rep.status = "accepted";
        this.emergencyReportEvents.push({
          id: randomUUID(),
          report_id: rep.id,
          status: "response_active",
          note: "Authority approved the simulation allocation. Response is active inside CRISISGRID only.",
          created_at: now,
        });
      }
    }

    this.auditLogs.unshift({
      id: randomUUID(),
      actor: `${review.reviewer} (${review.signerRole})`,
      action: "allocation_plan.approved",
      entity_type: "allocation_plan",
      entity_id: planId,
      details: {
        decision: "approved",
        total_capacity_mw: plan.total_capacity_mw,
      },
      event_type: "allocation_plan.approved",
      description: `Allocation plan ${planId} approved by authority. Dynamic reallocation active.`,
      metadata: { decision: "approved" },
      created_at: now,
    });

    return {
      plan,
      items,
      isApproved: true,
    };
  }
}

export const inMemoryCrisisRepository = new InMemoryCrisisRepository();
