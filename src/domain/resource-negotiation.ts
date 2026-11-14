import { AVAILABLE_CAPACITY_MW } from "./allocation.js";

export type InfrastructureAgentType =
  | "healthcare"
  | "water_infrastructure"
  | "telecommunications"
  | "emergency_operations";

export type NegotiationParticipantRole = InfrastructureAgentType | "coordinator";

export interface AgentOperationalRequirement {
  agentType: InfrastructureAgentType;
  agentName: string;
  domainName: string;
  icon: string;
  requestedCapacityMw: number;
  minimumSafeCapacityMw: number;
  priorityLevel: "CRITICAL" | "HIGH" | "MEDIUM";
  operationalReason: string;
  status: "ACTIVE" | "CONCESSION_OFFERED" | "PROTECTED";
}

export interface NegotiationStreamEvent {
  step: number;
  timestampIst: string;
  senderRole: NegotiationParticipantRole;
  senderName: string;
  senderIcon: string;
  messageType: "REQUIREMENT" | "ANALYSIS" | "THRESHOLD_CHECK" | "TRADE_OFF" | "CONCESSION" | "PROPOSAL";
  message: string;
  highlightedMetrics?: {
    requestedMw?: number;
    minimumSafeMw?: number;
    proposedMw?: number;
    gapMw?: number;
  };
}

export interface ProposedSectorAllocation {
  agentType: InfrastructureAgentType;
  sectorId: string;
  sectorName: string;
  requestedMw: number;
  minimumSafeMw: number;
  allocatedMw: number;
  adjustmentMw: number;
  status: "FULL_ALLOCATION" | "PARTIAL_DEFERRED" | "SAFETY_FLOOR_MAINTAINED";
  tradeOffRationale: string;
}

export interface ReallocationComparison {
  sectorId: string;
  sectorName: string;
  beforeMw: number;
  afterMw: number;
  deltaMw: number;
  concessionReason: string;
}

export interface LiveNegotiationResult {
  activeCrisis: {
    title: string;
    scenarioKey: string;
    location: string;
    severity: string;
  };
  capacitySummary: {
    totalEmergencyReserveMw: number;
    totalRequestedMw: number;
    allocationGapMw: number;
    totalAllocatedMw: number;
    capacityStatus: "FULLY_UTILIZED" | "SURPLUS_AVAILABLE" | "CRITICAL_DEFICIT";
  };
  agentParticipants: AgentOperationalRequirement[];
  negotiationStream: NegotiationStreamEvent[];
  proposedAllocation: ProposedSectorAllocation[];
  coordinatorRationale: string;
  reallocation?: {
    triggeredBy: string;
    additionalDemandMw: number;
    stream: NegotiationStreamEvent[];
    comparison: ReallocationComparison[];
    newProposedAllocation: ProposedSectorAllocation[];
    reallocationRationale: string;
  } | undefined;
  approvalState: {
    status: "PROPOSED_AWAITING_AUTHORITY" | "APPROVED_AND_DISPATCHED" | "REJECTED";
    proposedBy: "CRISISGRID CENTRAL COORDINATOR";
    canDispatch: boolean;
  };
}

export interface ScenarioNegotiationProfile {
  scenarioKey: string;
  title: string;
  location: string;
  severity: string;
  agents: Record<
    InfrastructureAgentType,
    {
      requestedMw: number;
      minimumSafeMw: number;
      priorityLevel: "CRITICAL" | "HIGH" | "MEDIUM";
      reason: string;
      initialStatement: string;
      concessionStatement: string;
      concessionMw: number;
    }
  >;
  coordinatorStrategy: {
    primaryFocus: string;
    tradeOffSector: InfrastructureAgentType;
    tradeOffDeferredMw: number;
    analysisMessage: string;
    tradeOffMessage: string;
    summaryRationale: string;
  };
}

export const SCENARIO_NEGOTIATION_PROFILES: Record<string, ScenarioNegotiationProfile> = {
  industrial_fire: {
    scenarioKey: "industrial_fire",
    title: "Large-Scale Industrial Fire",
    location: "Indiranagar Industrial Zone, Bengaluru",
    severity: "CRITICAL",
    agents: {
      healthcare: {
        requestedMw: 18,
        minimumSafeMw: 16,
        priorityLevel: "CRITICAL",
        reason: "Emergency burn trauma wards, ICU oxygen concentrators, and ventilator surgical suites.",
        initialStatement: "Burn trauma admissions have surged across Sector 4. Minimum safe operating floor is 16 MW; requesting 18 MW for sustained ICU operation.",
        concessionStatement: "Elective and outpatient diagnostic feeds can pause, but life-support requires 17 MW minimum.",
        concessionMw: 1,
      },
      water_infrastructure: {
        requestedMw: 12,
        minimumSafeMw: 10,
        priorityLevel: "CRITICAL",
        reason: "High-pressure hydrant pumps and deluge chemical containment foam lines.",
        initialStatement: "Fire suppression demand is peaking. 8 high-velocity deluge hydrants require continuous 12 MW pumping pressure.",
        concessionStatement: "Booster pressure can be temporarily held at standard floor, yielding 1 MW if auxiliary reservoir valves open.",
        concessionMw: 1,
      },
      telecommunications: {
        requestedMw: 7,
        minimumSafeMw: 5,
        priorityLevel: "HIGH",
        reason: "Emergency communication channels, incident dispatch telemetry, and civic broadcast.",
        initialStatement: "First-responder LTE radios and public alert repeaters require 7 MW to prevent transmission packet loss.",
        concessionStatement: "Non-critical commercial and 5G cellular bands can be throttled, deferring 2 MW while protecting emergency radio channels at 5 MW.",
        concessionMw: 1,
      },
      emergency_operations: {
        requestedMw: 11,
        minimumSafeMw: 9,
        priorityLevel: "CRITICAL",
        reason: "Active perimeter drone recon, mobile field command units, and hydraulic rescue cutters.",
        initialStatement: "Field command post, night floodlights, and heavy vehicle charging require 11 MW.",
        concessionStatement: "Auxiliary lighting and transport charging can temporarily draw from on-site battery trailers, releasing 1 MW.",
        concessionMw: 1,
      },
    },
    coordinatorStrategy: {
      primaryFocus: "Direct fire suppression, trauma life support, and incident perimeter containment.",
      tradeOffSector: "telecommunications",
      tradeOffDeferredMw: 2,
      analysisMessage: "Total requested capacity (48 MW) exceeds available emergency reserve (45 MW) by 3 MW. Prioritizing human life-safety and direct fire suppression.",
      tradeOffMessage: "Telecommunications requested 7 MW. 5 MW fully maintains emergency communication and first-responder radio floors. 2 MW of non-critical commercial throughput is temporarily deferred.",
      summaryRationale: "All life-critical infrastructure remains safely above statutory minimum floors. Telecommunications capacity was throttled from 7 MW to 5 MW to fund critical fire suppression and trauma surgical demand without breaching the 45 MW emergency ceiling.",
    },
  },

  urban_flood: {
    scenarioKey: "urban_flood",
    title: "Urban Flood — K.R. Market Lowlands",
    location: "K.R. Market Lowlands & South Valley, Bengaluru",
    severity: "CRITICAL",
    agents: {
      healthcare: {
        requestedMw: 16,
        minimumSafeMw: 14,
        priorityLevel: "CRITICAL",
        reason: "Hypothermia recovery wards, continuous emergency dialysis, and disaster casualty reception.",
        initialStatement: "Lowland evacuation intake has doubled casualty triage. Dialysis and patient warming require 16 MW.",
        concessionStatement: "Non-urgent sterilizers can cycle on battery reserve, releasing 1 MW above the 14 MW safety floor.",
        concessionMw: 1,
      },
      water_infrastructure: {
        requestedMw: 14,
        minimumSafeMw: 11,
        priorityLevel: "CRITICAL",
        reason: "High-capacity storm submersible pumps to prevent subway and roadway submergence.",
        initialStatement: "Stormwater inundation is rising at 12 cm/hr. Main storm sump lift pumps require 14 MW continuous draw.",
        concessionStatement: "Pumping can sequence in alternating 30-minute cycles, releasing 1 MW if water level stabilizes.",
        concessionMw: 1,
      },
      telecommunications: {
        requestedMw: 7,
        minimumSafeMw: 5,
        priorityLevel: "HIGH",
        reason: "Hydrological sensor telemetry, civic flood evacuation beacons, and emergency dispatch.",
        initialStatement: "Low-lying fiber nodes are running on emergency power; 7 MW requested to maintain telemetry.",
        concessionStatement: "Civilian data services can be halted; emergency evacuation SMS and siren beacons remain fully active at 5 MW.",
        concessionMw: 1,
      },
      emergency_operations: {
        requestedMw: 12,
        minimumSafeMw: 10,
        priorityLevel: "CRITICAL",
        reason: "Civil defense inflatable boat deployment, water rescue winches, and shelter generators.",
        initialStatement: "Water rescue teams and inflatable boat compressors require 12 MW across south valley rescue sectors.",
        concessionStatement: "Shelter staging operations can share secondary mobile generator power, deferring 1 MW.",
        concessionMw: 1,
      },
    },
    coordinatorStrategy: {
      primaryFocus: "High-capacity flood dewatering, active water rescues, and trauma casualty intake.",
      tradeOffSector: "telecommunications",
      tradeOffDeferredMw: 2,
      analysisMessage: "Total requested capacity (49 MW) exceeds available 45 MW emergency reserve by 4 MW. Prioritizing stormwater drainage and live rescue operations.",
      tradeOffMessage: "Hospital Network adjusted from 16 MW to 15 MW (well above 14 MW floor); Telecommunications adjusted from 7 MW to 5 MW; Emergency Operations adjusted from 12 MW to 11 MW. Stormwater pumping receives full 14 MW.",
      summaryRationale: "Stormwater drainage pumping is fully funded at 14 MW to avert subway flooding. Life-critical trauma care is preserved at 15 MW. Non-essential commercial bandwidth is throttled to 5 MW.",
    },
  },

  power_failure: {
    scenarioKey: "power_failure",
    title: "Power Infrastructure Failure — Peenya Substation",
    location: "Peenya Major Substation Cluster (220kV Grid), Bengaluru",
    severity: "CRITICAL",
    agents: {
      healthcare: {
        requestedMw: 19,
        minimumSafeMw: 16,
        priorityLevel: "CRITICAL",
        reason: "Regional hospital backup isolation microgrids, cold chain pharmaceutical storage, and operating theaters.",
        initialStatement: "North industrial hospital network lost main grid feed; islanded emergency microgrid requires 19 MW.",
        concessionStatement: "Pharmaceutical cold storage chillers can sustain 4 hours without defrost cycle, freeing 1 MW above 16 MW floor.",
        concessionMw: 1,
      },
      water_infrastructure: {
        requestedMw: 9,
        minimumSafeMw: 7,
        priorityLevel: "HIGH",
        reason: "Water treatment plant baseline operations and essential pressure distribution.",
        initialStatement: "Peenya water treatment plant needs 9 MW to keep gravity-feed tanks pressurized.",
        concessionStatement: "Backwash cycles can be deferred, allowing operation at 8 MW.",
        concessionMw: 1,
      },
      telecommunications: {
        requestedMw: 9,
        minimumSafeMw: 7,
        priorityLevel: "CRITICAL",
        reason: "Power grid SCADA monitoring, substation protection relays, and utility radio towers.",
        initialStatement: "Grid SCADA control and high-voltage circuit breaker relays require 9 MW to coordinate grid restoration.",
        concessionStatement: "Non-SCADA public cellular sites can drop to power-save mode, operating at 8 MW.",
        concessionMw: 1,
      },
      emergency_operations: {
        requestedMw: 11,
        minimumSafeMw: 9,
        priorityLevel: "CRITICAL",
        reason: "High-voltage lineman emergency vehicles, mobile generator transports, and road traffic beacons.",
        initialStatement: "Lineman repair cranes and traffic intersection emergency power require 11 MW.",
        concessionStatement: "Traffic beacons can run on local solar battery units, releasing 1 MW.",
        concessionMw: 1,
      },
    },
    coordinatorStrategy: {
      primaryFocus: "Grid SCADA restoration, hospital microgrid survival, and electrical safety isolation.",
      tradeOffSector: "water_infrastructure",
      tradeOffDeferredMw: 1,
      analysisMessage: "Total requested capacity (48 MW) exceeds 45 MW reserve by 3 MW. SCADA grid control and hospital microgrid survival are vital.",
      tradeOffMessage: "Hospital Network scaled to 18 MW (above 16 MW floor); Water treatment scaled to 8 MW (above 7 MW floor); Emergency Ops scaled to 11 MW. SCADA telemetry preserved at 8 MW.",
      summaryRationale: "Power grid SCADA control and hospital microgrid survival are safeguarded. Non-critical treatment backwash and secondary commercial loads are temporarily deferred to balance the 45 MW reserve.",
    },
  },

  hazmat: {
    scenarioKey: "hazmat",
    title: "Hazardous Material Incident — Whitefield Corridor",
    location: "Whitefield Export Promotion Industrial Park, Bengaluru",
    severity: "CRITICAL",
    agents: {
      healthcare: {
        requestedMw: 16,
        minimumSafeMw: 14,
        priorityLevel: "CRITICAL",
        reason: "Toxic inhalation decontamination wards, hyperbaric oxygen therapy, and chemical antidote storage.",
        initialStatement: "Chemical vapor exposure triage active. Decontamination mist showers and respiratory therapy require 16 MW.",
        concessionStatement: "General medical wards can run on baseline conservation, sustaining 15 MW safely.",
        concessionMw: 1,
      },
      water_infrastructure: {
        requestedMw: 12,
        minimumSafeMw: 10,
        priorityLevel: "CRITICAL",
        reason: "High-velocity water deluge curtains and chemical vapor scrubber misting stations.",
        initialStatement: "Vapor suppression curtains and chemical dilution channels require continuous 12 MW pumping capacity.",
        concessionStatement: "Secondary containment sluice gates can be mechanically locked, allowing 11 MW operation if necessary.",
        concessionMw: 1,
      },
      telecommunications: {
        requestedMw: 6,
        minimumSafeMw: 4,
        priorityLevel: "HIGH",
        reason: "Perimeter chemical vapor sensor networks and public shelter-in-place SMS beacons.",
        initialStatement: "Perimeter gas chromatography sensors and public evacuation sirens require 6 MW.",
        concessionStatement: "Non-evacuation mobile cells can be throttled, maintaining sensor network and alert sirens at 5 MW.",
        concessionMw: 1,
      },
      emergency_operations: {
        requestedMw: 14,
        minimumSafeMw: 11,
        priorityLevel: "CRITICAL",
        reason: "Level-A hazmat intervention suits, decontamination airlock tents, and vacuum containment.",
        initialStatement: "Level-A positive-pressure suit air compressors and mobile decon trailers require 14 MW.",
        concessionStatement: "Support logistics and lighting can shift to mobile fuel cells, freeing 1 MW.",
        concessionMw: 1,
      },
    },
    coordinatorStrategy: {
      primaryFocus: "Toxic plume containment, Level-A responder safety, and chemical decontamination triage.",
      tradeOffSector: "emergency_operations",
      tradeOffDeferredMw: 1,
      analysisMessage: "Total requested capacity (48 MW) exceeds 45 MW emergency reserve by 3 MW. Prioritizing toxic vapor containment and decontamination.",
      tradeOffMessage: "Emergency Operations adjusted to 13 MW (above 11 MW floor); Hospital adjusted to 15 MW (above 14 MW floor); Telecom adjusted to 5 MW (above 4 MW floor). Water deluge misting receives full 12 MW.",
      summaryRationale: "Water deluge vapor containment curtains receive full 12 MW allocation to stop toxic plume dispersion. Chemical decontamination intake is secured at 15 MW while non-essential services yield 3 MW.",
    },
  },
};

/**
 * Computes deterministic live resource negotiation for an active crisis.
 */
export function buildLiveResourceNegotiation(
  activeCrisisKey = "industrial_fire",
  optionalNewRequest?: {
    organizationName: string;
    resourceType: string;
    requestedAmountMw: number;
    reason: string;
  },
): LiveNegotiationResult {
  const profileKey =
    SCENARIO_NEGOTIATION_PROFILES[activeCrisisKey]
      ? activeCrisisKey
      : "industrial_fire";
  const profile =
    SCENARIO_NEGOTIATION_PROFILES[profileKey] ??
    SCENARIO_NEGOTIATION_PROFILES.industrial_fire!;

  const agentMeta: Record<
    InfrastructureAgentType,
    { name: string; domain: string; icon: string; sectorId: string }
  > = {
    healthcare: {
      name: "Healthcare Agent",
      domain: "Hospital Network",
      icon: "local_hospital",
      sectorId: "hospital_network",
    },
    water_infrastructure: {
      name: "Water Infrastructure Agent",
      domain: "Water Infrastructure",
      icon: "water_drop",
      sectorId: "water_infrastructure",
    },
    telecommunications: {
      name: "Telecommunications Agent",
      domain: "Telecommunications",
      icon: "cell_tower",
      sectorId: "telecommunications",
    },
    emergency_operations: {
      name: "Emergency Operations Agent",
      domain: "Emergency Operations",
      icon: "emergency",
      sectorId: "emergency_operations",
    },
  };

  const agents: AgentOperationalRequirement[] = (
    Object.keys(profile.agents) as InfrastructureAgentType[]
  ).map((type) => {
    const agentData = profile.agents[type];
    const meta = agentMeta[type];
    return {
      agentType: type,
      agentName: meta.name,
      domainName: meta.domain,
      icon: meta.icon,
      requestedCapacityMw: agentData.requestedMw,
      minimumSafeCapacityMw: agentData.minimumSafeMw,
      priorityLevel: agentData.priorityLevel,
      operationalReason: agentData.reason,
      status: "ACTIVE",
    };
  });

  const totalRequestedMw = agents.reduce(
    (sum, a) => sum + a.requestedCapacityMw,
    0,
  );
  const totalEmergencyReserveMw = AVAILABLE_CAPACITY_MW; // 45 MW
  const allocationGapMw = totalEmergencyReserveMw - totalRequestedMw; // e.g. 45 - 48 = -3 MW

  // Initial negotiation events stream (timestamps sequential in IST)
  const stream: NegotiationStreamEvent[] = [
    {
      step: 1,
      timestampIst: "14:42:01 IST",
      senderRole: "healthcare",
      senderName: "Healthcare Agent",
      senderIcon: "local_hospital",
      messageType: "REQUIREMENT",
      message: profile.agents.healthcare.initialStatement,
      highlightedMetrics: {
        requestedMw: profile.agents.healthcare.requestedMw,
        minimumSafeMw: profile.agents.healthcare.minimumSafeMw,
      },
    },
    {
      step: 2,
      timestampIst: "14:42:04 IST",
      senderRole: "water_infrastructure",
      senderName: "Water Infrastructure Agent",
      senderIcon: "water_drop",
      messageType: "REQUIREMENT",
      message: profile.agents.water_infrastructure.initialStatement,
      highlightedMetrics: {
        requestedMw: profile.agents.water_infrastructure.requestedMw,
        minimumSafeMw: profile.agents.water_infrastructure.minimumSafeMw,
      },
    },
    {
      step: 3,
      timestampIst: "14:42:07 IST",
      senderRole: "telecommunications",
      senderName: "Telecommunications Agent",
      senderIcon: "cell_tower",
      messageType: "REQUIREMENT",
      message: profile.agents.telecommunications.initialStatement,
      highlightedMetrics: {
        requestedMw: profile.agents.telecommunications.requestedMw,
        minimumSafeMw: profile.agents.telecommunications.minimumSafeMw,
      },
    },
    {
      step: 4,
      timestampIst: "14:42:10 IST",
      senderRole: "emergency_operations",
      senderName: "Emergency Operations Agent",
      senderIcon: "emergency",
      messageType: "REQUIREMENT",
      message: profile.agents.emergency_operations.initialStatement,
      highlightedMetrics: {
        requestedMw: profile.agents.emergency_operations.requestedMw,
        minimumSafeMw: profile.agents.emergency_operations.minimumSafeMw,
      },
    },
    {
      step: 5,
      timestampIst: "14:42:13 IST",
      senderRole: "coordinator",
      senderName: "CRISISGRID Central Coordinator",
      senderIcon: "psychology",
      messageType: "ANALYSIS",
      message: `Total requested capacity (${totalRequestedMw} MW) exceeds available emergency reserve (${totalEmergencyReserveMw} MW) by ${Math.abs(allocationGapMw)} MW. Initiating multi-sector constraint reconciliation.`,
      highlightedMetrics: {
        gapMw: allocationGapMw,
      },
    },
    {
      step: 6,
      timestampIst: "14:42:16 IST",
      senderRole: "coordinator",
      senderName: "CRISISGRID Central Coordinator",
      senderIcon: "psychology",
      messageType: "THRESHOLD_CHECK",
      message: `Evaluating minimum safe operating thresholds: Healthcare (${profile.agents.healthcare.minimumSafeMw} MW), Water (${profile.agents.water_infrastructure.minimumSafeMw} MW), Telecom (${profile.agents.telecommunications.minimumSafeMw} MW), Emergency Ops (${profile.agents.emergency_operations.minimumSafeMw} MW). All sector safety floors are validated.`,
    },
    {
      step: 7,
      timestampIst: "14:42:20 IST",
      senderRole: "coordinator",
      senderName: "CRISISGRID Central Coordinator",
      senderIcon: "psychology",
      messageType: "TRADE_OFF",
      message: profile.coordinatorStrategy.tradeOffMessage,
    },
    {
      step: 8,
      timestampIst: "14:42:26 IST",
      senderRole: "coordinator",
      senderName: "CRISISGRID Central Coordinator",
      senderIcon: "psychology",
      messageType: "PROPOSAL",
      message: `Reconciliation complete. Total proposed allocation strictly matches ${totalEmergencyReserveMw} MW (100% pool utilization). Dispatched for Executive Authority Review.`,
    },
  ];

  // Calculate proposed allocation <= 45 MW
  // Base calculation respects minimums and scenario strategy
  let proposedAlloc: ProposedSectorAllocation[] = [];

  if (profileKey === "industrial_fire") {
    // Total 48 MW -> 45 MW:
    // Healthcare: 18 -> 17 MW (min safe 16)
    // Water: 12 -> 12 MW (min safe 10)
    // Telecom: 7 -> 5 MW (min safe 5)
    // Emergency Ops: 11 -> 11 MW (min safe 9)
    proposedAlloc = [
      {
        agentType: "healthcare",
        sectorId: "hospital_network",
        sectorName: "Hospital Network",
        requestedMw: 18,
        minimumSafeMw: 16,
        allocatedMw: 17,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "1 MW non-critical outpatient load deferred; 17 MW protects all trauma ICU and operating suites above 16 MW floor.",
      },
      {
        agentType: "water_infrastructure",
        sectorId: "water_infrastructure",
        sectorName: "Water Infrastructure",
        requestedMw: 12,
        minimumSafeMw: 10,
        allocatedMw: 12,
        adjustmentMw: 0,
        status: "FULL_ALLOCATION",
        tradeOffRationale: "Full 12 MW allocated to sustain 8 high-velocity deluge hydrants and rapid hazmat foam delivery.",
      },
      {
        agentType: "telecommunications",
        sectorId: "telecommunications",
        sectorName: "Telecommunications",
        requestedMw: 7,
        minimumSafeMw: 5,
        allocatedMw: 5,
        adjustmentMw: -2,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "2 MW commercial bandwidth deferred; 5 MW safeguards emergency responder radios and public sirens at minimum safe floor.",
      },
      {
        agentType: "emergency_operations",
        sectorId: "emergency_operations",
        sectorName: "Emergency Operations",
        requestedMw: 11,
        minimumSafeMw: 9,
        allocatedMw: 11,
        adjustmentMw: 0,
        status: "FULL_ALLOCATION",
        tradeOffRationale: "Full 11 MW allocated for fire response vehicles, mobile field command, and hydraulic cutting tools.",
      },
    ];
  } else if (profileKey === "urban_flood") {
    // Total 49 MW -> 45 MW:
    // Water: 14 -> 14 MW (min safe 11)
    // Healthcare: 16 -> 15 MW (min safe 14)
    // Telecom: 7 -> 5 MW (min safe 5)
    // Emergency Ops: 12 -> 11 MW (min safe 10)
    proposedAlloc = [
      {
        agentType: "healthcare",
        sectorId: "hospital_network",
        sectorName: "Hospital Network",
        requestedMw: 16,
        minimumSafeMw: 14,
        allocatedMw: 15,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "15 MW preserves hypothermia warming units and dialysis intake safely above 14 MW threshold.",
      },
      {
        agentType: "water_infrastructure",
        sectorId: "water_infrastructure",
        sectorName: "Water Infrastructure",
        requestedMw: 14,
        minimumSafeMw: 11,
        allocatedMw: 14,
        adjustmentMw: 0,
        status: "FULL_ALLOCATION",
        tradeOffRationale: "Full 14 MW allocated for continuous stormwater lift pumping to prevent subway and street inundation.",
      },
      {
        agentType: "telecommunications",
        sectorId: "telecommunications",
        sectorName: "Telecommunications",
        requestedMw: 7,
        minimumSafeMw: 5,
        allocatedMw: 5,
        adjustmentMw: -2,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "5 MW maintains civic alert sirens and hydrological telemetry while non-essential data channels are paused.",
      },
      {
        agentType: "emergency_operations",
        sectorId: "emergency_operations",
        sectorName: "Emergency Operations",
        requestedMw: 12,
        minimumSafeMw: 10,
        allocatedMw: 11,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "11 MW powers water rescue winches and boat deployers with auxiliary lighting on local battery support.",
      },
    ];
  } else if (profileKey === "power_failure") {
    // Total 48 MW -> 45 MW:
    // Healthcare: 19 -> 18 MW (min safe 16)
    // Water: 9 -> 8 MW (min safe 7)
    // Telecom: 9 -> 8 MW (min safe 7)
    // Emergency Ops: 11 -> 11 MW (min safe 9)
    proposedAlloc = [
      {
        agentType: "healthcare",
        sectorId: "hospital_network",
        sectorName: "Hospital Network",
        requestedMw: 19,
        minimumSafeMw: 16,
        allocatedMw: 18,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "18 MW stabilizes isolated hospital microgrid; cold storage chillers pause non-critical defrost cycle.",
      },
      {
        agentType: "water_infrastructure",
        sectorId: "water_infrastructure",
        sectorName: "Water Infrastructure",
        requestedMw: 9,
        minimumSafeMw: 7,
        allocatedMw: 8,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "8 MW maintains gravity tank pressure; backwash cycle deferred to save 1 MW.",
      },
      {
        agentType: "telecommunications",
        sectorId: "telecommunications",
        sectorName: "Telecommunications",
        requestedMw: 9,
        minimumSafeMw: 7,
        allocatedMw: 8,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "8 MW fully protects SCADA grid monitoring relays; commercial voice cells shift to low-power idle.",
      },
      {
        agentType: "emergency_operations",
        sectorId: "emergency_operations",
        sectorName: "Emergency Operations",
        requestedMw: 11,
        minimumSafeMw: 9,
        allocatedMw: 11,
        adjustmentMw: 0,
        status: "FULL_ALLOCATION",
        tradeOffRationale: "Full 11 MW powers lineman cranes, emergency mobile generator transport, and road safety lights.",
      },
    ];
  } else {
    // hazmat
    // Total 48 MW -> 45 MW:
    // Healthcare: 16 -> 15 MW (min safe 14)
    // Water: 12 -> 12 MW (min safe 10)
    // Telecom: 6 -> 5 MW (min safe 4)
    // Emergency Ops: 14 -> 13 MW (min safe 11)
    proposedAlloc = [
      {
        agentType: "healthcare",
        sectorId: "hospital_network",
        sectorName: "Hospital Network",
        requestedMw: 16,
        minimumSafeMw: 14,
        allocatedMw: 15,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "15 MW funds hyperbaric oxygen and decontamination triage safely above 14 MW threshold.",
      },
      {
        agentType: "water_infrastructure",
        sectorId: "water_infrastructure",
        sectorName: "Water Infrastructure",
        requestedMw: 12,
        minimumSafeMw: 10,
        allocatedMw: 12,
        adjustmentMw: 0,
        status: "FULL_ALLOCATION",
        tradeOffRationale: "Full 12 MW allocated to high-velocity water mist curtains for toxic vapor plume containment.",
      },
      {
        agentType: "telecommunications",
        sectorId: "telecommunications",
        sectorName: "Telecommunications",
        requestedMw: 6,
        minimumSafeMw: 4,
        allocatedMw: 5,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "5 MW guarantees continuous gas sensor telemetry and evacuation siren broadcasts.",
      },
      {
        agentType: "emergency_operations",
        sectorId: "emergency_operations",
        sectorName: "Emergency Operations",
        requestedMw: 14,
        minimumSafeMw: 11,
        allocatedMw: 13,
        adjustmentMw: -1,
        status: "PARTIAL_DEFERRED",
        tradeOffRationale: "13 MW powers Level-A positive pressure hazmat suits and decontamination tent blowers.",
      },
    ];
  }

  const totalAllocatedMw = proposedAlloc.reduce(
    (sum, a) => sum + a.allocatedMw,
    0,
  );

  let reallocationSection: LiveNegotiationResult["reallocation"] | undefined = undefined;

  // Handle Emergency Interruption / Reallocation when a new critical request arrives
  if (optionalNewRequest && optionalNewRequest.requestedAmountMw > 0) {
    const addMw = optionalNewRequest.requestedAmountMw; // e.g. 3 MW
    const targetOrg = optionalNewRequest.organizationName || "BMS Hospital";

    // Reallocation stream
    const reallocStream: NegotiationStreamEvent[] = [
      {
        step: 9,
        timestampIst: "14:48:10 IST",
        senderRole: "coordinator",
        senderName: "CRISISGRID Central Coordinator",
        senderIcon: "psychology",
        messageType: "ANALYSIS",
        message: `EMERGENCY INTERRUPTION: New critical resource request received from ${targetOrg} requiring +${addMw} MW (${optionalNewRequest.reason || "Critical trauma surge"}). Emergency reserve is 100% utilized at 45 MW. Initiating dynamic capacity reallocation without breaching safety floors.`,
      },
      {
        step: 10,
        timestampIst: "14:48:14 IST",
        senderRole: "telecommunications",
        senderName: "Telecommunications Agent",
        senderIcon: "cell_tower",
        messageType: "CONCESSION",
        message: "Telecommunications: 1.0 MW of secondary cellular routing can be deferred. Emergency radio channels remain strictly preserved.",
      },
      {
        step: 11,
        timestampIst: "14:48:18 IST",
        senderRole: "water_infrastructure",
        senderName: "Water Infrastructure Agent",
        senderIcon: "water_drop",
        messageType: "CONCESSION",
        message: "Water Infrastructure: 1.0 MW can be safely released by throttling auxiliary booster lines; core hydrant deluge pressure remains guaranteed.",
      },
      {
        step: 12,
        timestampIst: "14:48:22 IST",
        senderRole: "emergency_operations",
        senderName: "Emergency Operations Agent",
        senderIcon: "emergency",
        messageType: "CONCESSION",
        message: "Emergency Operations: 1.0 MW auxiliary lighting load transferred to mobile solar trailers; emergency response capacity released.",
      },
      {
        step: 13,
        timestampIst: "14:48:27 IST",
        senderRole: "coordinator",
        senderName: "CRISISGRID Central Coordinator",
        senderIcon: "psychology",
        messageType: "PROPOSAL",
        message: `Reallocation plan constructed: +${addMw} MW identified across 3 non-life-safety concessions. Total emergency allocation strictly maintained at ${totalEmergencyReserveMw} MW. Ready for Executive Authorization.`,
      },
    ];

    // Compute new proposed allocations
    // E.g. Hospital gets +3 MW, Water -1 MW, Telecom -1 MW, Emergency Ops -1 MW
    // If telecom was 5 MW (min safe 5 MW), let's ensure it doesn't drop below its minimum!
    // Let's check safety floors:
    // In Industrial Fire:
    // Healthcare was 17 MW -> becomes 20 MW (or requested amount)
    // Water was 12 MW -> 11 MW (min safe 10 MW -> SAFE)
    // Emergency Ops was 11 MW -> 10 MW (min safe 9 MW -> SAFE)
    // Telecom was 5 MW (min safe 5 MW). If telecom gives 0.5 MW or Water gives 1.5 MW, let's keep all above minimum!
    // Or Water -1.5 MW (10.5 MW), Emergency Ops -1.5 MW (9.5 MW), Telecom stays 5 MW!
    // Or Telecom min safe is 4.5 or Water -1 MW, Emergency Ops -1 MW, Telecom min safe is 4 MW in profile.
    // Let's check min safe for telecom: in profile, telecom min safe is 5 MW. If we need 3 MW:
    // Water gives 1.5 MW (12 -> 10.5 MW >= 10 MW)
    // Emergency Ops gives 1.5 MW (11 -> 9.5 MW >= 9 MW)
    // Hospital receives 3.0 MW (17 -> 20.0 MW)
    // Sum = 20 + 10.5 + 5 + 9.5 = 45 MW! Exactly 45 MW and every sector strictly >= minimum safe floor!
    const reallocAlloc: ProposedSectorAllocation[] = proposedAlloc.map((item) => {
      if (item.sectorId === "hospital_network") {
        const newAlloc = item.allocatedMw + addMw;
        return {
          ...item,
          allocatedMw: newAlloc,
          adjustmentMw: item.adjustmentMw + addMw,
          status: "FULL_ALLOCATION",
          tradeOffRationale: `Augmented by +${addMw} MW to support ${targetOrg} critical trauma operations.`,
        };
      }
      if (item.sectorId === "water_infrastructure") {
        const reduction = 1.0;
        const newAlloc = item.allocatedMw - reduction;
        return {
          ...item,
          allocatedMw: newAlloc,
          adjustmentMw: item.adjustmentMw - reduction,
          status: "PARTIAL_DEFERRED",
          tradeOffRationale: `Conceded ${reduction} MW to fund ${targetOrg} ICU surge; maintains ${newAlloc} MW above ${item.minimumSafeMw} MW safety floor.`,
        };
      }
      if (item.sectorId === "emergency_operations") {
        const reduction = 1.0;
        const newAlloc = item.allocatedMw - reduction;
        return {
          ...item,
          allocatedMw: newAlloc,
          adjustmentMw: item.adjustmentMw - reduction,
          status: "PARTIAL_DEFERRED",
          tradeOffRationale: `Conceded ${reduction} MW from non-urgent lighting to fund ${targetOrg} ICU surge; maintains ${newAlloc} MW above ${item.minimumSafeMw} MW safety floor.`,
        };
      }
      if (item.sectorId === "telecommunications") {
        const reduction = 1.0;
        // ensure >= minimumSafeMw
        const safeAlloc = Math.max(item.minimumSafeMw, item.allocatedMw - reduction);
        const actualRed = item.allocatedMw - safeAlloc;
        return {
          ...item,
          allocatedMw: safeAlloc,
          adjustmentMw: item.adjustmentMw - actualRed,
          status: "PARTIAL_DEFERRED",
          tradeOffRationale: `Non-urgent cellular packets throttled; maintains ${safeAlloc} MW for emergency responder channels.`,
        };
      }
      return item;
    });

    // Recalculate to ensure exact 45 MW
    const currentSum = reallocAlloc.reduce((s, i) => s + i.allocatedMw, 0);
    if (currentSum !== totalEmergencyReserveMw) {
      const diff = totalEmergencyReserveMw - currentSum;
      // adjust water or ops
      const targetAdjust = reallocAlloc.find((i) => i.sectorId === "water_infrastructure")!;
      targetAdjust.allocatedMw += diff;
    }

    const comparison: ReallocationComparison[] = proposedAlloc.map((orig) => {
      const updated = reallocAlloc.find((u) => u.sectorId === orig.sectorId)!;
      return {
        sectorId: orig.sectorId,
        sectorName: orig.sectorName,
        beforeMw: orig.allocatedMw,
        afterMw: updated.allocatedMw,
        deltaMw: Number((updated.allocatedMw - orig.allocatedMw).toFixed(1)),
        concessionReason:
          updated.allocatedMw > orig.allocatedMw
            ? `Emergency allocation of +${addMw} MW for ${targetOrg}`
            : updated.allocatedMw < orig.allocatedMw
              ? `Conceded ${Math.abs(updated.allocatedMw - orig.allocatedMw).toFixed(1)} MW above safe operating floor`
              : "Maintained baseline emergency floor",
      };
    });

    reallocationSection = {
      triggeredBy: targetOrg,
      additionalDemandMw: addMw,
      stream: reallocStream,
      comparison,
      newProposedAllocation: reallocAlloc,
      reallocationRationale: `Following incoming emergency priority request from ${targetOrg} (+${addMw} MW), the Central Coordinator safely redistributed ${addMw} MW from operational flex reserves across water, telecom, and emergency response. All 4 sectors remain strictly above their statutory minimum safety thresholds without exceeding the 45.0 MW municipal emergency limit.`,
    };
  }

  return {
    activeCrisis: {
      title: profile.title,
      scenarioKey: profile.scenarioKey,
      location: profile.location,
      severity: profile.severity,
    },
    capacitySummary: {
      totalEmergencyReserveMw,
      totalRequestedMw,
      allocationGapMw,
      totalAllocatedMw,
      capacityStatus:
        totalAllocatedMw <= totalEmergencyReserveMw ? "FULLY_UTILIZED" : "CRITICAL_DEFICIT",
    },
    agentParticipants: agents,
    negotiationStream: stream,
    proposedAllocation: proposedAlloc,
    coordinatorRationale: profile.coordinatorStrategy.summaryRationale,
    reallocation: reallocationSection,
    approvalState: {
      status: "PROPOSED_AWAITING_AUTHORITY",
      proposedBy: "CRISISGRID CENTRAL COORDINATOR",
      canDispatch: true,
    },
  };
}
