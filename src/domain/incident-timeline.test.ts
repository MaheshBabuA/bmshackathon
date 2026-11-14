import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTimeIst,
  generateIncidentTimeline,
  getDashboard,
} from "../services/crisis-service.js";
import { inMemoryCrisisRepository } from "../services/in-memory-crisis-repository.js";

test("formatTimeIst correctly formats dates in Indian Standard Time (UTC+5:30)", () => {
  // 08:50 UTC -> 14:20 IST
  const d = new Date("2026-11-14T08:50:00.000Z");
  const istStr = formatTimeIst(d);
  assert.equal(istStr, "14:20");
});

test("generateIncidentTimeline creates an incident-specific lifecycle timeline in IST", () => {
  inMemoryCrisisRepository.initiateSimulation("industrial_fire");
  const incident = inMemoryCrisisRepository.getActiveIncident();
  assert.ok(incident);
  const impacts = inMemoryCrisisRepository.getIncidentImpacts();
  const requests = inMemoryCrisisRepository.listResourceRequests(incident.id);
  const plans = inMemoryCrisisRepository.getAllocationPlans();
  const activePlan = plans.find((p) => p.status === "approved");

  const timeline = generateIncidentTimeline(incident, impacts, requests, activePlan);
  assert.ok(timeline.length >= 6);

  // Event 1: Crisis Detected
  assert.equal(timeline[0]!.title, "Crisis Detected");
  assert.equal(timeline[0]!.category, "crisis");
  assert.equal(timeline[0]!.categoryLabel, "WHAT HAPPENED");
  assert.match(timeline[0]!.timeIst, /^\d{2}:\d{2}$/);
  assert.ok(timeline[0]!.description.includes("Industrial Fire"));

  // Event 2: Impact Assessment Completed
  assert.equal(timeline[1]!.title, "Impact Assessment Completed");
  assert.equal(timeline[1]!.category, "crisisgrid");
  assert.equal(timeline[1]!.categoryLabel, "CRISISGRID ACTION");

  // Event 3: Critical Infrastructure Identified
  assert.equal(timeline[2]!.title, "Critical Infrastructure Identified");
  assert.equal(timeline[2]!.category, "crisisgrid");

  // Event 4: Resource Request
  assert.ok(timeline[3]!.title.includes("Requested +3 MW"));
  assert.equal(timeline[3]!.category, "crisis");
  assert.equal(timeline[3]!.categoryLabel, "WHAT HAPPENED");

  // Event 5: Authority Review Started
  assert.equal(timeline[4]!.title, "Authority Review Started");
  assert.equal(timeline[4]!.category, "authority");

  // Event 6: Awaiting Authority Decision (when pending)
  assert.equal(timeline[5]!.title, "Awaiting Authority Decision");
  assert.equal(timeline[5]!.category, "authority");
  assert.equal(timeline[5]!.status, "active");
});

test("authority approval dynamically updates timeline with Allocation Approved and Emergency Capacity Activated", () => {
  inMemoryCrisisRepository.initiateSimulation("industrial_fire");
  const incident = inMemoryCrisisRepository.getActiveIncident()!;
  const requests = inMemoryCrisisRepository.listResourceRequests(incident.id);
  const bmsReq = requests.find((r) => r.organization_name === "BMS Hospital")!;

  // Approve the request
  inMemoryCrisisRepository.reviewResourceRequest(
    bmsReq.id,
    "APPROVE",
    3,
    "Approved by municipal authority",
    "Disaster Coordinator",
  );

  const updatedReqs = inMemoryCrisisRepository.listResourceRequests(incident.id);
  const timeline = generateIncidentTimeline(
    incident,
    inMemoryCrisisRepository.getIncidentImpacts(),
    updatedReqs,
    null,
  );

  const approvalEvent = timeline.find((e) => e.title === "Allocation Approved");
  assert.ok(approvalEvent, "Allocation Approved event exists");
  assert.equal(approvalEvent.category, "authority");
  assert.equal(approvalEvent.categoryLabel, "AUTHORITY DECISION");
  assert.ok(approvalEvent.description.includes("+3 MW to BMS Hospital"));

  const activatedEvent = timeline.find((e) => e.title === "Emergency Capacity Activated");
  assert.ok(activatedEvent, "Emergency Capacity Activated event exists");
  assert.equal(activatedEvent.category, "crisisgrid");
  assert.equal(activatedEvent.categoryLabel, "CRISISGRID ACTION");
  assert.ok(activatedEvent.description.includes("+3 MW capacity dispatched"));
});

test("authority modification dynamically updates timeline with modified amount", () => {
  inMemoryCrisisRepository.initiateSimulation("industrial_fire");
  const incident = inMemoryCrisisRepository.getActiveIncident()!;
  const requests = inMemoryCrisisRepository.listResourceRequests(incident.id);
  const bmsReq = requests.find((r) => r.organization_name === "BMS Hospital")!;

  // Modify the request to 2.5 MW
  inMemoryCrisisRepository.reviewResourceRequest(
    bmsReq.id,
    "MODIFY",
    2.5,
    "Modified to 2.5 MW",
    "Disaster Coordinator",
  );

  const updatedReqs = inMemoryCrisisRepository.listResourceRequests(incident.id);
  const timeline = generateIncidentTimeline(
    incident,
    inMemoryCrisisRepository.getIncidentImpacts(),
    updatedReqs,
    null,
  );

  const modEvent = timeline.find((e) => e.title === "Allocation Modified & Approved");
  assert.ok(modEvent, "Allocation Modified & Approved event exists");
  assert.ok(modEvent.description.includes("+2.5 MW to BMS Hospital"));
});

test("authority rejection updates timeline with Request Rejected", () => {
  inMemoryCrisisRepository.initiateSimulation("industrial_fire");
  const incident = inMemoryCrisisRepository.getActiveIncident()!;
  const requests = inMemoryCrisisRepository.listResourceRequests(incident.id);
  const bmsReq = requests.find((r) => r.organization_name === "BMS Hospital")!;

  // Reject the request
  inMemoryCrisisRepository.reviewResourceRequest(
    bmsReq.id,
    "REJECT",
    0,
    "Safeguard safety floors",
    "Disaster Coordinator",
  );

  const updatedReqs = inMemoryCrisisRepository.listResourceRequests(incident.id);
  const timeline = generateIncidentTimeline(
    incident,
    inMemoryCrisisRepository.getIncidentImpacts(),
    updatedReqs,
    null,
  );

  const rejEvent = timeline.find((e) => e.title === "Request Rejected by Authority");
  assert.ok(rejEvent, "Request Rejected by Authority event exists");
  assert.ok(rejEvent.description.includes("rejected additional capacity request"));
});

test("different crisis scenarios produce scenario-specific timeline events", () => {
  // Urban Flood
  inMemoryCrisisRepository.initiateSimulation("urban_flood");
  const floodInc = inMemoryCrisisRepository.getActiveIncident()!;
  const floodTimeline = generateIncidentTimeline(
    floodInc,
    inMemoryCrisisRepository.getIncidentImpacts(),
    inMemoryCrisisRepository.listResourceRequests(floodInc.id),
    null,
  );
  assert.ok(floodTimeline[0]!.description.includes("Severe Urban Flooding") || floodTimeline[0]!.description.includes("Flood"));
  assert.ok(floodTimeline[3]!.title.includes("Water Pumping"));

  // Power Failure
  inMemoryCrisisRepository.initiateSimulation("power_failure");
  const powerInc = inMemoryCrisisRepository.getActiveIncident()!;
  const powerTimeline = generateIncidentTimeline(
    powerInc,
    inMemoryCrisisRepository.getIncidentImpacts(),
    inMemoryCrisisRepository.listResourceRequests(powerInc.id),
    null,
  );
  assert.ok(powerTimeline[0]!.description.includes("Substation Failure") || powerTimeline[0]!.description.includes("Power"));
  assert.ok(powerTimeline[3]!.title.includes("Hospital Feeder") || powerTimeline[3]!.title.includes("BMS Hospital"));

  // Hazmat
  inMemoryCrisisRepository.initiateSimulation("hazmat");
  const hazmatInc = inMemoryCrisisRepository.getActiveIncident()!;
  const hazmatTimeline = generateIncidentTimeline(
    hazmatInc,
    inMemoryCrisisRepository.getIncidentImpacts(),
    inMemoryCrisisRepository.listResourceRequests(hazmatInc.id),
    null,
  );
  assert.ok(hazmatTimeline[0]!.description.includes("Hazardous Material"));
});

test("getDashboard includes incidentTimeline in both crisis and normal states", async () => {
  inMemoryCrisisRepository.resetDemo();
  const normalDashboard = await getDashboard(null);
  assert.ok(Array.isArray(normalDashboard.incidentTimeline));
  assert.ok(normalDashboard.incidentTimeline.length > 0);
  assert.equal(normalDashboard.incidentTimeline![0]!.title, "Municipal Grid Baseline Active");

  inMemoryCrisisRepository.initiateSimulation("industrial_fire");
  const crisisDashboard = await getDashboard(null);
  assert.ok(Array.isArray(crisisDashboard.incidentTimeline));
  assert.equal(crisisDashboard.incidentTimeline![0]!.title, "Crisis Detected");
});
