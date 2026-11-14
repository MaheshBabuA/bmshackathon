export const AVAILABLE_CAPACITY_MW = 45;

export interface SectorDemand {
  id: string;
  name: string;
  demandMw: number;
  minimumSafeCapacityMw: number;
  maximumCapacityMw: number;
  priorityWeight: number;
}

export interface SectorAllocation {
  sectorId: string;
  allocatedCapacityMw: number;
}

export interface AllocationRecommendation {
  totalCapacityMw: number;
  items: SectorAllocation[];
}

export class AllocationError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_DEMAND" | "UNAVOIDABLE_SHORTAGE",
  ) {
    super(message);
    this.name = "AllocationError";
  }
}

const PRECISION = 1_000;

function toUnits(value: number): number {
  return Math.round(value * PRECISION);
}

export function recommendAllocation(
  sectors: readonly SectorDemand[],
  availableCapacityMw = AVAILABLE_CAPACITY_MW,
): AllocationRecommendation {
  const capacityUnits = toUnits(availableCapacityMw);

  if (!Number.isFinite(availableCapacityMw) || capacityUnits <= 0) {
    throw new AllocationError(
      "Available capacity must be a positive finite number.",
      "INVALID_DEMAND",
    );
  }
  if (sectors.length === 0 || new Set(sectors.map((sector) => sector.id)).size !== sectors.length) {
    throw new AllocationError(
      "At least one uniquely identified sector is required.",
      "INVALID_DEMAND",
    );
  }

  const allocation = sectors.map((sector) => {
    if (
      !Number.isFinite(sector.demandMw) ||
      !Number.isFinite(sector.minimumSafeCapacityMw) ||
      !Number.isFinite(sector.maximumCapacityMw) ||
      !Number.isFinite(sector.priorityWeight) ||
      sector.minimumSafeCapacityMw < 0 ||
      sector.demandMw < sector.minimumSafeCapacityMw ||
      sector.maximumCapacityMw < sector.minimumSafeCapacityMw ||
      sector.priorityWeight <= 0
    ) {
      throw new AllocationError(
        `Sector "${sector.id}" has invalid demand, safety floor, or priority weight.`,
        "INVALID_DEMAND",
      );
    }

    return {
      sector,
      minimum: toUnits(sector.minimumSafeCapacityMw),
      demand: toUnits(Math.min(sector.demandMw, sector.maximumCapacityMw)),
      allocated: toUnits(sector.minimumSafeCapacityMw),
    };
  });

  const minimumTotal = allocation.reduce((sum, item) => sum + item.minimum, 0);
  if (minimumTotal > capacityUnits) {
    throw new AllocationError(
      "Sector safety floors exceed available capacity; authority must explicitly address the unavoidable shortage.",
      "UNAVOIDABLE_SHORTAGE",
    );
  }

  let remaining = Math.min(
    capacityUnits,
    allocation.reduce((sum, item) => sum + item.demand, 0),
  ) - minimumTotal;

  while (remaining > 0) {
    const eligible = allocation.filter((item) => item.allocated < item.demand);
    if (eligible.length === 0) break;

    const totalWeight = eligible.reduce(
      (sum, item) => sum + item.sector.priorityWeight,
      0,
    );
    const roundBudget = remaining;
    const shares = eligible.map((item) => {
      const exactShare =
        (roundBudget * item.sector.priorityWeight) / totalWeight;
      const ceiling = item.demand - item.allocated;
      const share = Math.min(Math.floor(exactShare), ceiling);
      return {
        item,
        share,
        fraction: exactShare - Math.floor(exactShare),
        ceiling,
      };
    });

    let distributed = 0;
    for (const share of shares) {
      share.item.allocated += share.share;
      distributed += share.share;
    }

    let leftover = roundBudget - distributed;
    const byFraction = [...shares].sort(
      (left, right) =>
        right.fraction - left.fraction ||
        left.item.sector.id.localeCompare(right.item.sector.id),
    );
    for (const share of byFraction) {
      if (leftover === 0) break;
      if (share.item.allocated >= share.item.demand) continue;
      share.item.allocated += 1;
      leftover -= 1;
      distributed += 1;
    }

    if (distributed === 0) break;
    remaining -= distributed;
  }

  const items = allocation.map(({ sector, allocated }) => ({
    sectorId: sector.id,
    allocatedCapacityMw: allocated / PRECISION,
  }));
  const totalCapacityMw =
    allocation.reduce((sum, item) => sum + item.allocated, 0) / PRECISION;

  if (totalCapacityMw > availableCapacityMw) {
    throw new AllocationError(
      "Calculated allocation exceeds available emergency capacity.",
      "INVALID_DEMAND",
    );
  }

  return { totalCapacityMw, items };
}
