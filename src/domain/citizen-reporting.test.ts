import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateEmergencyReportSchema,
} from "../http/schemas.js";
import {
  confirmationTimeline,
  incidentTypeForCategory,
  resolveCitizenCategory,
  triageCitizenReport,
} from "./citizen-reporting.js";
import type { SectorDemand } from "./allocation.js";

const sectors: SectorDemand[] = [
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

test("maps citizen emergency categories onto existing incident types", () => {
  assert.equal(incidentTypeForCategory("medical"), "medical");
  assert.equal(incidentTypeForCategory("fire_rescue"), "fire");
  assert.equal(incidentTypeForCategory("disaster"), "flood");
  assert.equal(incidentTypeForCategory("civic_hazard"), "infrastructure");
  assert.equal(resolveCitizenCategory("fire_rescue"), "fire_rescue");
  assert.equal(resolveCitizenCategory(undefined, "flood"), "disaster");
});

test("triages a critical fire-rescue report onto operations, water, and telecom", () => {
  const result = triageCitizenReport(sectors, {
    category: "fire_rescue",
    urgency: "critical",
    location: "Indiranagar",
  });

  assert.equal(result.severity, "critical");
  assert.equal(result.incidentType, "fire");
  assert.deepEqual(result.affectedSectorIds, [
    "emergency_operations",
    "water_infrastructure",
    "telecommunications",
  ]);
  assert.equal(
    result.impacts.find((impact) => impact.sectorId === "hospital_network")
      ?.demandDeltaMw,
    0,
  );
  assert.ok(
    result.impacts.some(
      (impact) =>
        impact.sectorId === "water_infrastructure" && impact.demandDeltaMw > 0,
    ),
  );
  assert.equal(result.allocationRecommended, true);
  assert.equal(result.automatedTriage, true);
});

test("triages a critical medical report onto the hospital network and emergency operations", () => {
  const result = triageCitizenReport(sectors, {
    category: "medical",
    urgency: "critical",
  });

  assert.deepEqual(result.affectedSectorIds, [
    "hospital_network",
    "emergency_operations",
  ]);
  assert.ok(
    result.impacts.every(
      (impact) =>
        result.affectedSectorIds.includes(impact.sectorId)
          ? impact.demandDeltaMw > 0
          : impact.demandDeltaMw === 0,
    ),
  );
});

test("records confirmation through authority review when allocation is needed", () => {
  const steps = confirmationTimeline(true);
  assert.deepEqual(
    steps.map((step) => step.label),
    ["REPORT RECEIVED", "TRIAGED", "DISPATCH REQUESTED", "AUTHORITY REVIEW"],
  );
  assert.ok(
    steps.some((step) =>
      /does not connect to police, ambulance, fire, 112/i.test(step.note),
    ),
  );
});

test("records full confirmation stages through response active", () => {
  const nonAllocSteps = confirmationTimeline(false);
  assert.deepEqual(
    nonAllocSteps.map((step) => step.label),
    ["REPORT RECEIVED", "TRIAGED", "DISPATCH REQUESTED", "RESPONSE ACTIVE"],
  );

  const allStages = confirmationTimeline(true, { includeAllStages: true });
  assert.deepEqual(
    allStages.map((step) => step.label),
    [
      "REPORT RECEIVED",
      "TRIAGED",
      "DISPATCH REQUESTED",
      "AUTHORITY REVIEW",
      "RESPONSE ACTIVE",
    ],
  );
});

test("accepts citizen category and urgency aliases on the report schema", () => {
  const report = CreateEmergencyReportSchema.safeParse({
    description: "Smoke and visible flames near a transformer.",
    category: "fire_rescue",
    urgency: "critical",
    locationSource: "demo_fallback",
    inputMode: "speech",
  });

  assert.equal(report.success, true);
  if (report.success) {
    assert.equal(report.data.category, "fire_rescue");
    assert.equal(report.data.incidentType, "fire");
    assert.equal(report.data.severity, "critical");
    assert.equal(report.data.urgency, "critical");
    assert.equal(report.data.location, "Indiranagar, 100ft Rd");
  }
});
