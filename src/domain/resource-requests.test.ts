import test from "node:test";
import assert from "node:assert/strict";
import {
  CRISIS_SCENARIOS,
  InMemoryCrisisRepository,
} from "../services/in-memory-crisis-repository.js";

test("simulating crisis generates scenario-specific resource requests", () => {
  const repo = new InMemoryCrisisRepository();
  const sim = repo.initiateSimulation("industrial_fire");
  assert.ok(sim.success);

  const requests = repo.listResourceRequests(sim.incidentId);
  assert.equal(requests.length, 3);

  // Check BMS Hospital request
  const bms = requests.find((r) => r.organization_name === "BMS Hospital");
  assert.ok(bms, "BMS Hospital request exists");
  assert.equal(bms.organization_type, "Hospital");
  assert.equal(bms.requested_amount, 3);
  assert.equal(bms.unit, "MW");
  assert.equal(bms.urgency, "CRITICAL");
  assert.equal(bms.status, "PENDING");
  assert.ok(bms.reason.includes("ICU"));

  // Check Water Infrastructure request
  const water = requests.find((r) => r.organization_name === "Water Infrastructure");
  assert.ok(water, "Water Infrastructure request exists");
  assert.equal(water.requested_amount, 2);
  assert.equal(water.urgency, "HIGH");
  assert.equal(water.status, "PENDING");
});

test("different crisis scenarios generate non-identical scenario-specific requests", () => {
  const repo = new InMemoryCrisisRepository();

  const floodSim = repo.initiateSimulation("urban_flood");
  const floodReqs = repo.listResourceRequests(floodSim.incidentId);
  assert.equal(floodReqs.length, 3);
  const floodPumping = floodReqs.find((r) => r.organization_name.includes("Water Pumping"));
  assert.ok(floodPumping);
  assert.equal(floodPumping.urgency, "CRITICAL");
  assert.equal(floodPumping.requested_amount, 3);

  const powerSim = repo.initiateSimulation("power_failure");
  const powerReqs = repo.listResourceRequests(powerSim.incidentId);
  assert.equal(powerReqs.length, 3);
  const powerBms = powerReqs.find((r) => r.organization_name === "BMS Hospital");
  assert.ok(powerBms);
  assert.equal(powerBms.requested_amount, 4);
  assert.ok(powerBms.reason.includes("blackout"));

  const hazmatSim = repo.initiateSimulation("hazmat");
  const hazmatReqs = repo.listResourceRequests(hazmatSim.incidentId);
  assert.equal(hazmatReqs.length, 3);
  const hazmatDecon = hazmatReqs.find((r) => r.organization_name.includes("Containment"));
  assert.ok(hazmatDecon);
  assert.equal(hazmatDecon.requested_amount, 3);
});

test("CRISISGRID generates simple deterministic recommendation for resource requests", () => {
  const repo = new InMemoryCrisisRepository();
  const sim = repo.initiateSimulation("industrial_fire");
  const requests = repo.listResourceRequests(sim.incidentId);
  const bms = requests.find((r) => r.organization_name === "BMS Hospital")!;

  const rec = repo.getResourceRequestRecommendation(bms.id);
  assert.equal(rec.recommendation, "APPROVE");
  assert.equal(rec.recommendedAmount, 3);
  assert.ok(rec.reason.includes("Available emergency capacity"));
  assert.equal(rec.priorityLevel, "CRITICAL");
});

test("Authority can approve resource request, updating capacity, status, and audit log", () => {
  const repo = new InMemoryCrisisRepository();
  const sim = repo.initiateSimulation("industrial_fire");
  const requests = repo.listResourceRequests(sim.incidentId);
  const bms = requests.find((r) => r.organization_name === "BMS Hospital")!;

  const initialHospCap = repo.getSectors().find((s) => s.id === "hospital_network")!.current_allocation_mw;

  const result = repo.reviewResourceRequest(
    bms.id,
    "APPROVE",
    undefined,
    "Authorized for ICU capacity under EOC protocol",
    "Authority EOC Lead",
  );

  assert.ok(result.success);
  assert.equal(result.request.status, "APPROVED");
  assert.equal(result.request.allocated_amount, 3);
  assert.equal(result.request.reviewed_by, "Authority EOC Lead");
  assert.ok(result.request.reviewed_at);

  // Check capacity update
  const newHospCap = repo.getSectors().find((s) => s.id === "hospital_network")!.current_allocation_mw;
  assert.equal(newHospCap, initialHospCap + 3);

  // Check audit log
  const auditLogs = repo.getAuditLogs();
  const log = auditLogs.find((l) => l.entity_id === bms.id);
  assert.ok(log, "Audit log entry created for authority decision");
  assert.equal(log.actor, "Authority EOC Lead");
  assert.equal(log.action, "RESOURCE_REQUEST_DECISION");
  const details = log.details as Record<string, unknown>;
  assert.equal(details.originalRequestedAmount, 3);
  assert.equal(details.finalAllocatedAmount, 3);
  assert.equal(details.decision, "APPROVE");
});

test("Authority can modify resource request with custom allocated amount", () => {
  const repo = new InMemoryCrisisRepository();
  const sim = repo.initiateSimulation("industrial_fire");
  const requests = repo.listResourceRequests(sim.incidentId);
  const water = requests.find((r) => r.organization_name === "Water Infrastructure")!;

  const initialWaterCap = repo.getSectors().find((s) => s.id === "water_infrastructure")!.current_allocation_mw;

  const result = repo.reviewResourceRequest(
    water.id,
    "MODIFY",
    1.5,
    "Trimmed to 1.5 MW to preserve reserve pool",
    "Disaster Coordinator",
  );

  assert.ok(result.success);
  assert.equal(result.request.status, "MODIFIED");
  assert.equal(result.request.allocated_amount, 1.5);
  assert.equal(result.request.reviewed_by, "Disaster Coordinator");

  const newWaterCap = repo.getSectors().find((s) => s.id === "water_infrastructure")!.current_allocation_mw;
  assert.equal(newWaterCap, initialWaterCap + 1.5);
});

test("Authority can reject resource request without altering infrastructure capacity", () => {
  const repo = new InMemoryCrisisRepository();
  const sim = repo.initiateSimulation("industrial_fire");
  const requests = repo.listResourceRequests(sim.incidentId);
  const ops = requests.find((r) => r.organization_name === "Emergency Operations")!;

  const initialOpsCap = repo.getSectors().find((s) => s.id === "emergency_operations")!.current_allocation_mw;

  const result = repo.reviewResourceRequest(
    ops.id,
    "REJECT",
    undefined,
    "Mobile generators deployed on-site instead",
    "Authority EOC Lead",
  );

  assert.ok(result.success);
  assert.equal(result.request.status, "REJECTED");
  assert.equal(result.request.allocated_amount, 0);

  const newOpsCap = repo.getSectors().find((s) => s.id === "emergency_operations")!.current_allocation_mw;
  assert.equal(newOpsCap, initialOpsCap);
});
