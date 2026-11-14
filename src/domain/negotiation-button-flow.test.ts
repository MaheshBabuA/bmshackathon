import test from "node:test";
import assert from "node:assert/strict";
import { inMemoryCrisisRepository } from "../services/in-memory-crisis-repository.js";
import {
  getLiveResourceNegotiation,
  resetCrisisSimulation,
  initiateCrisisSimulation,
  getDashboard,
} from "../services/crisis-service.js";

test("STEP 2 & 10: Live Resource Negotiation requires active crisis and handles complete lifecycle", async () => {
  // 1. Initial State: Reset demo to stable nominal state
  await resetCrisisSimulation(null);
  const initialDashboard = await getDashboard(null);
  assert.equal(initialDashboard.cityStatus, "STABLE");
  assert.equal(initialDashboard.activeCrisis, "NONE");
  assert.equal(initialDashboard.activeIncident, null);

  // When no active crisis exists, attempting negotiation throws the exact specified error
  await assert.rejects(
    async () => {
      await getLiveResourceNegotiation(null);
    },
    (err: any) => {
      assert.match(
        err.message,
        /No active crisis detected\. Simulate a crisis before starting resource negotiation\./i,
      );
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  // 2. Simulate Industrial Fire
  const simResult = await initiateCrisisSimulation(null, "industrial_fire");
  assert.equal(simResult.success, true);
  const activeDashboard = await getDashboard(null);
  assert.equal(activeDashboard.cityStatus, "CRISIS ACTIVE");
  assert.ok(activeDashboard.activeIncident);
  assert.equal(activeDashboard.activeIncident.title, "Large-Scale Industrial Fire");
  assert.match(activeDashboard.activeIncident.location, /Indiranagar Industrial Zone/i);

  // 3. Start Negotiation with active crisis (SINGLE SOURCE OF TRUTH)
  const negResult = await getLiveResourceNegotiation(null);
  assert.ok(negResult);
  assert.equal(negResult.activeCrisis.title, "Large-Scale Industrial Fire");
  assert.match(negResult.activeCrisis.location, /Indiranagar Industrial Zone/i);
  assert.equal(negResult.activeCrisis.severity, "CRITICAL");
  assert.equal(negResult.capacitySummary.totalEmergencyReserveMw, 45);

  // 4. Verify the 4 specialized operational agents + Central Coordinator
  assert.equal(negResult.agentParticipants.length, 4);
  const healthcareAgent = negResult.agentParticipants.find((a) => a.agentType === "healthcare");
  const waterAgent = negResult.agentParticipants.find((a) => a.agentType === "water_infrastructure");
  const telecomAgent = negResult.agentParticipants.find((a) => a.agentType === "telecommunications");
  const opsAgent = negResult.agentParticipants.find((a) => a.agentType === "emergency_operations");

  assert.ok(healthcareAgent, "Healthcare Agent must be initialized");
  assert.ok(waterAgent, "Water Infrastructure Agent must be initialized");
  assert.ok(telecomAgent, "Telecommunications Agent must be initialized");
  assert.ok(opsAgent, "Emergency Operations Agent must be initialized");

  assert.equal(healthcareAgent.requestedCapacityMw, 18);
  assert.equal(healthcareAgent.minimumSafeCapacityMw, 16);
  assert.match(healthcareAgent.operationalReason, /burn trauma|ICU/i);

  assert.equal(waterAgent.requestedCapacityMw, 12);
  assert.equal(waterAgent.minimumSafeCapacityMw, 10);

  // 5. Total Demand calculation & Deficit detection
  const totalDemanded = negResult.capacitySummary.totalRequestedMw;
  assert.equal(totalDemanded, 48); // 18 + 12 + 7 + 11 = 48 MW
  assert.ok(totalDemanded > 45, "Demanded capacity exceeds 45 MW reserve");
  assert.equal(negResult.capacitySummary.allocationGapMw, -3);

  // 6. Proposed Allocation arbitration
  assert.equal(negResult.proposedAllocation.length, 4);
  const totalAllocated = negResult.proposedAllocation.reduce((sum, s) => sum + s.allocatedMw, 0);
  assert.equal(totalAllocated, 45, "Allocated capacity must strictly equal 45 MW");
  for (const s of negResult.proposedAllocation) {
    assert.ok(
      s.allocatedMw >= s.minimumSafeMw,
      `Sector ${s.sectorName} (${s.allocatedMw} MW) must meet safety floor (${s.minimumSafeMw} MW)`,
    );
  }

  // 7. Coordinator Attestation & Approval State
  assert.ok(negResult.coordinatorRationale.length > 20);
  assert.equal(negResult.approvalState.status, "PROPOSED_AWAITING_AUTHORITY");
  assert.equal(negResult.approvalState.canDispatch, true);

  // 8. Demo Reset clears negotiation and restores nominal state
  const resetResult = await resetCrisisSimulation(null);
  assert.equal(resetResult.success, true);
  assert.equal(resetResult.cityStatus, "STABLE");

  await assert.rejects(
    async () => {
      await getLiveResourceNegotiation(null);
    },
    (err: any) => {
      assert.match(err.message, /No active crisis detected/i);
      return true;
    },
  );

  // 9. Simulate a Different Scenario (Urban Flood) and verify NO stale data
  await initiateCrisisSimulation(null, "urban_flood");
  const floodNeg = await getLiveResourceNegotiation(null);
  assert.equal(floodNeg.activeCrisis.title, "Urban Flood — K.R. Market Lowlands");
  assert.match(floodNeg.activeCrisis.location, /K\.R\. Market/i);
  assert.notEqual(floodNeg.activeCrisis.title, "Large-Scale Industrial Fire");

  const floodWater = floodNeg.agentParticipants.find((a) => a.agentType === "water_infrastructure")!;
  assert.equal(floodWater.requestedCapacityMw, 14, "Flood requires 14 MW for storm lift pumps");
  assert.equal(floodWater.status, "ACTIVE");

  // Clean reset after test
  await resetCrisisSimulation(null);
});
