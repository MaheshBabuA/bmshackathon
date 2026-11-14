import test from "node:test";
import assert from "node:assert/strict";
import { inMemoryCrisisRepository } from "../services/in-memory-crisis-repository.js";
import {
  getDashboard,
  getResourceRequestRecommendation,
  reviewResourceRequest,
} from "../services/crisis-service.js";

test("CRISISGRID Final Hackathon Readiness Audit — 12-Step Demo Flow Verification", async () => {
  // 1. Open Normal Mode & 2. Show Stable City
  const initialReset = inMemoryCrisisRepository.resetDemo();
  assert.equal(initialReset.success, true);
  assert.equal(initialReset.cityStatus, "STABLE");

  let dashboard = await getDashboard(null);
  assert.equal(dashboard.cityStatus, "STABLE");
  assert.equal(dashboard.activeCrisis, "NONE");
  assert.equal(dashboard.activeIncidentsCount, 0);
  assert.equal(dashboard.resourceRequests!.length, 0);
  assert.equal(dashboard.activePlan!.status.toUpperCase(), "APPROVED");
  assert.equal(dashboard.activePlan!.totalCapacityMw, 45);

  // 3. Initiate Industrial Fire
  const init = inMemoryCrisisRepository.initiateSimulation("industrial_fire");
  assert.equal(init.success, true);
  assert.ok(init.incidentCode.startsWith("INC-SIM-"));
  assert.equal(init.title, "Large-Scale Industrial Fire");

  // 4. Show simulated affected area
  assert.ok(init.location.includes("Indiranagar"));
  assert.ok(init.affectedArea && init.affectedArea.includes("Indiranagar"));

  // 5. Show impact
  dashboard = await getDashboard(null);
  assert.equal(dashboard.cityStatus, "CRISIS ACTIVE");
  assert.equal(dashboard.activeIncidentsCount, 1);
  assert.ok(dashboard.activeIncident);
  assert.equal(dashboard.activeIncident.id, init.incidentId);

  // 6. Show priority resource request
  const requests = inMemoryCrisisRepository.listResourceRequests(init.incidentId);
  assert.ok(requests.length >= 3, "At least 3 resource requests generated");
  const bmsRequest = requests.find((r) => r.organization_name === "BMS Hospital");
  assert.ok(bmsRequest, "BMS Hospital resource request exists");
  assert.equal(bmsRequest.urgency, "CRITICAL");
  assert.equal(bmsRequest.requested_amount, 3);
  assert.equal(bmsRequest.unit, "MW");
  assert.equal(bmsRequest.status, "PENDING");

  // 7. Review BMS Hospital request
  assert.equal(bmsRequest.organization_type, "Hospital");
  assert.ok(bmsRequest.reason.includes("ICU") || bmsRequest.reason.includes("capacity"));

  // 8. Show CRISISGRID recommendation
  const rec = inMemoryCrisisRepository.getResourceRequestRecommendation(bmsRequest.id);
  assert.equal(rec.recommendation, "APPROVE");
  assert.equal(rec.recommendedAmount, 3);
  assert.ok(rec.reason.length > 0);
  assert.equal(rec.priorityLevel, "CRITICAL");

  // 9. Authority approves allocation
  const reviewResult = await reviewResourceRequest(
    null,
    bmsRequest.id,
    {
      decision: "APPROVE",
      allocatedAmount: 3,
      reviewerRole: "Disaster Coordinator",
      notes: "Approved as recommended by CRISISGRID.",
    },
  );
  assert.equal(reviewResult.success, true);
  assert.equal(reviewResult.request.status, "APPROVED");
  assert.equal(reviewResult.request.allocated_amount, 3);

  // 10. Show updated capacity/status
  dashboard = await getDashboard(null);
  const updatedHospitalSector = dashboard.sectors.find((s) => s.id === "hospital_network");
  assert.ok(updatedHospitalSector);
  assert.ok(
    (updatedHospitalSector.allocatedCapacityMw ?? 0) >= 18 + 3,
    "Hospital sector received emergency allocation",
  );
  const totalAllocated = dashboard.sectors.reduce(
    (sum, s) => sum + (s.allocatedCapacityMw ?? 0),
    0,
  );
  assert.equal(totalAllocated, 48, "Reflects approved emergency surge (+3 MW for BMS Hospital)");

  // 11. Show incident timeline
  assert.ok(dashboard.incidentTimeline);
  assert.ok(dashboard.incidentTimeline.length >= 5);
  // Verify IST formatting
  for (const event of dashboard.incidentTimeline) {
    assert.match(event.timeIst, /^\d{2}:\d{2}$/, "Timeline events must display in HH:MM IST");
  }
  const approvalEvent = dashboard.incidentTimeline.find((e) =>
    e.title.includes("Allocation Approved") || e.description.includes("BMS Hospital"),
  );
  assert.ok(approvalEvent, "Timeline reflects dynamic authority approval");

  // 12. Reset demo
  const finalReset = inMemoryCrisisRepository.resetDemo();
  assert.equal(finalReset.success, true);
  assert.equal(finalReset.cityStatus, "STABLE");
  assert.equal(finalReset.activeIncidents, 0);

  const resetDashboard = await getDashboard(null);
  assert.equal(resetDashboard.cityStatus, "STABLE");
  assert.equal(resetDashboard.activeCrisis, "NONE");
  assert.equal(resetDashboard.activeIncidentsCount, 0);
  assert.equal(resetDashboard.resourceRequests!.length, 0);
  const baselineTotal = resetDashboard.sectors.reduce(
    (sum, s) => sum + (s.allocatedCapacityMw ?? 0),
    0,
  );
  assert.equal(baselineTotal, 45, "Baseline restored to 45.0 MW");
});
