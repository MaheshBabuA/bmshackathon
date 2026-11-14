import test from "node:test";
import assert from "node:assert/strict";
import {
  CRISIS_SCENARIOS,
  InMemoryCrisisRepository,
} from "../services/in-memory-crisis-repository.js";
import {
  calculateDynamicAllocation,
  type DynamicAllocationInput,
} from "./dynamic-allocation.js";

test("CRISIS_SCENARIOS provides the 4 required disaster scenarios", () => {
  const keys = Object.keys(CRISIS_SCENARIOS);
  assert.ok(keys.includes("industrial_fire"), "industrial_fire scenario exists");
  assert.ok(keys.includes("urban_flood"), "urban_flood scenario exists");
  assert.ok(keys.includes("power_failure"), "power_failure scenario exists");
  assert.ok(keys.includes("hazmat"), "hazmat scenario exists");
});

test("industrial_fire scenario impacts calculate exact 45 MW allocation and respects safety floors", () => {
  const scenario = CRISIS_SCENARIOS.industrial_fire!;
  assert.equal(scenario.severity, "critical");

  const input: DynamicAllocationInput = {
    totalAvailableCapacityMw: 45,
    sectors: [
      {
        sectorId: "hospital_network",
        sectorName: "Hospital Network",
        currentAllocationMw: 18,
        baselineDemandMw: 18,
        minimumSafeCapacityMw: 15.5,
        maximumRequestedCapacityMw: 22,
        priorityWeight: 1.0,
        operationalFlexibility: 0.15,
        lifeCritical: true,
        incidentImpacts: scenario.impacts
          .filter((imp) => imp.sectorId === "hospital_network")
          .map((imp) => ({
            incidentId: "INC-SIM-TEST",
            incidentTitle: scenario.title,
            incidentType: scenario.incidentType,
            severity: scenario.severity,
            demandDeltaMw: imp.demandDeltaMw,
          })),
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
        incidentImpacts: scenario.impacts
          .filter((imp) => imp.sectorId === "water_infrastructure")
          .map((imp) => ({
            incidentId: "INC-SIM-TEST",
            incidentTitle: scenario.title,
            incidentType: scenario.incidentType,
            severity: scenario.severity,
            demandDeltaMw: imp.demandDeltaMw,
          })),
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
        incidentImpacts: scenario.impacts
          .filter((imp) => imp.sectorId === "telecommunications")
          .map((imp) => ({
            incidentId: "INC-SIM-TEST",
            incidentTitle: scenario.title,
            incidentType: scenario.incidentType,
            severity: scenario.severity,
            demandDeltaMw: imp.demandDeltaMw,
          })),
      },
      {
        sectorId: "emergency_operations",
        sectorName: "Emergency Operations",
        currentAllocationMw: 10,
        baselineDemandMw: 10,
        minimumSafeCapacityMw: 8,
        maximumRequestedCapacityMw: 15,
        priorityWeight: 1.0,
        operationalFlexibility: 0.3,
        lifeCritical: true,
        incidentImpacts: scenario.impacts
          .filter((imp) => imp.sectorId === "emergency_operations")
          .map((imp) => ({
            incidentId: "INC-SIM-TEST",
            incidentTitle: scenario.title,
            incidentType: scenario.incidentType,
            severity: scenario.severity,
            demandDeltaMw: imp.demandDeltaMw,
          })),
      },
    ],
  };

  const result = calculateDynamicAllocation(input);

  assert.equal(result.totalAllocated, 45, "total allocation must equal 45 MW");
  assert.equal(result.totalAvailableCapacity, 45, "total available must equal 45 MW");

  const hospital = result.sectors.find((s) => s.sectorId === "hospital_network")!;
  const water = result.sectors.find((s) => s.sectorId === "water_infrastructure")!;
  const telecom = result.sectors.find((s) => s.sectorId === "telecommunications")!;
  const ops = result.sectors.find((s) => s.sectorId === "emergency_operations")!;

  assert.equal(hospital.recommendedAllocation, 17, "Hospital recommended 17 MW");
  assert.equal(water.recommendedAllocation, 12, "Water recommended 12 MW");
  assert.equal(telecom.recommendedAllocation, 5, "Telecom recommended 5 MW");
  assert.equal(ops.recommendedAllocation, 11, "Emergency Operations recommended 11 MW");

  assert.ok(hospital.recommendedAllocation >= 15.5, "Hospital remains above 15.5 MW floor");
  assert.ok(water.recommendedAllocation >= 8, "Water remains above 8.0 MW floor");
  assert.ok(telecom.recommendedAllocation >= 4.5, "Telecom remains above 4.5 MW floor");
  assert.ok(ops.recommendedAllocation >= 8, "Emergency Ops remains above 8.0 MW floor");
});

test("InMemoryCrisisRepository starts in NORMAL OPERATIONS with 0 active incidents and 45 MW baseline", () => {
  const repo = new InMemoryCrisisRepository();
  const state = repo.getCommandCenterState();
  const incidents = repo.listIncidents();
  const sectors = repo.getSectors();

  assert.equal(state.city_status, "STABLE");
  assert.equal(state.active_crisis, "NONE");
  assert.equal(incidents.filter((i) => i.status === "active").length, 0);

  const baselineTotal = sectors.reduce((sum, s) => sum + s.baseline_demand_mw, 0);
  assert.equal(baselineTotal, 45);

  const hospital = sectors.find((s) => s.id === "hospital_network")!;
  const water = sectors.find((s) => s.id === "water_infrastructure")!;
  const telecom = sectors.find((s) => s.id === "telecommunications")!;
  const ops = sectors.find((s) => s.id === "emergency_operations")!;

  assert.equal(hospital.baseline_demand_mw, 18);
  assert.equal(water.baseline_demand_mw, 10);
  assert.equal(telecom.baseline_demand_mw, 7);
  assert.equal(ops.baseline_demand_mw, 10);
});

test("initiating simulation transitions to CRISIS ACTIVE and creates INC-SIM-XXXX incident", () => {
  const repo = new InMemoryCrisisRepository();
  const sim = repo.initiateSimulation("industrial_fire");

  assert.equal(sim.success, true);
  assert.match(sim.incidentCode, /^INC-SIM-\d{4}$/);
  assert.equal(sim.severity, "critical");
  assert.equal(sim.cityStatus, "CRISIS ACTIVE");
  assert.equal(sim.activeIncidents, 1);

  const state = repo.getCommandCenterState();
  assert.equal(state.city_status, "CRISIS ACTIVE");
  assert.equal(state.active_crisis, "Industrial Fire");

  const incidents = repo.listIncidents();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]!.status, "active");
  assert.equal(incidents[0]!.is_simulation, true);

  const plans = repo.getAllocationPlans();
  const recommended = plans.find((p) => p.status === "recommended");
  assert.ok(recommended, "Recommended allocation plan created");
  assert.equal(recommended.total_capacity_mw, 45);
});

test("resetDemo restores NORMAL OPERATIONS, resolves simulated incident, and resets baseline", () => {
  const repo = new InMemoryCrisisRepository();
  repo.initiateSimulation("industrial_fire");
  assert.equal(repo.listIncidents().filter((i) => i.status === "active").length, 1);

  const resetResult = repo.resetDemo();
  assert.equal(resetResult.success, true);
  assert.equal(resetResult.cityStatus, "STABLE");
  assert.equal(resetResult.activeIncidents, 0);

  const state = repo.getCommandCenterState();
  assert.equal(state.city_status, "STABLE");
  assert.equal(state.active_crisis, "NONE");
  assert.equal(state.active_incident_id, null);

  const activeIncidents = repo.listIncidents().filter((i) => i.status === "active");
  assert.equal(activeIncidents.length, 0);

  const sectors = repo.getSectors();
  const currentTotal = sectors.reduce((sum, s) => sum + s.current_allocation_mw, 0);
  assert.equal(currentTotal, 45);
});
