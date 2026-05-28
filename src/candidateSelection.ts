import type { PassListItem, TrainStationBoardEntry } from "./index";
import { getStationRouteCount } from "./stopRoutes";

/** One candidate = one (train × destination-stop) tuple */
export type JourneyCandidate = {
  train: TrainStationBoardEntry;
  stop: PassListItem;
  /** Position in passList (0 = departure stop, excluded). Used as distance proxy. */
  stopIndex: number;
};

/**
 * Deduplicate candidates by destination, keeping only the earliest valid departure.
 *
 * Key distinction: Candidates are filtered first based on min/max idle duration constraints,
 * then by minimum station route count. Only candidates with valid wait times 
 * (within [minIdleDuration, maxIdleDuration]) and sufficient destination connectivity
 * are considered for grouping. Then, for each destination, only the earliest valid departure
 * is kept.
 *
 * @param candidates - All candidates from buildCandidates()
 * @param minIdleDuration - Minimum idle time (minutes) — departures before this threshold are filtered
 * @param maxIdleDuration - Maximum idle time (minutes) — departures after this threshold are filtered
 * @param minStationRouteCount - Minimum number of unique routes connected to destination station
 * @param referenceTimestamp - Reference time in seconds (Unix-like). Used to calculate idle duration.
 * @returns Deduplicated candidates with at most one candidate per destination
 */
export function deduplicateCandidatesByDestination(
  candidates: JourneyCandidate[],
  minIdleDuration: number,
  maxIdleDuration: number,
  minStationRouteCount: number,
  referenceTimestamp: number | null,
): JourneyCandidate[] {
  if (!referenceTimestamp) {
    // If no reference time, can't calculate wait duration, so group by destination without filtering
    // console.debug(`[Dedup] No referenceTimestamp provided, grouping ${candidates.length} candidates by destination without idle filter`);
    return filterByDestination(candidates, minStationRouteCount);
  }

  const candidateDetails = candidates.map((candidate, idx) => {
    const departureTs = candidate.train.stop.departureTimestamp;
    const idleMinutes = typeof departureTs === "number" ? (departureTs - referenceTimestamp) / 60 : null;
    const passesIdleFilter = typeof departureTs === "number" && idleMinutes !== null && idleMinutes >= minIdleDuration && idleMinutes <= maxIdleDuration;
    
    return {
      idx,
      trainNumber: candidate.train.number,
      category: candidate.train.category,
      destination: candidate.stop.station?.name,
      destinationId: candidate.stop.station?.id,
      departure: candidate.train.stop.departure,
      departureTs,
      departureTs_type: typeof departureTs,
      idleMinutes: idleMinutes ? Number(idleMinutes.toFixed(1)) : null,
      passesIdleFilter,
      filterReason: !passesIdleFilter 
        ? (typeof departureTs !== "number" 
          ? `invalid type: ${typeof departureTs}` 
          : (idleMinutes === null ? "invalid idle calc" : `idle ${idleMinutes.toFixed(1)}m outside [${minIdleDuration}, ${maxIdleDuration}]`))
        : "pass"
    };
  });

  // console.debug(`[Dedup] Pre-filter analysis (referenceTs=${referenceTimestamp}, window=[${minIdleDuration}, ${maxIdleDuration}] min):`, candidateDetails);
  
  // Log breakdown of why candidates are failing
  const passingCount = candidateDetails.filter(c => c.passesIdleFilter).length;
  const failingByReason = new Map<string, number>();
  for (const detail of candidateDetails.filter(c => !c.passesIdleFilter)) {
    failingByReason.set(detail.filterReason, (failingByReason.get(detail.filterReason) ?? 0) + 1);
  }
  // console.debug(`[Dedup] Idle filter breakdown: ${passingCount} passing, failures by reason:`, Object.fromEntries(failingByReason));
  
  if (passingCount === 0) {
    // Show sample candidates to debug the structure issue
    // console.warn(`[Dedup] ALERT: 0 candidates passing idle filter. Showing first 3 candidates for structure inspection:`, candidateDetails.slice(0, 3));
  }

  // Filter by idle duration constraints first
  const validCandidates = candidates.filter((candidate) => {
    const departureTs = candidate.train.stop.departureTimestamp;
    if (typeof departureTs !== "number") {
      return false;
    }

    const idleMinutes = (departureTs - referenceTimestamp) / 60;

    // Hard filter: idle duration must be within [min, max] window
    if (idleMinutes < minIdleDuration || idleMinutes > maxIdleDuration) {
      return false;
    }

    return true;
  });

  // console.debug(`[Dedup] After idle filter: ${validCandidates.length}/${candidates.length} candidates remain`);

  // Group valid candidates by destination and keep earliest
  const dedupResult = filterByDestination(validCandidates, minStationRouteCount);
  // console.debug(`[Dedup] After destination deduplication: ${dedupResult.length} candidates`, 
  //   dedupResult.map(c => ({
  //     train: c.train.number,
  //     category: c.train.category,
  //     destination: c.stop.station?.name,
  //     departure: c.train.stop.departure
  //   }))
  // );

  return dedupResult;
}

/**
 * Helper: Group candidates by destination and keep only the earliest departure for each.
 * Also filters by minimum station route count.
 */
function filterByDestination(candidates: JourneyCandidate[], minStationRouteCount: number): JourneyCandidate[] {
  const byDestination = new Map<string | undefined, JourneyCandidate>();
  const destinationCounts = new Map<string | undefined, number>();

  for (const candidate of candidates) {
    const destinationId = candidate.stop.station?.id;
    const destinationName = candidate.stop.station?.name;
    
    // Check if destination meets minimum route count requirement
    const routeCount = getStationRouteCount(destinationName);
    if (routeCount < minStationRouteCount) {
      continue; // Skip this candidate if destination doesn't have enough routes
    }

    destinationCounts.set(destinationId, (destinationCounts.get(destinationId) ?? 0) + 1);

    if (!byDestination.has(destinationId)) {
      byDestination.set(destinationId, candidate);
    } else {
      const existing = byDestination.get(destinationId)!;
      const existingDeparture = existing.train.stop.departure;
      const newDeparture = candidate.train.stop.departure;

      // Keep earliest departure (lexicographically for ISO 8601 strings, or by timestamp)
      if (newDeparture < existingDeparture) {
        byDestination.set(destinationId, candidate);
      }
    }
  }

  // console.debug(`[FilterByDestination] Grouping analysis:`, {
  //   inputCandidates: candidates.length,
  //   uniqueDestinations: byDestination.size,
  //   destinationGroupSizes: Array.from(destinationCounts.entries()).map(([destId, count]) => ({
  //     destinationId: destId,
  //     candidateCount: count,
  //     kept: byDestination.get(destId)?.train.number,
  //   })),
  // });

  return Array.from(byDestination.values());
}
