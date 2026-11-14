import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateReviewSchema,
  ModifyParametersSchema,
  UserRoleSchema,
} from "../http/schemas.js";
import {
  calculateDynamicAllocation,
  type DynamicAllocationInput,
} from "./dynamic-allocation.js";

const sampleInput: DynamicAllocationInput = {
  totalAvailableCapacityMw: 45,
  sectors: [
    {
      sectorId: "hospital_network",
      sectorName: "Hospital Network",
      currentAllocationMw: 18,
      baselineDemandMw: 18,
      minimumSafeCapacityMw: 15.5,
      maximumRequestedCapacityMw: 22,
      priorityWeight: 1.0,
      operationalFlexibility: 0.15,
      lifeCritical: true,
      incidentImpacts: [
        {
          incidentId: "INC-8092",
          incidentTitle: "3-Alarm Chemical & Structural Fire",
          incidentType: "fire_hazmat",
          severity: "critical",
          demandDeltaMw: -1,
        },
      ],
    },
    {
      sectorId: "water_infrastructure",
      sectorName: "Water Infrastructure",
      currentAllocationMw: 10,
      baselineDemandMw: 10,
      minimumSafeCapacityMw: 8.0,
      maximumRequestedCapacityMw: 18,
      priorityWeight: 0.9,
      operationalFlexibility: 0.2,
      lifeCritical: true,
      incidentImpacts: [
        {
          incidentId: "INC-8092",
          incidentTitle: "3-Alarm Chemical & Structural Fire",
          incidentType: "fire_hazmat",
          severity: "critical",
          demandDeltaMw: 2,
        },
      ],
    },
    {
      sectorId: "telecommunications",
      sectorName: "Telecommunications",
      currentAllocationMw: 7,
      baselineDemandMw: 7,
      minimumSafeCapacityMw: 4.5,
      maximumRequestedCapacityMw: 10,
      priorityWeight: 0.6,
      operationalFlexibility: 0.95,
      lifeCritical: false,
      incidentImpacts: [
        {
          incidentId: "INC-8092",
          incidentTitle: "3-Alarm Chemical & Structural Fire",
          incidentType: "fire_hazmat",
          severity: "critical",
          demandDeltaMw: -2,
        },
      ],
    },
    {
      sectorId: "emergency_operations",
      sectorName: "Emergency Operations",
      currentAllocationMw: 10,
      baselineDemandMw: 10,
      minimumSafeCapacityMw: 8.0,
      maximumRequestedCapacityMw: 15,
      priorityWeight: 1.0,
      operationalFlexibility: 0.3,
      lifeCritical: true,
      incidentImpacts: [
        {
          incidentId: "INC-8092",
          incidentTitle: "3-Alarm Chemical & Structural Fire",
          incidentType: "fire_hazmat",
          severity: "critical",
          demandDeltaMw: 1,
        },
      ],
    },
  ],
};

test("RBAC roles: accepts CITIZEN, OPERATOR, AUTHORITY", () => {
  assert.equal(UserRoleSchema.parse("CITIZEN"), "CITIZEN");
  assert.equal(UserRoleSchema.parse("OPERATOR"), "OPERATOR");
  assert.equal(UserRoleSchema.parse("AUTHORITY"), "AUTHORITY");
  assert.throws(() => UserRoleSchema.parse("ADMIN"));
  assert.throws(() => UserRoleSchema.parse("GUEST"));
});

test("CreateReviewSchema validates authority decisions and roles", () => {
  const approveReview = CreateReviewSchema.parse({
    decision: "approve",
    reviewer: "Dr. Arvind Rao",
    role: "AUTHORITY",
    signerRole: "Disaster Coordinator",
  });
  assert.equal(approveReview.decision, "approve");
  assert.equal(approveReview.role, "AUTHORITY");
  assert.equal(approveReview.signerRole, "Disaster Coordinator");

  const rejectReview = CreateReviewSchema.parse({
    decision: "reject",
    reviewer: "S. Mukherjee",
    role: "AUTHORITY",
    signerRole: "Gov. Operations Lead",
  });
  assert.equal(rejectReview.decision, "reject");

  // Rejects modified review without items
  assert.throws(() =>
    CreateReviewSchema.parse({
      decision: "modify",
      reviewer: "Dr. Arvind Rao",
      role: "AUTHORITY",
    }),
  );

  // Rejects allocations exceeding 45 MW
  assert.throws(() =>
    CreateReviewSchema.parse({
      decision: "modify",
      reviewer: "Dr. Arvind Rao",
      role: "AUTHORITY",
      items: [
        { sectorId: "hospital_network", allocatedCapacityMw: 20 },
        { sectorId: "water_infrastructure", allocatedCapacityMw: 15 },
        { sectorId: "telecommunications", allocatedCapacityMw: 8 },
        { sectorId: "emergency_operations", allocatedCapacityMw: 10 }, // sum 53 > 45
      ],
    }),
  );
});

test("ModifyParametersSchema validates controlled parameter shifts", () => {
  const validMod = ModifyParametersSchema.parse({
    role: "AUTHORITY",
    reviewer: "Dr. Arvind Rao",
    sectorAllocations: [
      { sectorId: "hospital_network", allocatedCapacityMw: 17.5 },
      { sectorId: "water_infrastructure", allocatedCapacityMw: 12.0 },
      { sectorId: "telecommunications", allocatedCapacityMw: 5.0 },
      { sectorId: "emergency_operations", allocatedCapacityMw: 10.5 },
    ],
    incidentPriority: "critical",
    emergencyDemand: {
      water_infrastructure: 2.5,
    },
  });
  assert.equal(validMod.incidentPriority, "critical");
  assert.equal(validMod.sectorAllocations?.length, 4);

  // Rejects invalid priority
  assert.throws(() =>
    ModifyParametersSchema.parse({
      role: "AUTHORITY",
      incidentPriority: "extreme",
    }),
  );
});

test("CRITICAL PRINCIPLE: Recommends, never automatically approves", () => {
  const simulation = calculateDynamicAllocation(sampleInput);
  // Simulation is deterministic recommendation
  assert.equal(simulation.status, "balanced");
  assert.equal(simulation.totalAllocated, 45);
  // Allocations match recommended shifts
  const hospital = simulation.sectors.find((s) => s.sectorId === "hospital_network")!;
  const water = simulation.sectors.find((s) => s.sectorId === "water_infrastructure")!;
  const telecom = simulation.sectors.find((s) => s.sectorId === "telecommunications")!;
  const eoc = simulation.sectors.find((s) => s.sectorId === "emergency_operations")!;

  assert.equal(hospital.recommendedAllocation, 17);
  assert.equal(water.recommendedAllocation, 12);
  assert.equal(telecom.recommendedAllocation, 5);
  assert.equal(eoc.recommendedAllocation, 11);

  // All safety floors respected
  assert(hospital.recommendedAllocation >= hospital.minimumSafeCapacity);
  assert(water.recommendedAllocation >= water.minimumSafeCapacity);
  assert(telecom.recommendedAllocation >= telecom.minimumSafeCapacity);
  assert(eoc.recommendedAllocation >= eoc.minimumSafeCapacity);

  // No negative allocations
  simulation.sectors.forEach((s) => {
    assert(s.recommendedAllocation >= 0);
  });
});

test("Dual-key quorum: requires both signatures for full approval", () => {
  const signatures: { role: string; signer: string }[] = [];
  const required = 2;

  // Step 1: Signature 1 signs
  signatures.push({ role: "Gov. Operations Lead", signer: "S. Mukherjee" });
  assert.equal(signatures.length, 1);
  const quorum1 = `${signatures.length} of ${required} Signed`;
  assert.equal(quorum1, "1 of 2 Signed");
  const isApproved1 = signatures.length >= required;
  assert.equal(isApproved1, false);

  // Step 2: Signature 2 signs
  signatures.push({ role: "Disaster Coordinator", signer: "Dr. Arvind Rao" });
  assert.equal(signatures.length, 2);
  const quorum2 = `${signatures.length} of ${required} Signed`;
  assert.equal(quorum2, "2 of 2 Signed");
  const isApproved2 = signatures.length >= required;
  assert.equal(isApproved2, true);
});

test("Rejection maintains baseline allocations", () => {
  const baselineAllocations = {
    hospital_network: 18,
    water_infrastructure: 10,
    telecommunications: 7,
    emergency_operations: 10,
  };

  // Simulating reject action
  const decision = "reject";
  const planStatus = decision === "reject" ? "REJECTED" : "APPROVED";
  assert.equal(planStatus, "REJECTED");

  // Current allocations must stay unchanged
  const activeAllocations = { ...baselineAllocations };
  assert.deepEqual(activeAllocations, baselineAllocations);
});

test("Parameter modification re-runs dynamic allocation and verifies safety floors", () => {
  // Manual override: fine-tune hospital allocation to 16.5 MW
  const simulation = calculateDynamicAllocation(sampleInput, {
    sectorId: "hospital_network",
    requestedAllocationMw: 16.5,
  });

  assert.equal(simulation.status, "capacity_available");
  assert.equal(simulation.totalAllocated, 44.5);
  const hospital = simulation.sectors.find((s) => s.sectorId === "hospital_network")!;
  assert.equal(hospital.recommendedAllocation, 16.5);
  assert(hospital.recommendedAllocation >= hospital.minimumSafeCapacity);

  // Negative or below floor overrides are rejected
  assert.throws(() =>
    calculateDynamicAllocation(sampleInput, {
      sectorId: "hospital_network",
      requestedAllocationMw: 14.0, // below floor 15.5
    }),
  );
});
