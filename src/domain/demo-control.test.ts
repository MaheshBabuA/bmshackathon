import test from "node:test";
import assert from "node:assert/strict";
import { inMemoryCrisisRepository } from "../services/in-memory-crisis-repository.js";
import { getDashboard } from "../services/crisis-service.js";

test("Normal Mode: Environment starts or resets to STABLE with zero active crises and zero priority requests", async () => {
  const resetResult = inMemoryCrisisRepository.resetDemo();
  assert.equal(resetResult.success, true);
  assert.equal(resetResult.cityStatus, "STABLE");
  assert.equal(resetResult.activeIncidents, 0);

  const state = inMemoryCrisisRepository.getCommandCenterState();
  assert.equal(state.city_status, "STABLE");
  assert.equal(state.active_crisis, "NONE");
  assert.equal(state.active_incident_id, null);
  assert.equal(state.emergency_capacity_mw, 45);

  const activeInc = inMemoryCrisisRepository.getActiveIncident();
  assert.equal(activeInc, null);

  const reqs = inMemoryCrisisRepository.listResourceRequests();
  assert.equal(reqs.length, 0);

  const dashboard = await getDashboard(null);
  assert.equal(dashboard.cityStatus, "STABLE");
  assert.equal(dashboard.activeCrisis, "NONE");
  assert.equal(dashboard.activeIncidentsCount, 0);
  assert.equal(dashboard.resourceRequests!.length, 0);
  assert.equal(dashboard.sectors.length, 4);

  // Baseline 45 MW capacity verified
  const totalAlloc = dashboard.sectors.reduce((sum, s) => sum + (s.allocatedCapacityMw ?? 0), 0);
  assert.equal(totalAlloc, 45);
});

test("Scenario Control: All 4 disaster scenarios have unique location, visual, impact, requests, and telemetry", () => {
  const scenarios = inMemoryCrisisRepository.getSimulationScenarios();
  assert.equal(scenarios.length, 4);

  const keys = scenarios.map((s) => s.key);
  assert.ok(keys.includes("industrial_fire"));
  assert.ok(keys.includes("urban_flood"));
  assert.ok(keys.includes("power_failure"));
  assert.ok(keys.includes("hazmat"));

  // Verify unique locations
  const locations = new Set(scenarios.map((s) => s.location));
  assert.equal(locations.size, 4, "Each scenario must have a distinct geographical location");

  // Verify unique telemetry metrics
  for (const s of scenarios) {
    assert.ok(s.telemetry && s.telemetry.length >= 4, `${s.key} has telemetry`);
  }
  const telemetryLabels = scenarios.map((s) => s.telemetry.map((t) => t.label).join(","));
  const uniqueTelemetry = new Set(telemetryLabels);
  assert.equal(uniqueTelemetry.size, 4, "Each scenario must have distinct telemetry telemetry metrics");

  // Verify unique resource requests
  for (const s of scenarios) {
    assert.ok(s.resourceRequests && s.resourceRequests.length >= 2, `${s.key} has resource requests`);
  }
  const requestSignatures = scenarios.map((s) =>
    s.resourceRequests!.map((r) => `${r.organizationName}:${r.requestedAmount}:${r.resourceType}`).join("|"),
  );
  const uniqueRequests = new Set(requestSignatures);
  assert.equal(uniqueRequests.size, 4, "Each scenario must generate non-identical resource requests");
});

test("Scenario 1: Industrial Fire simulation sets unique Indiranagar footprint and requests", async () => {
  inMemoryCrisisRepository.resetDemo();
  const init = inMemoryCrisisRepository.initiateSimulation("industrial_fire");
  assert.equal(init.cityStatus, "CRISIS ACTIVE");
  assert.ok(init.location.includes("Indiranagar"));

  const dashboard = await getDashboard(null);
  assert.equal(dashboard.cityStatus, "CRISIS ACTIVE");
  assert.equal(dashboard.activeIncidentsCount, 1);
  assert.ok(dashboard.activeIncident?.location.includes("Indiranagar"));
  assert.equal(dashboard.resourceRequests!.length, 3);
  assert.equal(dashboard.resourceRequests![0]!.organization_name, "BMS Hospital");
  assert.equal(dashboard.resourceRequests![0]!.requested_amount, 3);
});

test("Scenario 2: Urban Flood replaces previous crisis without data leakage", async () => {
  const init = inMemoryCrisisRepository.initiateSimulation("urban_flood");
  assert.equal(init.cityStatus, "CRISIS ACTIVE");
  assert.ok(init.location.includes("Bellandur") || init.location.includes("Drainage Basin"));

  const dashboard = await getDashboard(null);
  assert.equal(dashboard.cityStatus, "CRISIS ACTIVE");
  assert.equal(dashboard.activeIncidentsCount, 1);
  assert.ok(dashboard.activeIncident?.location.includes("Bellandur") || dashboard.activeIncident?.location.includes("Drainage Basin"));
  assert.ok(!dashboard.activeIncident?.location.includes("Indiranagar"));

  // Check flood-specific requests
  const floodReq = dashboard.resourceRequests!.find((r) => r.organization_name.includes("Water Pumping") || r.organization_name.includes("Water"));
  assert.ok(floodReq, "Water pumping request present in Urban Flood");
  assert.equal(floodReq.requested_amount, 3);
});

test("Scenario 3: Power Failure simulation isolates 220kV cluster and generates power requests", async () => {
  const init = inMemoryCrisisRepository.initiateSimulation("power_failure");
  assert.ok(init.location.includes("Peenya"));

  const dashboard = await getDashboard(null);
  assert.ok(dashboard.activeIncident?.location.includes("Peenya"));
  const bmsReq = dashboard.resourceRequests!.find((r) => r.organization_name === "BMS Hospital");
  assert.ok(bmsReq);
  assert.equal(bmsReq.requested_amount, 4); // 4 MW backup in blackout
});

test("Scenario 4: Hazmat simulation generates Whitefield chemical corridor profile", async () => {
  const init = inMemoryCrisisRepository.initiateSimulation("hazmat");
  assert.ok(init.location.includes("Whitefield"));

  const dashboard = await getDashboard(null);
  assert.ok(dashboard.activeIncident?.location.includes("Whitefield"));
  const scrubbersReq = dashboard.resourceRequests!.find((r) => r.resource_type.includes("Scrubbers"));
  assert.ok(scrubbersReq);
});

test("Demo Reset: Reliable return to CITY STATUS: STABLE and baseline capacity", async () => {
  // Ensure we are in a crisis
  inMemoryCrisisRepository.initiateSimulation("hazmat");
  assert.equal(inMemoryCrisisRepository.getActiveIncident() !== null, true);

  // Execute demo reset
  const resetRes = inMemoryCrisisRepository.resetDemo();
  assert.equal(resetRes.cityStatus, "STABLE");
  assert.equal(resetRes.activeIncidents, 0);

  // Validate state
  const activeInc = inMemoryCrisisRepository.getActiveIncident();
  assert.equal(activeInc, null);

  const reqs = inMemoryCrisisRepository.listResourceRequests();
  assert.equal(reqs.length, 0);

  const dashboard = await getDashboard(null);
  assert.equal(dashboard.cityStatus, "STABLE");
  assert.equal(dashboard.activeCrisis, "NONE");
  assert.equal(dashboard.activeIncidentsCount, 0);
  assert.equal(dashboard.resourceRequests!.length, 0);
  assert.equal(dashboard.activeResponseStream!.length, 0);

  // Safety baseline preserved
  const totalAlloc = dashboard.sectors.reduce((sum, s) => sum + (s.allocatedCapacityMw ?? 0), 0);
  assert.equal(totalAlloc, 45);
});
