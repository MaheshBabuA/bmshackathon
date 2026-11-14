import assert from "node:assert/strict";
import test from "node:test";
import {
  AVAILABLE_CAPACITY_MW,
  AllocationError,
  recommendAllocation,
  type SectorDemand,
} from "./allocation.js";
import { analyzeIncidentImpact } from "./incidents.js";
import {
  CreateEmergencyReportSchema,
  CreateReviewSchema,
} from "../http/schemas.js";

const baseline: SectorDemand[] = [
  {
    id: "hospital_network",
    name: "Hospital Network",
    demandMw: 18,
    minimumSafeCapacityMw: 15.5,
    maximumCapacityMw: 22,
    priorityWeight: 1,
  },
  {
    id: "water_infrastructure",
    name: "Water Infrastructure",
    demandMw: 10,
    minimumSafeCapacityMw: 8,
    maximumCapacityMw: 18,
    priorityWeight: 0.9,
  },
  {
    id: "telecommunications",
    name: "Telecommunications",
    demandMw: 7,
    minimumSafeCapacityMw: 4.5,
    maximumCapacityMw: 10,
    priorityWeight: 0.6,
  },
  {
    id: "emergency_operations",
    name: "Emergency Operations",
    demandMw: 10,
    minimumSafeCapacityMw: 8,
    maximumCapacityMw: 15,
    priorityWeight: 1,
  },
];

test("allocates baseline demand without exceeding the 45 MW pool", () => {
  const plan = recommendAllocation(baseline);

  assert.equal(AVAILABLE_CAPACITY_MW, 45);
  assert.equal(plan.totalCapacityMw, 45);
  assert.deepEqual(
    plan.items.map((item) => item.allocatedCapacityMw),
    [18, 10, 7, 10],
  );
});

test("preserves the INC-8092 redistribution at 45 MW and above every safety floor", () => {
  const scenarioDemands = baseline.map((sector, index) => ({
    ...sector,
    demandMw: [17, 12, 5, 11][index] ?? sector.demandMw,
  }));
  const plan = recommendAllocation(scenarioDemands);

  assert.equal(plan.totalCapacityMw, 45);
  assert.deepEqual(
    plan.items.map((item) => item.allocatedCapacityMw),
    [17, 12, 5, 11],
  );
  assert.ok(
    plan.items.every((item) => {
      const sector = scenarioDemands.find((entry) => entry.id === item.sectorId);
      return sector !== undefined &&
        item.allocatedCapacityMw >= sector.minimumSafeCapacityMw;
    }),
  );
});

test("rebalances incident demand within the capacity limit and safety floors", () => {
  const sectors = baseline.map((sector) => ({
    ...sector,
    demandMw: sector.demandMw + 4,
  }));
  const plan = recommendAllocation(sectors);

  assert.equal(plan.totalCapacityMw, 45);
  assert.ok(
    plan.items.every((item) => {
      const sector = sectors.find((entry) => entry.id === item.sectorId);
      return item.allocatedCapacityMw >= sector!.minimumSafeCapacityMw;
    }),
  );
  assert.ok(plan.items.every((item) => item.allocatedCapacityMw <= 45));
});

test("redistributes spare capacity when a sector reaches its demand", () => {
  const sectors = baseline.map((sector, index) => ({
    ...sector,
    demandMw: index === 0 ? 15.5 : sector.demandMw + 20,
  }));
  const plan = recommendAllocation(sectors);

  assert.equal(plan.totalCapacityMw, 45);
  assert.equal(plan.items[0]?.allocatedCapacityMw, 15.5);
  assert.ok(plan.items.every((item) => item.allocatedCapacityMw >= 4.5));
});

test("rejects unavoidable shortages instead of silently breaching a safety floor", () => {
  const sectors = baseline.map((sector) => ({
    ...sector,
    minimumSafeCapacityMw: 12,
    maximumCapacityMw: 12,
    demandMw: 12,
  }));

  assert.throws(
    () => recommendAllocation(sectors),
    (error: unknown) =>
      error instanceof AllocationError &&
      error.code === "UNAVOIDABLE_SHORTAGE",
  );
});

test("rejects duplicate sectors and demands below their safety floors", () => {
  const hospital = baseline[0];
  assert.ok(hospital);
  assert.throws(() => recommendAllocation([hospital, hospital]));
  assert.throws(() =>
    recommendAllocation([
      { ...hospital, demandMw: 1 },
    ]),
  );
  assert.throws(() =>
    recommendAllocation([
      { ...hospital, maximumCapacityMw: hospital.minimumSafeCapacityMw - 1 },
    ]),
  );
});

test("never recommends capacity above a sector's configured maximum", () => {
  const constrained = baseline.map((sector) => ({
    ...sector,
    demandMw: sector.maximumCapacityMw + 5,
  }));
  const plan = recommendAllocation(constrained);

  assert.ok(
    plan.items.every((item) => {
      const sector = constrained.find((entry) => entry.id === item.sectorId);
      return sector !== undefined &&
        item.allocatedCapacityMw <= sector.maximumCapacityMw;
    }),
  );
  assert.ok(plan.totalCapacityMw <= AVAILABLE_CAPACITY_MW);
});

test("scores a report deterministically without relying on an external AI service", () => {
  const impacts = analyzeIncidentImpact(baseline, "fire", "critical");

  assert.deepEqual(
    impacts.map((impact) => impact.demandDeltaMw),
    [0.8, 2.4, 0.3, 1.5],
  );
  assert.ok(impacts.every((impact) => impact.rationale.includes("simulation")));
});

test("validates and normalizes emergency report input", () => {
  const report = CreateEmergencyReportSchema.safeParse({
    description: "Industrial fire near a road closure.",
    incidentType: "fire",
    severity: "critical",
  });

  assert.equal(report.success, true);
  if (report.success) {
    assert.equal(report.data.location, "Indiranagar, 100ft Rd");
    assert.equal(report.data.isAnonymous, true);
  }
  assert.equal(
    CreateEmergencyReportSchema.safeParse({
      description: "short",
      incidentType: "fire",
      severity: "critical",
    }).success,
    false,
  );
});

test("refuses authority modifications above the capacity limit or without all sectors", () => {
  assert.equal(
    CreateReviewSchema.safeParse({
      decision: "modify",
      items: baseline.map((sector) => ({
        sectorId: sector.id,
        allocatedCapacityMw: sector.minimumSafeCapacityMw,
      })),
    }).success,
    true,
  );
  assert.equal(
    CreateReviewSchema.safeParse({
      decision: "modify",
      items: baseline.map((sector) => ({
        sectorId: sector.id,
        allocatedCapacityMw: 12,
      })),
    }).success,
    false,
  );
  assert.equal(
    CreateReviewSchema.safeParse({
      decision: "modify",
      items: baseline.slice(0, 3).map((sector) => ({
        sectorId: sector.id,
        allocatedCapacityMw: sector.minimumSafeCapacityMw,
      })),
    }).success,
    false,
  );
});
