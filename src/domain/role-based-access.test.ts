import test from "node:test";
import assert from "node:assert/strict";
import { inMemoryCrisisRepository } from "../services/in-memory-crisis-repository.js";
import { getPublicAlerts, publishCivicBroadcast, getDashboard } from "../services/crisis-service.js";

test("CRISISGRID RBAC — Role-Based Access Control and Public Information Suite", async () => {
  // Reset initial state to stable
  inMemoryCrisisRepository.resetDemo();

  // =========================================================================
  // TEST 1: GOVERNMENT ACCESS
  // =========================================================================
  const govDashboard = await getDashboard(null);
  assert.equal(govDashboard.cityStatus, "STABLE");
  assert.ok(govDashboard.sectors, "Government dashboard receives sectors");
  assert.ok(govDashboard.activePlan, "Government dashboard receives allocation plans");
  assert.equal(typeof govDashboard.cityGridCapacityMw, "number");
  assert.equal(typeof govDashboard.cityGridLoadMw, "number");

  // =========================================================================
  // TEST 2: PUBLIC ACCESS IN NOMINAL (STABLE) STATE
  // =========================================================================
  let publicAlerts = await getPublicAlerts(null);
  assert.equal(publicAlerts.activeEmergency, false);
  assert.equal(publicAlerts.cityStatus, "STABLE");
  assert.equal(publicAlerts.headline, "NO ACTIVE EMERGENCY");
  assert.equal(publicAlerts.severity, "NORMAL");
  assert.ok(publicAlerts.safetyInstructions.length > 0);
  assert.ok(publicAlerts.emergencyContacts.some((c) => c.number === "112"));

  // SENSITIVE DATA CHECK: Public alerts must NEVER contain MW numbers or internal telemetry
  const publicKeys = Object.keys(publicAlerts);
  assert.ok(!publicKeys.includes("cityGridCapacityMw"), "No grid capacity in public alerts");
  assert.ok(!publicKeys.includes("sectors"), "No sector allocations in public alerts");
  assert.ok(!publicKeys.includes("allocationPlans"), "No allocation plans in public alerts");
  assert.ok(!publicKeys.includes("signatures"), "No authority signatures in public alerts");
  assert.ok(!publicKeys.includes("agentNegotiation"), "No agent negotiation in public alerts");

  // =========================================================================
  // TEST 3: SIMULATE CRISIS FROM GOVERNMENT & VERIFY PUBLIC ALERT
  // =========================================================================
  // Scenario 1: Industrial Fire
  const fireSim = inMemoryCrisisRepository.initiateSimulation("industrial_fire");
  assert.equal(fireSim.success, true);

  publicAlerts = await getPublicAlerts(null);
  assert.equal(publicAlerts.activeEmergency, true);
  assert.equal(publicAlerts.cityStatus, "CRISIS ACTIVE");
  assert.equal(publicAlerts.severity, "CRITICAL");
  assert.ok(publicAlerts.headline.includes("INDUSTRIAL FIRE"));
  assert.ok(publicAlerts.location.includes("Indiranagar"));
  assert.ok(publicAlerts.affectedArea.includes("Indiranagar"));
  assert.equal(publicAlerts.evacuationRadiusM, 450);
  assert.ok(publicAlerts.safetyInstructions.some((s) => s.toLowerCase().includes("indiranagar")));

  // SENSITIVE DATA CHECK: Verify again during crisis that no MW or telemetry is leaked
  const publicJson = JSON.stringify(publicAlerts);
  assert.ok(!publicJson.includes("baseline_demand_mw"), "No baseline demand exposed");
  assert.ok(!publicJson.includes("allocated_capacity_mw"), "No allocated capacity exposed");
  assert.ok(!publicJson.includes("0x9F4C"), "No signature cryptographic hashes exposed");

  // =========================================================================
  // TEST 4: CIVIC BROADCAST MANAGEMENT — GOVERNMENT PREPARES & PUBLISHES
  // =========================================================================
  const broadcastResult = await publishCivicBroadcast(null, {
    headline: "URGENT EVACUATION DIRECTIVE: SECTOR 4 INDIRANAGAR",
    message: "Mandatory civil evacuation within 450m perimeter. Clear 100ft road for fire tenders.",
    safetyInstructions: [
      "Immediate mandatory evacuation for residents within Sector 4 Indiranagar.",
      "Assemble at designated high school ground evacuation shelter.",
      "Dial 112 for bedridden or elderly civilian transport assistance.",
    ],
    publishedBy: "State EOC Operations Director",
  });

  assert.equal(broadcastResult.success, true);
  assert.equal(broadcastResult.broadcast.headline, "URGENT EVACUATION DIRECTIVE: SECTOR 4 INDIRANAGAR");

  // Verify Public Portal immediately receives the published broadcast
  const updatedPublicAlerts = await getPublicAlerts(null);
  assert.equal(updatedPublicAlerts.headline, "URGENT EVACUATION DIRECTIVE: SECTOR 4 INDIRANAGAR");
  assert.equal(updatedPublicAlerts.safetyInstructions.length, 3);
  assert.ok(updatedPublicAlerts.safetyInstructions[0]!.includes("mandatory evacuation"));

  // =========================================================================
  // TEST 5: SWITCH CRISIS SCENARIO (Urban Flood) & VERIFY SCENARIO-SPECIFIC ALERT
  // =========================================================================
  const floodSim = inMemoryCrisisRepository.initiateSimulation("urban_flood");
  assert.equal(floodSim.success, true);

  const floodPublicAlerts = await getPublicAlerts(null);
  assert.equal(floodPublicAlerts.activeEmergency, true);
  assert.ok(floodPublicAlerts.headline.includes("FLOOD"));
  assert.ok(floodPublicAlerts.location.includes("Bellandur"));
  assert.ok(floodPublicAlerts.affectedArea.includes("Bellandur"));
  assert.equal(floodPublicAlerts.evacuationRadiusM, 600);
  assert.ok(floodPublicAlerts.safetyInstructions.some((s) => s.toLowerCase().includes("floodwater") || s.toLowerCase().includes("bellandur")));

  // =========================================================================
  // TEST 6: RESET DEMO & VERIFY PUBLIC ALERT RETURNS TO NO ACTIVE EMERGENCY
  // =========================================================================
  const resetResult = inMemoryCrisisRepository.resetDemo();
  assert.equal(resetResult.success, true);
  assert.equal(resetResult.cityStatus, "STABLE");

  const resetPublicAlerts = await getPublicAlerts(null);
  assert.equal(resetPublicAlerts.activeEmergency, false);
  assert.equal(resetPublicAlerts.cityStatus, "STABLE");
  assert.equal(resetPublicAlerts.headline, "NO ACTIVE EMERGENCY");
  assert.equal(resetPublicAlerts.severity, "NORMAL");
  assert.equal(resetPublicAlerts.evacuationRadiusM, 0);
  assert.ok(resetPublicAlerts.message?.includes("normal baseline parameters"));
});
