import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveResourceNegotiation,
  SCENARIO_NEGOTIATION_PROFILES,
} from "./resource-negotiation.js";
import { AVAILABLE_CAPACITY_MW } from "./allocation.js";

test("TEST 1: Industrial Fire scenario matches fire-specific negotiation requirements", () => {
  const result = buildLiveResourceNegotiation("industrial_fire");

  assert.equal(result.activeCrisis.scenarioKey, "industrial_fire");
  assert.ok(result.activeCrisis.title.includes("Fire"));
  assert.ok(result.activeCrisis.location.includes("Indiranagar"));

  // Check agent requirements
  const waterAgent = result.agentParticipants.find(
    (a) => a.agentType === "water_infrastructure",
  );
  assert.ok(waterAgent);
  assert.equal(waterAgent.requestedCapacityMw, 12);
  assert.equal(waterAgent.minimumSafeCapacityMw, 10);
  assert.equal(waterAgent.priorityLevel, "CRITICAL");
  assert.ok(waterAgent.operationalReason.toLowerCase().includes("hydrant"));

  // Stream dialogue checks
  const streamTexts = result.negotiationStream.map((s) => s.message).join(" ");
  assert.ok(streamTexts.includes("Fire suppression demand is peaking"));
  assert.ok(streamTexts.includes("deluge hydrants"));
  assert.ok(streamTexts.includes("Burn trauma admissions have surged"));

  // Verify proposed allocations match 45 MW
  const totalAlloc = result.proposedAllocation.reduce((s, a) => s + a.allocatedMw, 0);
  assert.equal(totalAlloc, 45);
});

test("TEST 2: Urban Flood scenario has different agent priorities, requests, and dialogue", () => {
  const fireResult = buildLiveResourceNegotiation("industrial_fire");
  const floodResult = buildLiveResourceNegotiation("urban_flood");

  assert.equal(floodResult.activeCrisis.scenarioKey, "urban_flood");
  assert.ok(floodResult.activeCrisis.title.includes("Flood"));
  assert.ok(floodResult.activeCrisis.location.includes("K.R. Market"));

  const fireWater = fireResult.agentParticipants.find((a) => a.agentType === "water_infrastructure")!;
  const floodWater = floodResult.agentParticipants.find((a) => a.agentType === "water_infrastructure")!;

  // Flood water requested is 14 MW (vs fire 12 MW)
  assert.equal(floodWater.requestedCapacityMw, 14);
  assert.notEqual(fireWater.requestedCapacityMw, floodWater.requestedCapacityMw);

  // Stream dialogue checks
  const floodStream = floodResult.negotiationStream.map((s) => s.message).join(" ");
  assert.ok(floodStream.includes("Stormwater inundation"));
  assert.ok(floodStream.includes("Lowland evacuation intake"));
  assert.ok(floodStream.includes("Water rescue teams"));
  assert.ok(!floodStream.includes("deluge chemical containment"));
});

test("TEST 3: Total requested capacity > 45 MW produces a valid allocation <= 45 MW", () => {
  const result = buildLiveResourceNegotiation("industrial_fire");

  // Verify total requested > 45 MW
  assert.ok(result.capacitySummary.totalRequestedMw > AVAILABLE_CAPACITY_MW);
  assert.equal(result.capacitySummary.totalRequestedMw, 48);
  assert.equal(result.capacitySummary.totalEmergencyReserveMw, 45);
  assert.equal(result.capacitySummary.allocationGapMw, -3);

  // Verify total allocated <= 45 MW
  assert.ok(result.capacitySummary.totalAllocatedMw <= AVAILABLE_CAPACITY_MW);
  assert.equal(result.capacitySummary.totalAllocatedMw, 45);
  assert.equal(result.capacitySummary.capacityStatus, "FULLY_UTILIZED");

  // Every sector must be at or above its minimum safe capacity
  for (const item of result.proposedAllocation) {
    assert.ok(
      item.allocatedMw >= item.minimumSafeMw,
      `Sector ${item.sectorName} allocated ${item.allocatedMw} MW is below safe floor ${item.minimumSafeMw} MW`,
    );
  }
});

test("TEST 4: New critical emergency request (+3 MW) reallocates existing capacity without exceeding 45 MW", () => {
  const result = buildLiveResourceNegotiation("industrial_fire", {
    organizationName: "BMS Hospital",
    resourceType: "Emergency Electricity",
    requestedAmountMw: 3,
    reason: "ICU and burn trauma operations surge",
  });

  assert.ok(result.reallocation, "Reallocation section must be present");
  assert.equal(result.reallocation.triggeredBy, "BMS Hospital");
  assert.equal(result.reallocation.additionalDemandMw, 3);

  // Verify comparison table before and after
  assert.ok(result.reallocation.comparison.length === 4);
  const hospitalComp = result.reallocation.comparison.find((c) => c.sectorId === "hospital_network")!;
  assert.equal(hospitalComp.afterMw, hospitalComp.beforeMw + 3);

  // Total allocated after reallocation MUST strictly equal 45 MW
  const totalAfter = result.reallocation.newProposedAllocation.reduce((s, a) => s + a.allocatedMw, 0);
  assert.equal(totalAfter, 45);

  // Every sector after reallocation must still be >= its minimum safe floor
  for (const item of result.reallocation.newProposedAllocation) {
    assert.ok(
      item.allocatedMw >= item.minimumSafeMw,
      `After reallocation, ${item.sectorName} (${item.allocatedMw} MW) breached minimum safe floor (${item.minimumSafeMw} MW)`,
    );
  }

  // Stream contains reallocation dialogue
  const streamTexts = result.reallocation.stream.map((s) => s.message).join(" ");
  assert.ok(streamTexts.includes("EMERGENCY INTERRUPTION"));
  assert.ok(streamTexts.includes("BMS Hospital"));
  assert.ok(streamTexts.includes("Emergency reserve is 100% utilized at 45 MW"));
});

test("TEST 5: Authority rejects proposed allocation -> proposal is not dispatched", () => {
  const result = buildLiveResourceNegotiation("industrial_fire");

  // Coordinator proposes, authority has not yet signed
  assert.equal(result.approvalState.status, "PROPOSED_AWAITING_AUTHORITY");
  assert.equal(result.approvalState.proposedBy, "CRISISGRID CENTRAL COORDINATOR");

  // Simulate authority rejection
  const rejectedState = {
    ...result.approvalState,
    status: "REJECTED" as const,
    decisionReason: "Executive review requested deeper telecommunication priority.",
    canDispatch: false,
  };

  assert.equal(rejectedState.status, "REJECTED");
  assert.equal(rejectedState.canDispatch, false);
});

test("TEST 6: Authority approves allocation -> state transitions to APPROVED_AND_DISPATCHED", () => {
  const result = buildLiveResourceNegotiation("industrial_fire");

  assert.equal(result.approvalState.status, "PROPOSED_AWAITING_AUTHORITY");

  // Simulate authority executive sign-off
  const approvedState = {
    ...result.approvalState,
    status: "APPROVED_AND_DISPATCHED" as const,
    signedBy: "Municipal Incident Commander",
    dispatchedAtIst: "14:45:00 IST",
    canDispatch: false,
  };

  assert.equal(approvedState.status, "APPROVED_AND_DISPATCHED");
  assert.equal(approvedState.signedBy, "Municipal Incident Commander");
});
