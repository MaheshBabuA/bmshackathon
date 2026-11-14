import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDynamicAllocation,
  type DynamicAllocationInput,
  type DynamicSectorInput,
} from "./dynamic-allocation.js";

const sectors: DynamicSectorInput[] = [
  {
    sectorId: "hospital_network",
    sectorName: "Hospital Network",
    currentAllocationMw: 18,
    baselineDemandMw: 18,
    minimumSafeCapacityMw: 15.5,
    maximumRequestedCapacityMw: 22,
    priorityWeight: 1,
    operationalFlexibility: 0.15,
    lifeCritical: true,
    incidentImpacts: [],
  },
  {
    sectorId: "water_infrastructure",
    sectorName: "Water Infrastructure",
    currentAllocationMw: 10,
    baselineDemandMw: 10,
    minimumSafeCapacityMw: 8,
    maximumRequestedCapacityMw: 18,
    priorityWeight: 0.9,
    operationalFlexibility: 0.2,
    lifeCritical: true,
    incidentImpacts: [],
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
    incidentImpacts: [],
  },
  {
    sectorId: "emergency_operations",
    sectorName: "Emergency Operations",
    currentAllocationMw: 10,
    baselineDemandMw: 10,
    minimumSafeCapacityMw: 8,
    maximumRequestedCapacityMw: 15,
    priorityWeight: 1,
    operationalFlexibility: 0.3,
    lifeCritical: true,
    incidentImpacts: [],
  },
];

function run(overrides: Partial<DynamicAllocationInput> = {}) {
  return calculateDynamicAllocation({
    totalAvailableCapacityMw: 45,
    sectors,
    ...overrides,
  });
}

test("normal allocation preserves current capacity and reports a balanced pool", () => {
  const result = run();

  assert.equal(result.totalAvailableCapacity, 45);
  assert.equal(result.totalAllocated, 45);
  assert.equal(result.balance, 0);
  assert.equal(result.status, "balanced");
  assert.deepEqual(
    result.sectors.map((sector) => sector.recommendedAllocation),
    [18, 10, 7, 10],
  );
});

test("capacity shortage reduces flexible telecom before protected sectors", () => {
  const input = sectors.map((sector) => ({
    ...sector,
    incidentImpacts:
      sector.sectorId === "water_infrastructure"
        ? [{
            incidentId: "INC-WATER",
            incidentTitle: "Water system surge",
            incidentType: "infrastructure",
            severity: "urgent" as const,
            demandDeltaMw: 5,
          }]
        : sector.sectorId === "emergency_operations"
          ? [{
              incidentId: "INC-OPS",
              incidentTitle: "Emergency response surge",
              incidentType: "fire",
              severity: "urgent" as const,
              demandDeltaMw: 4,
            }]
          : [],
  }));
  const result = run({ sectors: input });

  assert.equal(result.status, "capacity_shortage");
  assert.equal(result.totalAllocated, 45);
  assert.ok(result.warnings.length > 0);
  assert.ok(
    result.sectors.every(
      (sector) => sector.recommendedAllocation >= sector.minimumSafeCapacity,
    ),
  );
  assert.equal(result.sectors[2]?.recommendedAllocation, 4.5);
});

test("critical emergency surge is prioritized while flexible capacity is reduced", () => {
  const input = sectors.map((sector) => ({
    ...sector,
    incidentImpacts:
      sector.sectorId === "emergency_operations"
        ? [{
            incidentId: "INC-FIRE",
            incidentTitle: "Critical industrial fire",
            incidentType: "fire_hazmat",
            severity: "critical" as const,
            demandDeltaMw: 5,
          }]
        : [],
  }));
  const result = run({ sectors: input });
  const emergencyOperations = result.sectors.find(
    (sector) => sector.sectorName === "Emergency Operations",
  );

  assert.equal(emergencyOperations?.recommendedAllocation, 15);
  assert.equal(result.sectors[2]?.recommendedAllocation, 4.5);
  assert.equal(result.totalAllocated, 45);
  assert.ok(
    result.decisionFactors.some((factor) =>
      factor.includes("Critical incident INC-FIRE"),
    ),
  );
});

test("minimum safe capacity is protected when incident demand decreases", () => {
  const input = sectors.map((sector) => ({
    ...sector,
    incidentImpacts:
      sector.sectorId === "telecommunications"
        ? [{
            incidentId: "INC-QUIET",
            incidentTitle: "Network bandwidth reduction",
            incidentType: "telecommunications",
            severity: "stable" as const,
            demandDeltaMw: -6,
          }]
        : [],
  }));
  const result = run({ sectors: input });
  const telecom = result.sectors.find(
    (sector) => sector.sectorName === "Telecommunications",
  );

  assert.equal(telecom?.requestedAllocation, 4.5);
  assert.equal(telecom?.recommendedAllocation, 4.5);
  assert.equal(telecom?.safetyMargin, 0);
  assert.equal(telecom?.status, "reduced");
});

test("total allocation never exceeds 45 MW, including when safety floors conflict", () => {
  const extreme = sectors.map((sector) => ({
    ...sector,
    minimumSafeCapacityMw: 12,
    maximumRequestedCapacityMw: 20,
    currentAllocationMw: 20,
    baselineDemandMw: 20,
  }));
  const result = run({ sectors: extreme });

  assert.ok(result.totalAllocated <= 45);
  assert.equal(result.status, "safety_floor_shortage");
  assert.ok(result.warnings.some((warning) => warning.includes("safety floors")));
});

test("multiple simultaneous incidents are aggregated deterministically", () => {
  const input = sectors.map((sector) => ({
    ...sector,
    incidentImpacts:
      sector.sectorId === "water_infrastructure"
        ? [
            {
              incidentId: "INC-FIRE",
              incidentTitle: "Industrial fire",
              incidentType: "fire",
              severity: "critical" as const,
              demandDeltaMw: 1,
            },
            {
              incidentId: "INC-FLOOD",
              incidentTitle: "Road flooding",
              incidentType: "flood",
              severity: "urgent" as const,
              demandDeltaMw: 1,
            },
          ]
        : sector.sectorId === "emergency_operations"
          ? [{
              incidentId: "INC-RESCUE",
              incidentTitle: "Rescue operation",
              incidentType: "medical",
              severity: "urgent" as const,
              demandDeltaMw: 1,
            }]
          : [],
  }));
  const result = run({ sectors: input });
  const water = result.sectors.find(
    (sector) => sector.sectorName === "Water Infrastructure",
  );
  const operations = result.sectors.find(
    (sector) => sector.sectorName === "Emergency Operations",
  );

  assert.equal(water?.requestedAllocation, 12);
  assert.equal(operations?.requestedAllocation, 11);
  assert.equal(result.totalAllocated, 45);
  assert.ok(result.decisionFactors.some((factor) => factor.includes("Water Infrastructure")));
});

test("INC-8092 produces the requested allocation and explainable sector factors", () => {
  const input = sectors.map((sector) => ({
    ...sector,
    incidentImpacts:
      sector.sectorId === "hospital_network"
        ? [{
            incidentId: "INC-8092",
            incidentTitle: "3-Alarm Chemical & Structural Fire",
            incidentType: "fire_hazmat",
            severity: "critical" as const,
            demandDeltaMw: -1,
          }]
        : sector.sectorId === "water_infrastructure"
          ? [{
              incidentId: "INC-8092",
              incidentTitle: "3-Alarm Chemical & Structural Fire",
              incidentType: "fire_hazmat",
              severity: "critical" as const,
              demandDeltaMw: 2,
            }]
          : sector.sectorId === "telecommunications"
            ? [{
                incidentId: "INC-8092",
                incidentTitle: "3-Alarm Chemical & Structural Fire",
                incidentType: "fire_hazmat",
                severity: "critical" as const,
                demandDeltaMw: -2,
              }]
            : [{
                incidentId: "INC-8092",
                incidentTitle: "3-Alarm Chemical & Structural Fire",
                incidentType: "fire_hazmat",
                severity: "critical" as const,
                demandDeltaMw: 1,
              }],
  }));
  const result = run({ sectors: input });

  assert.deepEqual(
    result.sectors.map((sector) => sector.recommendedAllocation),
    [17, 12, 5, 11],
  );
  assert.equal(result.totalAllocated, 45);
  assert.ok(result.sectors[0]?.rationale.includes("ICU, trauma, and emergency surgical services"));
  assert.ok(result.sectors[1]?.rationale.includes("fire hydrants and emergency pumping"));
  assert.ok(result.sectors[2]?.rationale.includes("non-essential civilian bandwidth"));
  assert.ok(result.sectors[3]?.rationale.includes("fire engines, mobile command, and rescue operations"));
});

test("re-running an approved incident recommendation does not apply its deltas twice", () => {
  const incidentImpacts = [
    { incidentId: "INC-8092", incidentTitle: "3-Alarm Fire", incidentType: "fire_hazmat", severity: "critical" as const, demandDeltaMw: -1 },
    { incidentId: "INC-8092", incidentTitle: "3-Alarm Fire", incidentType: "fire_hazmat", severity: "critical" as const, demandDeltaMw: 2 },
    { incidentId: "INC-8092", incidentTitle: "3-Alarm Fire", incidentType: "fire_hazmat", severity: "critical" as const, demandDeltaMw: -2 },
    { incidentId: "INC-8092", incidentTitle: "3-Alarm Fire", incidentType: "fire_hazmat", severity: "critical" as const, demandDeltaMw: 1 },
  ];
  const approvedAllocations = [17, 12, 5, 11];
  const approvedState = sectors.map((sector, index) => ({
    ...sector,
    currentAllocationMw: approvedAllocations[index] ?? sector.currentAllocationMw,
    incidentImpacts: [incidentImpacts[index]!],
  }));
  const result = run({ sectors: approvedState });

  assert.deepEqual(
    result.sectors.map((sector) => sector.recommendedAllocation),
    approvedAllocations,
  );
  assert.deepEqual(
    result.sectors.map((sector) => sector.delta),
    [0, 0, 0, 0],
  );
});

test("manual override recalculates other sectors without exceeding capacity", () => {
  const fireSectors = sectors.map((sector) => ({
    ...sector,
    incidentImpacts:
      sector.sectorId === "hospital_network"
        ? [{ incidentId: "INC-8092", incidentTitle: "Fire", incidentType: "fire", severity: "critical" as const, demandDeltaMw: -1 }]
        : sector.sectorId === "water_infrastructure"
          ? [{ incidentId: "INC-8092", incidentTitle: "Fire", incidentType: "fire", severity: "critical" as const, demandDeltaMw: 2 }]
          : sector.sectorId === "telecommunications"
            ? [{ incidentId: "INC-8092", incidentTitle: "Fire", incidentType: "fire", severity: "critical" as const, demandDeltaMw: -2 }]
            : [{ incidentId: "INC-8092", incidentTitle: "Fire", incidentType: "fire", severity: "critical" as const, demandDeltaMw: 1 }],
  }));
  const overridden = calculateDynamicAllocation(
    { totalAvailableCapacityMw: 45, sectors: fireSectors },
    { sectorId: "telecommunications", requestedAllocationMw: 6 },
  );

  assert.equal(overridden.sectors[2]?.recommendedAllocation, 6);
  assert.equal(overridden.totalAllocated, 45);
  assert.ok(overridden.sectors.every((sector) => sector.recommendedAllocation >= sector.minimumSafeCapacity));
  assert.ok(overridden.sectors[2]?.rationale.includes("Manual override"));
});

test("manual override rejects values below safety floors or beyond safe remaining capacity", () => {
  assert.throws(
    () =>
      calculateDynamicAllocation(
        { totalAvailableCapacityMw: 45, sectors },
        { sectorId: "telecommunications", requestedAllocationMw: 4 },
      ),
    /safety floor/i,
  );
  const floorDemand = sectors.map((sector) => ({
    ...sector,
    incidentImpacts: [{
      incidentId: "INC-FLOOR",
      incidentTitle: "Safety floor scenario",
      incidentType: "infrastructure",
      severity: "critical" as const,
      demandDeltaMw: sector.minimumSafeCapacityMw - sector.baselineDemandMw,
    }],
  }));
  assert.throws(
    () =>
      calculateDynamicAllocation(
        { totalAvailableCapacityMw: 45, sectors: floorDemand },
        { sectorId: "water_infrastructure", requestedAllocationMw: 18 },
      ),
    /cannot be safely satisfied/i,
  );
});
