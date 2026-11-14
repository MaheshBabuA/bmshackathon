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
  Json,
  ResourceRequestRow,
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

export interface ScenarioTelemetryMetric {
  id: string;
  label: string;
  value: string;
  rawValue?: number | string;
  unit?: string;
  status: "normal" | "elevated" | "critical";
  trend: "up" | "down" | "stable";
  icon?: string;
}

export interface ScenarioDecisionFactor {
  id: string;
  number: string;
  title: string;
  description: string;
  status: string;
  badgeTone: "error" | "primary" | "secondary" | "tertiary";
}

export interface ScenarioResourceRequestTemplate {
  organizationName: string;
  organizationType: string;
  resourceType: string;
  requestedAmount: number;
  unit: string;
  reason: string;
  urgency: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  sectorId: string;
}

export interface CrisisScenario {
  key: string;
  title: string;
  incidentType: string;
  severity: "critical" | "urgent" | "stable";
  location: string;
  address: string;
  affectedArea: string;
  latitude: number;
  longitude: number;
  description: string;
  responseUnits: number;
  dispatchDetails: string;
  evacuationRadius: number;
  residentsAlerted: number;
  perimeterDetails: string;
  gridDemand: string;
  hazardLevelLabel: string;
  mapMarkerIcon: string;
  telemetry: ScenarioTelemetryMetric[];
  subsectorLabels: Record<string, string>;
  decisionFactors: ScenarioDecisionFactor[];
  algorithmicRationale: string;
  resourceRequests?: ScenarioResourceRequestTemplate[];
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
    title: "Large-Scale Industrial Fire",
    incidentType: "fire_hazmat",
    severity: "critical",
    location: "Indiranagar Industrial Zone",
    address: "Indiranagar Industrial Complex, Sector 4",
    affectedArea: "Indiranagar — Sector 4",
    latitude: 12.9784,
    longitude: 77.6408,
    description: "Large-scale industrial fire requiring coordinated emergency response.",
    responseUnits: 14,
    dispatchDetails: "8 Fire Engines · 3 HAZMAT · 3 ALS Units",
    evacuationRadius: 450,
    residentsAlerted: 1420,
    perimeterDetails: "450 m perimeter around Indiranagar Industrial Zone; hazardous-material response active.",
    gridDemand: "Demand Spike: High Water & Emergency Grid",
    hazardLevelLabel: "HAZMAT LEVEL 2",
    mapMarkerIcon: "local_fire_department",
    telemetry: [
      { id: "water_press_drop", label: "Water Press. Drop", value: "-28%", status: "critical", trend: "down", icon: "water_drop" },
      { id: "power_draw", label: "Power Draw", value: "+3.4 MW", status: "elevated", trend: "up", icon: "bolt" },
      { id: "fire_intensity", label: "Core Fire Temp", value: "840° C", status: "critical", trend: "up", icon: "local_fire_department" },
      { id: "containment", label: "Fire Containment", value: "32%", status: "elevated", trend: "up", icon: "shield" },
      { id: "hydrant_flow", label: "Hydrant Flow Rate", value: "4,200 L/min", status: "normal", trend: "stable", icon: "waves" },
      { id: "smoke_plume", label: "Smoke Particulate PM2.5", value: "310 µg/m³", status: "critical", trend: "down", icon: "air" },
    ],
    subsectorLabels: {
      water_infrastructure: "Indiranagar & Domlur Booster Reservoirs",
      telecommunications: "Sector 4 Towers & Base Station Nodes",
      hospital_network: "Manipal & CMH Emergency Corridors",
      emergency_operations: "East Zone Fire Command Post",
    },
    decisionFactors: [
      {
        id: "01",
        number: "01",
        title: "Critical Chemical Surge Trigger",
        description: "Emergency demand increased following confirmed Tier-3 chemical fire incident in Sector 4 (Indiranagar), threatening secondary electrical substation 4B.",
        status: "Critical",
        badgeTone: "error",
      },
      {
        id: "02",
        number: "02",
        title: "Hydraulic Pressure Floor Compliance",
        description: "Water pumping capacity escalated +2.0 MW to sustain 8 high-velocity hydrants and rapid hazmat containment foam delivery over 1.2 sq km.",
        status: "Verified",
        badgeTone: "primary",
      },
      {
        id: "03",
        number: "03",
        title: "Bandwidth Throttling Safety Window",
        description: "Civilian telecommunications load lowered -2.0 MW; remains safely +0.5 MW above municipal critical broadcast floor (4.5 MW floor maintained).",
        status: "Safe",
        badgeTone: "tertiary",
      },
      {
        id: "04",
        number: "04",
        title: "Life-Support & Trauma ICU Shielding",
        description: "Hospital critical surgical suites, ventilators, and emergency trauma bays remain 100% shielded; load adjustment strictly isolated to secondary non-critical HVAC.",
        status: "Protected",
        badgeTone: "tertiary",
      },
    ],
    algorithmicRationale: "Dynamic triage proposal generated by CRISISGRID allocation engine based on active crisis load factor and statutory municipal safety floors.",
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
    resourceRequests: [
      {
        organizationName: "BMS Hospital",
        organizationType: "Hospital",
        resourceType: "Emergency Electricity",
        requestedAmount: 3,
        unit: "MW",
        reason: "ICU and emergency operations have increased capacity requirements.",
        urgency: "CRITICAL",
        sectorId: "hospital_network",
      },
      {
        organizationName: "Water Infrastructure",
        organizationType: "Water Utility",
        resourceType: "Pumping Capacity",
        requestedAmount: 2,
        unit: "MW",
        reason: "High emergency water demand for containment pumping and high-pressure foam lines.",
        urgency: "HIGH",
        sectorId: "water_infrastructure",
      },
      {
        organizationName: "Emergency Operations",
        organizationType: "Emergency Response",
        resourceType: "Operational Capacity",
        requestedAmount: 1,
        unit: "MW",
        reason: "Command post, hazmat cordon lighting, and tactical rescue unit deployment.",
        urgency: "HIGH",
        sectorId: "emergency_operations",
      },
    ],
  },
  urban_flood: {
    key: "urban_flood",
    title: "Severe Urban Flooding",
    incidentType: "flood",
    severity: "critical",
    location: "Bellandur & Koramangala Drainage Basin",
    address: "Bellandur Outer Ring Road Corridor",
    affectedArea: "Bellandur & Koramangala Basin",
    latitude: 12.9345,
    longitude: 77.6778,
    description: "Major flooding affecting infrastructure, transport and emergency access.",
    responseUnits: 18,
    dispatchDetails: "10 Rescue Boats · 4 High-Capacity Pumps · 4 NDRF Teams",
    evacuationRadius: 600,
    residentsAlerted: 2800,
    perimeterDetails: "Flood diversion active along Outer Ring Road.",
    gridDemand: "Demand Spike: Auxiliary Pumping & Field Logistics",
    hazardLevelLabel: "FLOOD LEVEL RED",
    mapMarkerIcon: "water_damage",
    telemetry: [
      { id: "water_level", label: "Flood Basin Level", value: "+3.2 m", status: "critical", trend: "up", icon: "water" },
      { id: "drainage_overload", label: "Drainage Overload", value: "185%", status: "critical", trend: "up", icon: "warning" },
      { id: "pumping_draw", label: "Pumping Grid Draw", value: "+4.1 MW", status: "elevated", trend: "up", icon: "bolt" },
      { id: "conduit_flow", label: "Stormwater Conduit Flow", value: "12,500 L/s", status: "critical", trend: "stable", icon: "waves" },
      { id: "substation_bund", label: "Substation Bund Status", value: "Breach Alert", status: "critical", trend: "down", icon: "foundation" },
      { id: "evac_progress", label: "Amphibious Evacuation", value: "64% Evacuated", status: "normal", trend: "up", icon: "sailing" },
    ],
    subsectorLabels: {
      water_infrastructure: "Koramangala Valley Stormwater Lift Pumps",
      telecommunications: "Bellandur ORR Fiber & Wireless Relays",
      hospital_network: "Sakra World Hospital Trauma Access Road",
      emergency_operations: "NDRF Amphibious Staging Ground",
    },
    decisionFactors: [
      {
        id: "01",
        number: "01",
        title: "Severe Stormwater Inundation Trigger",
        description: "Emergency demand escalated after Bellandur Lake outflow breached drainage bunds, threatening 110kV line pylons and arterial ring roads.",
        status: "Critical",
        badgeTone: "error",
      },
      {
        id: "02",
        number: "02",
        title: "High-Volume Dewatering Surge",
        description: "+3.0 MW allocated for 4 high-capacity submersible pumps and mobile dewatering trailers to prevent substation yard submersion.",
        status: "Verified",
        badgeTone: "primary",
      },
      {
        id: "03",
        number: "03",
        title: "Fiber Routing & Emergency Comm Throttling",
        description: "-3.0 MW non-critical telecom load curtailed while retaining priority emergency VHF radio and cellular broadcast beacon channels.",
        status: "Safe",
        badgeTone: "tertiary",
      },
      {
        id: "04",
        number: "04",
        title: "Hospital Access & Backup Grid Isolation",
        description: "Sakra and St. John's hospital emergency corridors protected with auxiliary feed lines; non-emergency clinical facility demand adjusted -2.0 MW.",
        status: "Protected",
        badgeTone: "tertiary",
      },
    ],
    algorithmicRationale: "Hydro-dynamic allocation proposal generated to prevent secondary substation inundation while guaranteeing hospital access corridors.",
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
    resourceRequests: [
      {
        organizationName: "Water Pumping Infrastructure",
        organizationType: "Water Utility",
        resourceType: "Pumping Capacity",
        requestedAmount: 3,
        unit: "MW",
        reason: "Critical stormwater drainage and high-capacity submersible dewatering pumps active.",
        urgency: "CRITICAL",
        sectorId: "water_infrastructure",
      },
      {
        organizationName: "BMS Hospital",
        organizationType: "Hospital",
        resourceType: "Emergency Backup Capacity",
        requestedAmount: 2,
        unit: "MW",
        reason: "Basement power transfer to emergency backup generators and patient ward isolation.",
        urgency: "HIGH",
        sectorId: "hospital_network",
      },
      {
        organizationName: "Telecommunications",
        organizationType: "Telecommunications",
        resourceType: "Emergency Communications Support",
        requestedAmount: 1,
        unit: "MW",
        reason: "Cellular repeater and emergency civic broadcast beacons support.",
        urgency: "MEDIUM",
        sectorId: "telecommunications",
      },
    ],
  },
  power_failure: {
    key: "power_failure",
    title: "Critical Substation Failure",
    incidentType: "infrastructure",
    severity: "urgent",
    location: "Peenya Substation 220kV Grid",
    address: "Peenya Industrial Area Stage 1",
    affectedArea: "Peenya Industrial Substation — Stage 1 & 2",
    latitude: 13.0285,
    longitude: 77.5195,
    description: "Critical substation failure reducing available infrastructure capacity.",
    responseUnits: 10,
    dispatchDetails: "6 Mobile Transformers · 4 Technical Repair Crews",
    evacuationRadius: 200,
    residentsAlerted: 600,
    perimeterDetails: "Electrical containment perimeter around Peenya Substation.",
    gridDemand: "Grid Deficit: Mobile Transformers & ICU Bypass",
    hazardLevelLabel: "GRID ALERT STAGE-3",
    mapMarkerIcon: "electrical_services",
    telemetry: [
      { id: "grid_voltage", label: "Grid Bus Voltage", value: "182 kV (-17%)", status: "critical", trend: "down", icon: "electrical_services" },
      { id: "freq_deviation", label: "Grid Frequency", value: "48.9 Hz", status: "elevated", trend: "down", icon: "speed" },
      { id: "reserve_dispatch", label: "Emergency Reserve Feed", value: "+5.0 MW", status: "elevated", trend: "up", icon: "bolt" },
      { id: "transformer_temp", label: "Transformer Core Temp", value: "98° C", status: "elevated", trend: "up", icon: "thermostat" },
      { id: "breaker_status", label: "Breakers Tripped", value: "3 of 8 Feeder Bays", status: "critical", trend: "stable", icon: "toggle_off" },
      { id: "gen_capacity", label: "Mobile Genset Output", value: "8.5 MW Active", status: "normal", trend: "up", icon: "power" },
    ],
    subsectorLabels: {
      water_infrastructure: "Peenya Industrial Water Reservoirs",
      telecommunications: "Northwest Cellular & Fiber Switch Hub",
      hospital_network: "ESI Hospital & Trauma Center Feeder Lines",
      emergency_operations: "KPTCL Rapid Response Mobile Base",
    },
    decisionFactors: [
      {
        id: "01",
        number: "01",
        title: "220kV Substation Bus Failure Trigger",
        description: "Immediate dynamic reallocation initiated following catastrophic insulation breakdown and breaker lockouts at Peenya 220kV Substation.",
        status: "Critical",
        badgeTone: "error",
      },
      {
        id: "02",
        number: "02",
        title: "Emergency Generation & Grid Stabilization",
        description: "+2.0 MW reserved for black-start diesel generators, transformer coolant circulating pumps, and technical repair trailers.",
        status: "Verified",
        badgeTone: "primary",
      },
      {
        id: "03",
        number: "03",
        title: "Industrial Pumping Load Relief",
        description: "-1.0 MW non-essential industrial water pumping deferred to off-peak nocturnal cycle while keeping gravity-fed reservoirs full.",
        status: "Safe",
        badgeTone: "tertiary",
      },
      {
        id: "04",
        number: "04",
        title: "Hospital ICU Secondary Feeder Guarantee",
        description: "+1.0 MW delivered directly to hospital network to energize redundant backup circuits for ESI Hospital intensive care wards.",
        status: "Protected",
        badgeTone: "tertiary",
      },
    ],
    algorithmicRationale: "Grid fault stabilization plan: isolated failed 220kV bus, diverted emergency reserve to hospital trauma feeder circuits.",
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
    resourceRequests: [
      {
        organizationName: "BMS Hospital",
        organizationType: "Hospital",
        resourceType: "Emergency Backup Capacity",
        requestedAmount: 4,
        unit: "MW",
        reason: "Total grid blackout; ICU, life support, and emergency trauma bays running on microgrid.",
        urgency: "CRITICAL",
        sectorId: "hospital_network",
      },
      {
        organizationName: "Telecommunications",
        organizationType: "Telecommunications",
        resourceType: "Network Continuity Support",
        requestedAmount: 2,
        unit: "MW",
        reason: "Substation drop; tower cell sites and emergency routing hubs operating on battery backup.",
        urgency: "HIGH",
        sectorId: "telecommunications",
      },
      {
        organizationName: "Metro Water Utilities",
        organizationType: "Water Utility",
        resourceType: "Auxiliary Pumping Power",
        requestedAmount: 1,
        unit: "MW",
        reason: "Water treatment aeration pumps and gravity feed valves operating on auxiliary generators.",
        urgency: "MEDIUM",
        sectorId: "water_infrastructure",
      },
    ],
  },
  hazmat: {
    key: "hazmat",
    title: "Hazardous Material Incident",
    incidentType: "hazmat",
    severity: "critical",
    location: "Whitefield Chemical Corridor, Bengaluru",
    address: "Whitefield Export Promotion Industrial Park, Bengaluru",
    affectedArea: "Whitefield Chemical Processing Sector",
    latitude: 12.9815,
    longitude: 77.7289,
    description: "Hazardous material incident requiring chemical containment and evacuation.",
    responseUnits: 16,
    dispatchDetails: "8 HAZMAT Containment Units · 4 Decon Teams · 4 ALS Ambulances",
    evacuationRadius: 500,
    residentsAlerted: 1950,
    perimeterDetails: "Chemical plume containment perimeter established.",
    gridDemand: "Demand Spike: HAZMAT Washdown & Alert Beacon",
    hazardLevelLabel: "TOXIC HAZARD LEVEL 4",
    mapMarkerIcon: "science",
    telemetry: [
      { id: "toxic_vapor", label: "Toxic Vapor Concentration", value: "420 ppm (VOC)", status: "critical", trend: "up", icon: "science" },
      { id: "plume_vector", label: "Plume Dispersion Vector", value: "0.8 km SSW", status: "elevated", trend: "stable", icon: "air" },
      { id: "decon_washdown", label: "Decontamination Flow", value: "2,800 L/min", status: "elevated", trend: "up", icon: "cleaning_services" },
      { id: "cordon_status", label: "Hot Zone Cordon", value: "500 m Secured", status: "normal", trend: "stable", icon: "health_and_safety" },
      { id: "air_toxicity", label: "Ambient Hazard Index", value: "Index 8 / 10", status: "critical", trend: "down", icon: "masks" },
      { id: "decon_readiness", label: "Chemical Neutralizer Bed", value: "92% Charged", status: "normal", trend: "stable", icon: "shield" },
    ],
    subsectorLabels: {
      water_infrastructure: "EPIP Chemical Washdown & Mist Curtains",
      telecommunications: "Whitefield Cordon Emergency Mesh Network",
      hospital_network: "Vydehi & Manipal Whitefield Toxicological Units",
      emergency_operations: "State HAZMAT Incident Command Center",
    },
    decisionFactors: [
      {
        id: "01",
        number: "01",
        title: "Toxic Chemical Vapor Release Trigger",
        description: "Automated sensor alarms tripped after industrial solvent breach in EPIP Phase 2; atmospheric VOC levels exceeded 400 ppm threshold.",
        status: "Critical",
        badgeTone: "error",
      },
      {
        id: "02",
        number: "02",
        title: "Mist Curtain Hydraulic Pressure Escalation",
        description: "+1.0 MW assigned to high-pressure neutralization water mist nozzles to suppress airborne chemical plume migration.",
        status: "Verified",
        badgeTone: "primary",
      },
      {
        id: "03",
        number: "03",
        title: "Evacuation Broadcast Priority",
        description: "-2.0 MW reallocated from commercial cell nodes while dedicating full bandwidth to geo-fenced civilian evacuation alerts.",
        status: "Safe",
        badgeTone: "tertiary",
      },
      {
        id: "04",
        number: "04",
        title: "Dedicated Toxicology & Trauma Readiness",
        description: "-1.0 MW non-critical administrative hospital load dialed back to focus clean power on hyperbaric and decontamination air scrubbers.",
        status: "Protected",
        badgeTone: "tertiary",
      },
    ],
    algorithmicRationale: "Chemical containment optimization: energized decontamination water curtain, prioritized broadcast beacons for downwind civilian evacuation.",
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
    resourceRequests: [
      {
        organizationName: "Containment Operations",
        organizationType: "Emergency Response",
        resourceType: "Scrubbers & Ventilation",
        requestedAmount: 3,
        unit: "MW",
        reason: "Industrial perimeter decontamination and high-volume toxic vapor scrubbers.",
        urgency: "CRITICAL",
        sectorId: "emergency_operations",
      },
      {
        organizationName: "BMS Hospital",
        organizationType: "Hospital",
        resourceType: "Toxicology & Trauma Surge",
        requestedAmount: 2,
        unit: "MW",
        reason: "Surge in chemical exposure patients and isolation ward ventilation systems.",
        urgency: "HIGH",
        sectorId: "hospital_network",
      },
      {
        organizationName: "Emergency Operations",
        organizationType: "Emergency Response",
        resourceType: "Hazardous Perimeter Monitoring",
        requestedAmount: 1,
        unit: "MW",
        reason: "Perimeter sensor grid, night illumination, and mobile decontamination showers.",
        urgency: "HIGH",
        sectorId: "emergency_operations",
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
  private telemetryByIncident: Map<string, ScenarioTelemetryMetric[]> = new Map();
  private resourceRequests: ResourceRequestRow[] = [];
  private publicBroadcast: {
    headline?: string;
    message?: string;
    safetyInstructions?: string[];
    broadcastApproved: boolean;
    publishedAt?: string;
    publishedBy?: string;
  } | null = null;

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
    this.resourceRequests = [];

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
    address?: string;
    affectedArea?: string;
    latitude?: number;
    longitude?: number;
    affectedDomains: string[];
    cityStatus: string;
    activeIncidents: number;
    planId: string;
    telemetry?: ScenarioTelemetryMetric[];
    decisionFactors?: ScenarioDecisionFactor[];
    subsectorLabels?: Record<string, string>;
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
      affected_area: scenario.affectedArea,
      latitude: scenario.latitude,
      longitude: scenario.longitude,
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

    // Close any previous active simulation incidents so only one scenario is active
    for (const prev of this.incidents) {
      if (prev.status === "active") {
        prev.status = "resolved";
        prev.updated_at = now;
      }
    }

    this.incidents.unshift(incident);
    this.telemetryByIncident.set(incidentId, scenario.telemetry);

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

    this.resourceRequests = [];
    if (scenario.resourceRequests && scenario.resourceRequests.length > 0) {
      for (const req of scenario.resourceRequests) {
        this.resourceRequests.push({
          id: randomUUID(),
          incident_id: incidentId,
          organization_name: req.organizationName,
          organization_type: req.organizationType,
          resource_type: req.resourceType,
          requested_amount: req.requestedAmount,
          unit: req.unit,
          reason: req.reason,
          urgency: req.urgency,
          status: "PENDING",
          created_at: now,
        });
      }
    }

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
        scenario_title: scenario.title,
        affected_area: scenario.affectedArea,
        decision_factors: scenario.decisionFactors,
        subsector_labels: scenario.subsectorLabels,
        algorithmic_rationale: scenario.algorithmicRationale,
        signatures: [
          {
            role: "Gov. Operations Lead",
            signerName: "S. Mukherjee",
            signatureHash: "0x9F4C7A1B8E2D9914F6B2C8E4A01234B2",
            signedAt: now,
          },
        ],
      } as unknown as Json,
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

    this.publicBroadcast = {
      headline: scenario.title.toUpperCase(),
      message: scenario.description,
      safetyInstructions: this.getScenarioSafetyInstructions(scenario.key),
      publishedAt: now,
      publishedBy: "Karnataka State Emergency Operations Center",
      broadcastApproved: true,
    };

    return {
      success: true,
      incidentId,
      incidentCode,
      title: scenario.title,
      severity: scenario.severity,
      status: "active",
      location: scenario.location,
      address: scenario.address,
      affectedArea: scenario.affectedArea,
      latitude: scenario.latitude,
      longitude: scenario.longitude,
      affectedDomains: scenario.impacts.map((i) => i.sectorId),
      cityStatus: "CRISIS ACTIVE",
      activeIncidents: this.incidents.filter((i) => i.status === "active").length,
      planId,
      telemetry: scenario.telemetry,
      decisionFactors: scenario.decisionFactors,
      subsectorLabels: scenario.subsectorLabels,
    };
  }

  resetDemo(): {
    success: true;
    cityStatus: "STABLE";
    activeIncidents: 0;
    message: string;
  } {
    const now = new Date().toISOString();
    this.telemetryByIncident.clear();

    this.incidents = this.incidents.filter(
      (i) => !i.is_simulation && !i.incident_code.startsWith("INC-SIM-"),
    );

    for (const inc of this.incidents) {
      if (inc.status === "active") {
        inc.status = "resolved";
        inc.updated_at = now;
      }
    }

    const remainingIncidentIds = new Set(this.incidents.map((i) => i.id));
    this.incidentImpacts = this.incidentImpacts.filter((imp) =>
      remainingIncidentIds.has(imp.incident_id),
    );
    this.emergencyReports = this.emergencyReports.filter((r) =>
      remainingIncidentIds.has(r.incident_id),
    );
    this.resourceRequests = [];

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

    this.publicBroadcast = null;

    return {
      success: true,
      cityStatus: "STABLE",
      activeIncidents: 0,
      message: "Demo reset complete. Normal operations restored.",
    };
  }

  getScenarioSafetyInstructions(scenarioKey: string): string[] {
    const key = scenarioKey.toLowerCase();
    if (key.includes("flood")) {
      return [
        "Avoid low-lying corridors, drainage basins, and road underpasses along Bellandur Outer Ring Road.",
        "Do not enter moving floodwater on foot or in vehicles; open conduits and submerged electrical lines present extreme hazard.",
        "Follow municipal civil defense alerts to designated high-ground emergency shelters.",
        "Boil all drinking water and immediately disconnect electrical mains in waterlogged basements.",
      ];
    }
    if (key.includes("power") || key.includes("substation")) {
      return [
        "Major power outage active across Peenya Industrial Substation 220kV cluster.",
        "Hospitals and emergency trauma centers are operating on prioritized islanded emergency circuits.",
        "Exercise extreme caution at non-signaled traffic intersections and arterial corridors.",
        "Individuals with home life-support medical devices requiring emergency power should dial 112 immediately.",
      ];
    }
    if (key.includes("hazmat") || key.includes("chemical")) {
      return [
        "Hazardous chemical containment active in Whitefield Chemical Processing Sector.",
        "Shelter in place indoors immediately; seal windows, doors, and exterior vents with wet cloths.",
        "Do not consume unsealed water or open food exposed within the 800m containment perimeter.",
        "Proceed to designated municipal decontamination units if experiencing eye stinging or skin irritation.",
      ];
    }
    return [
      "Avoid Indiranagar 100ft Road and surrounding Sector 4 industrial zones.",
      "Close all windows and shut off air-conditioning/HVAC to prevent toxic smoke inhalation.",
      "Yield right of way immediately to fire rescue tenders, aerial ladders, and water supply tankers.",
      "For respiratory distress, burn treatment, or emergency medical aid, report to BMS Hospital Emergency Ward.",
    ];
  }

  getPublicAlerts(): {
    activeEmergency: boolean;
    alertStatus: string;
    cityStatus: string;
    headline: string;
    incidentCode?: string;
    severity: string;
    location: string;
    address?: string;
    affectedArea: string;
    evacuationRadiusM: number;
    residentsAlerted?: number;
    message?: string;
    safetyInstructions: string[];
    emergencyContacts: { name: string; number: string; description: string }[];
    publishedAt: string;
    publishedBy: string;
    broadcastApproved: boolean;
  } {
    const activeIncident = this.incidents.find((i) => i.status === "active");
    const activeScenarioKey =
      ((activeIncident as any)?.scenario_type as string) || "industrial_fire";
    const scenario: CrisisScenario =
      (activeScenarioKey && CRISIS_SCENARIOS[activeScenarioKey])
        ? CRISIS_SCENARIOS[activeScenarioKey]!
        : CRISIS_SCENARIOS.industrial_fire!;

    const contacts = [
      { name: "Unified Emergency Services", number: "112", description: "Police, Fire, Medical 24x7" },
      { name: "Fire & Rescue Control", number: "101", description: "Municipal Fire Control Room" },
      { name: "Ambulance & Trauma Dispatch", number: "108", description: "Emergency Medical & Trauma" },
      { name: "BBMP Disaster Management", number: "080-22221188", description: "Civic Flooding & Tree Fall Helpline" },
      { name: "State Disaster Authority (SEOC)", number: "1070", description: "Karnataka State Operations" },
    ];

    if (!activeIncident || this.commandCenterState.city_status === "STABLE") {
      return {
        activeEmergency: false,
        alertStatus: "NOMINAL",
        cityStatus: "STABLE",
        headline: "NO ACTIVE EMERGENCY",
        severity: "NORMAL",
        location: "Bengaluru Metropolitan Region",
        affectedArea: "None (Nominal citywide operations)",
        evacuationRadiusM: 0,
        residentsAlerted: 0,
        message:
          "All municipal infrastructure, power grids, water supply, and public transit corridors in Bengaluru are operating within normal baseline parameters. No emergency directives or evacuations are active.",
        safetyInstructions: [
          "All municipal civic infrastructure is operating within normal baseline parameters.",
          "Report localized safety hazards, downed power cables, or pipe breaches to municipal dispatch at 112.",
          "Monitor official CRISISGRID civic channels for real-time weather and infrastructure advisories.",
        ],
        emergencyContacts: contacts,
        publishedAt: this.commandCenterState.updated_at || new Date().toISOString(),
        publishedBy: "Karnataka State Emergency Operations Center",
        broadcastApproved: true,
      };
    }

    return {
      activeEmergency: true,
      alertStatus: "OFFICIAL_BROADCAST",
      cityStatus: "CRISIS ACTIVE",
      headline: this.publicBroadcast?.headline || scenario.title.toUpperCase(),
      incidentCode: activeIncident.incident_code,
      severity: activeIncident.severity.toUpperCase(),
      location: scenario.address || scenario.location,
      address: scenario.address,
      affectedArea: scenario.affectedArea,
      evacuationRadiusM: scenario.evacuationRadius,
      residentsAlerted: scenario.residentsAlerted,
      message: this.publicBroadcast?.message || scenario.description,
      safetyInstructions:
        this.publicBroadcast?.safetyInstructions ||
        this.getScenarioSafetyInstructions(scenario.key),
      emergencyContacts: contacts,
      publishedAt: this.publicBroadcast?.publishedAt || activeIncident.created_at,
      publishedBy:
        this.publicBroadcast?.publishedBy ||
        "Karnataka State Emergency Operations Center",
      broadcastApproved: this.publicBroadcast?.broadcastApproved ?? true,
    };
  }

  publishCivicBroadcast(input: {
    headline?: string;
    message?: string;
    safetyInstructions?: string[];
    publishedBy?: string;
  }): {
    success: boolean;
    broadcast: {
      headline: string;
      message: string;
      safetyInstructions: string[];
      publishedAt: string;
      publishedBy: string;
      broadcastApproved: boolean;
    };
  } {
    const activeIncident = this.incidents.find((i) => i.status === "active");
    const activeScenarioKey =
      ((activeIncident as any)?.scenario_type as string) || "industrial_fire";
    const scenario: CrisisScenario =
      (activeScenarioKey && CRISIS_SCENARIOS[activeScenarioKey])
        ? CRISIS_SCENARIOS[activeScenarioKey]!
        : CRISIS_SCENARIOS.industrial_fire!;
    const now = new Date().toISOString();

    const broadcast = {
      headline: input.headline || scenario.title.toUpperCase(),
      message: input.message || scenario.description,
      safetyInstructions:
        input.safetyInstructions && input.safetyInstructions.length > 0
          ? input.safetyInstructions
          : this.getScenarioSafetyInstructions(scenario.key),
      publishedAt: now,
      publishedBy:
        input.publishedBy || "Karnataka State Emergency Operations Center",
      broadcastApproved: true,
    };

    this.publicBroadcast = broadcast;

    this.auditLogs.unshift({
      id: randomUUID(),
      actor: input.publishedBy || "State EOC Controller",
      action: "CIVIC_BROADCAST_PUBLISHED",
      entity_type: "public_broadcast",
      entity_id: activeIncident?.id || "public_portal",
      details: {
        headline: broadcast.headline,
        incident_code: activeIncident?.incident_code,
        published_at: now,
      },
      event_type: "CIVIC_BROADCAST_PUBLISHED",
      description: `Official public alert broadcast published: ${broadcast.headline}`,
      metadata: { simulation_only: true },
      created_at: now,
    });

    return {
      success: true,
      broadcast,
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

  isSimulationActive(): boolean {
    return (
      this.commandCenterState?.city_status === "CRISIS ACTIVE" ||
      this.incidents.some(
        (i) =>
          i.status === "active" &&
          (i.is_simulation || i.incident_code.startsWith("INC-SIM-")),
      )
    );
  }

  getActiveIncident(): IncidentRow | null {
    if (this.commandCenterState?.active_incident_id) {
      const match = this.incidents.find(
        (i) => i.id === this.commandCenterState.active_incident_id,
      );
      if (match) return match;
    }
    return this.incidents.find((i) => i.status === "active") ?? null;
  }

  getTelemetryForIncident(incidentId: string): ScenarioTelemetryMetric[] {
    const custom = this.telemetryByIncident.get(incidentId);
    if (custom && custom.length > 0) return custom;
    const incident = this.incidents.find((i) => i.id === incidentId);
    if (incident?.scenario_type && CRISIS_SCENARIOS[incident.scenario_type]) {
      return CRISIS_SCENARIOS[incident.scenario_type]!.telemetry;
    }
    return CRISIS_SCENARIOS.industrial_fire!.telemetry;
  }

  getActiveTelemetry(): ScenarioTelemetryMetric[] {
    const active = this.getActiveIncident();
    if (active) {
      return this.getTelemetryForIncident(active.id);
    }
    return [];
  }

  hasIncident(incidentId: string): boolean {
    return this.incidents.some((i) => i.id === incidentId);
  }

  hasAllocationPlan(planId: string): boolean {
    return this.allocationPlans.some((p) => p.id === planId);
  }

  getScenario(scenarioKey: string): CrisisScenario | null {
    const normalizedKey =
      scenarioKey === "power_infrastructure_failure"
        ? "power_failure"
        : scenarioKey === "hazardous_material"
          ? "hazmat"
          : scenarioKey;
    return CRISIS_SCENARIOS[normalizedKey] ?? null;
  }

  listResourceRequests(incidentId?: string): ResourceRequestRow[] {
    if (incidentId) {
      return this.resourceRequests.filter((r) => r.incident_id === incidentId);
    }
    const active = this.getActiveIncident();
    if (active) {
      const activeRequests = this.resourceRequests.filter(
        (r) => r.incident_id === active.id,
      );
      if (activeRequests.length > 0) return activeRequests;
    }
    return [...this.resourceRequests];
  }

  getResourceRequest(id: string): ResourceRequestRow | undefined {
    return this.resourceRequests.find((r) => r.id === id);
  }

  getResourceRequestRecommendation(id: string): {
    requestId: string;
    recommendation: "APPROVE" | "MODIFY" | "REJECT";
    recommendedAmount: number;
    reason: string;
    availableCapacity: string;
    requestedCapacity: string;
    priorityLevel: string;
  } {
    const request = this.getResourceRequest(id);
    if (!request) {
      throw new Error(`Resource request ${id} not found.`);
    }

    return {
      requestId: request.id,
      recommendation: "APPROVE",
      recommendedAmount: request.requested_amount,
      reason:
        "Available emergency capacity can support the request while maintaining critical safety thresholds for other infrastructure.",
      availableCapacity: "45.0 MW Total Pool",
      requestedCapacity: `+${request.requested_amount} ${request.unit}`,
      priorityLevel: request.urgency,
    };
  }

  reviewResourceRequest(
    id: string,
    decision: "APPROVE" | "MODIFY" | "REJECT",
    allocatedAmount?: number | undefined,
    notes?: string | undefined,
    reviewerRole?: string | undefined,
  ): {
    success: boolean;
    request: ResourceRequestRow;
    message: string;
    updatedAllocations?: Record<string, number> | undefined;
  } {
    const request = this.resourceRequests.find((r) => r.id === id);
    if (!request) {
      throw new Error(`Resource request ${id} not found.`);
    }

    const now = new Date().toISOString();
    const finalDecision = decision;
    const finalAmount =
      finalDecision === "REJECT"
        ? 0
        : typeof allocatedAmount === "number" && allocatedAmount > 0
          ? allocatedAmount
          : request.requested_amount;

    request.status =
      finalDecision === "APPROVE"
        ? "APPROVED"
        : finalDecision === "MODIFY"
          ? "MODIFIED"
          : "REJECTED";
    request.review_decision = finalDecision;
    request.allocated_amount = finalAmount;
    request.reviewed_by = reviewerRole || "Authority EOC Lead";
    request.reviewed_at = now;
    request.review_notes = notes || "";

    // If approved or modified, execute the allocation in the engine
    let updatedAllocations: Record<string, number> | undefined;
    if (finalDecision === "APPROVE" || finalDecision === "MODIFY") {
      const orgLower = request.organization_name.toLowerCase();
      const resLower = request.resource_type.toLowerCase();
      const sectorId =
        orgLower.includes("hospital")
          ? "hospital_network"
          : orgLower.includes("water") || resLower.includes("pumping")
            ? "water_infrastructure"
            : orgLower.includes("telecom") || resLower.includes("communication")
              ? "telecommunications"
              : "emergency_operations";

      const sector = this.sectors.find((s) => s.id === sectorId);
      if (sector) {
        sector.current_allocation_mw = Math.min(
          sector.maximum_capacity_mw,
          sector.current_allocation_mw + finalAmount,
        );
      }

      const approvedPlan =
        this.allocationPlans.find((p) => p.status === "approved") ??
        this.allocationPlans[0];
      if (approvedPlan) {
        const item = this.allocationPlanItems.find(
          (i) => i.allocation_plan_id === approvedPlan.id && i.sector_id === sectorId,
        );
        if (item && sector) {
          item.previous_allocation_mw = item.allocated_capacity_mw;
          item.allocated_capacity_mw = sector.current_allocation_mw;
          item.recommended_allocation_mw = sector.current_allocation_mw;
          item.delta_mw = item.allocated_capacity_mw - item.previous_allocation_mw;
          item.rationale = `Allocated +${finalAmount} ${request.unit} following Authority approval of request from ${request.organization_name}.`;
        }
      }

      this.commandCenterState.updated_at = now;
      updatedAllocations = Object.fromEntries(
        this.sectors.map((s) => [s.id, s.current_allocation_mw]),
      );
    }

    this.auditLogs.unshift({
      id: randomUUID(),
      actor: request.reviewed_by,
      action: "RESOURCE_REQUEST_DECISION",
      entity_type: "resource_request",
      entity_id: request.id,
      details: {
        requestId: request.id,
        organizationName: request.organization_name,
        organizationType: request.organization_type,
        resourceType: request.resource_type,
        originalRequestedAmount: request.requested_amount,
        finalAllocatedAmount: request.allocated_amount,
        decision: finalDecision,
        notes: request.review_notes,
        timestamp: now,
      },
      event_type: `RESOURCE_REQUEST_${request.status}`,
      description: `${finalDecision === "REJECT" ? "Rejected" : `Approved +${request.allocated_amount} ${request.unit} for`} ${request.organization_name} (${request.resource_type}).`,
      metadata: {
        simulation_only: true,
        incident_id: request.incident_id,
      },
      created_at: now,
    });

    return {
      success: true,
      request,
      message: `${request.organization_name} request has been ${request.status.toLowerCase()}.`,
      updatedAllocations,
    };
  }
}

export const inMemoryCrisisRepository = new InMemoryCrisisRepository();
