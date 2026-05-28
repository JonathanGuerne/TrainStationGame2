import { deduplicateCandidatesByDestination } from "./candidateSelection";
import type {
  Coordinate,
  PassListItem,
  TrainStation,
  TrainStationBoardEntry,
} from "./index";

export type HyperparamsData = {
  minJourneyLegDistance: number;
  journeyLegDistanceFactor: number;
  minIdleDuration: number;
  maxIdleDuration: number;
  idleDurationFactor: number;
  uniqueTrainFactor: number;
  uniqueMeanOfTransportFactor: number;
  alreadyVisitedLegFactor: number;
  alreadySteppedInFactor: number;
  preferredCategoryFactor: number;
  shortJourneyLegPenalty: number;
  minimumLegDurationPenalty: number;
  stationboardLimit: number;
  minimumLegDuration: number;
};

export type SimulationConfig = {
  startStationName: string;
  startStationId: string;
  startTime: string;
  endTime: string;
  hyperparams: HyperparamsData;
};

export type JourneyCandidate = {
  train: TrainStationBoardEntry;
  stop: PassListItem;
  stopIndex: number;
};

export type SimulationLeg = {
  departure_station_name: string;
  departure_station_id: string;
  arrival_station_name: string;
  arrival_station_id: string;
  train_line: string;
  train_number: string;
  train_category: string;
  departure_time: string;
  arrival_time: string;
  platform_departure: string | null;
  platform_arrival: string | null;
  wait_time_minutes: number | null;
  duration_minutes: number | null;
  leg_distance_km: number | null;
  cumulative_distance_km: number;
  selection_weight: number;
  visited_before: boolean;
  num_trains_available: number;
  stop_index_in_route: number;
};

type TrainStationResponse = {
  stations?: TrainStation[];
};

type StationBoardResponse = {
  stationboard?: TrainStationBoardEntry[];
};

type SimulationState = {
  visited_station_ids: Set<string>;
  used_train_numbers: Set<string>;
  used_transport_categories: Set<string>;
  visited_legs: Set<string>;
};

const API_DELAY_MS = 500;
const MAX_SELECTION_ATTEMPTS = 5;
const PREFERRED_CATEGORIES = ["IC", "ICE", "IR", "EC", "TGV", "RE", "RJX"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function convertTime(dateTime: string): string {
  const match = dateTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]} ${match[2]}:${match[3]}`;
  }

  const parsed = parseIsoDate(dateTime);
  if (!parsed) {
    throw new Error(`Invalid ISO datetime: ${dateTime}`);
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp);
}

function extractZurichTime(isoString: string): string {
  const match = isoString.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):?(\d{2})?/,
  );
  if (match) {
    return `${match[1]} ${match[2]}:${match[3]}`;
  }
  return isoString;
}

function diffMinutes(
  fromDateTime: string | null | undefined,
  toDateTime: string | null | undefined,
): number | null {
  if (!fromDateTime || !toDateTime) {
    return null;
  }

  const from = parseIsoDate(fromDateTime);
  const to = parseIsoDate(toDateTime);
  if (!from || !to) {
    return null;
  }

  return Math.round(((to.getTime() - from.getTime()) / 60000) * 10) / 10;
}

function getCoordinates(
  station: { coordinate?: Coordinate | null } | null | undefined,
): [number, number] | null {
  const coordinate = station?.coordinate;
  if (!coordinate) {
    return null;
  }

  return [coordinate.x, coordinate.y];
}

function getLegKey(
  fromId: string | null | undefined,
  toId: string | null | undefined,
): string {
  return `${fromId ?? ""}->${toId ?? ""}`;
}

function getTrainLine(train: TrainStationBoardEntry): string {
  const base = [train.category, train.number].filter(Boolean).join(" ").trim();
  return train.to ? `${base} to ${train.to}` : base;
}

function validateRouteChoice(
  waitTimeMinutes: number | null,
  arrivalStationId: string,
  visitedStationIds: Set<string>,
  hyperparams: HyperparamsData,
): boolean {
  // Allow null wait times (instant/no wait transfers) - don't reject

  // Check if arrival station has already been visited
  if (visitedStationIds.has(arrivalStationId)) {
    return false;
  }

  // Relaxed idle duration check: prefer within range but don't strictly reject outside it
  // This allows some flexibility for valid journeys
  if (waitTimeMinutes !== null) {
    // Hard reject if wait time is excessively long (> 120 mins)
    if (waitTimeMinutes > 120) {
      return false;
    }
  }

  return true;
}

function findMatchingStation(
  stations: TrainStation[],
  stationId: string,
  stationName: string,
): TrainStation | undefined {
  return (
    stations.find((station) => station.id === stationId) ??
    stations.find(
      (station) => station.name.toLowerCase() === stationName.toLowerCase(),
    ) ??
    stations[0]
  );
}

export async function fetchTrainStationByName(
  stationName: string,
): Promise<TrainStation[]> {
  const params = new URLSearchParams({ query: stationName });
  const response = await fetch(
    `https://transport.opendata.ch/v1/locations?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch train stations for ${stationName}.`);
  }

  const data = (await response.json()) as TrainStationResponse;
  return (data.stations ?? []).filter((station) => station.icon === "train");
}

export async function fetchStationBoard(
  stationId: string,
  dateTime: string,
  limit: number = 10,
): Promise<TrainStationBoardEntry[]> {
  const params = new URLSearchParams({
    id: stationId,
    limit: limit.toString(),
    datetime: convertTime(dateTime),
  });
  const response = await fetch(
    `https://transport.opendata.ch/v1/stationboard?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch stationboard for station ${stationId}.`);
  }

  const data = (await response.json()) as StationBoardResponse;
  return data.stationboard ?? [];
}

export function deduplicateStationBoard(
  stationboard: TrainStationBoardEntry[],
  currentTime: string,
  minIdleDuration: number = 0,
  maxIdleDuration: number = Number.POSITIVE_INFINITY,
): TrainStationBoardEntry[] {
  // Step 1: Filter by idle duration window
  const validByIdleWindow = stationboard.filter((train) => {
    const waitTime = diffMinutes(currentTime, train.stop.departure);
    
    // Allow null (instant transfers), or within the window
    if (waitTime === null) {
      return true; // No wait time info, include it
    }
    
    // Must be non-negative (not in the past) and within window
    if (waitTime < 0) {
      return false; // Already departed
    }
    if (waitTime < minIdleDuration) {
      return false; // Too soon
    }
    if (waitTime > maxIdleDuration) {
      return false; // Too late
    }
    
    return true;
  });

  // console.debug(`[DedupStationBoard] Idle window filter [${minIdleDuration}, ${maxIdleDuration}] min: ${stationboard.length} → ${validByIdleWindow.length} trains`);

  // Step 2: Deduplicate by category::number::destination
  const seen = new Map<string, TrainStationBoardEntry>();

  for (const train of validByIdleWindow) {
    // Create a unique key from category, number, and destination
    const key = `${train.category}::${train.number}::${train.to ?? ""}`;

    if (!seen.has(key)) {
      // First occurrence: add it
      seen.set(key, train);
    } else {
      // Subsequent occurrence: keep the earliest departure
      const currentEntry = seen.get(key)!;
      const currentDeparture = currentEntry.stop.departure;
      const newDeparture = train.stop.departure;

      // Keep earliest departure (lexicographically for ISO 8601 strings works)
      if (newDeparture < currentDeparture) {
        seen.set(key, train);
      }
    }
  }

  // console.debug(`[DedupStationBoard] Destination dedup: ${validByIdleWindow.length} → ${seen.size} trains`);
  return Array.from(seen.values());
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(3));
}

export function buildCandidates(
  stationboard: TrainStationBoardEntry[],
  _passList?: PassListItem[],
): JourneyCandidate[] {
  const candidates: JourneyCandidate[] = [];
  const skippedTrains: { trainNum: string; reason: string }[] = [];
  const candidateDebugInfo: Array<{
    trainNum: string;
    depTs: unknown;
    depStr: string;
  }> = [];

  for (const train of stationboard) {
    if (train.passList.length < 2) {
      skippedTrains.push({
        trainNum: train.number,
        reason: `passlist too short (${train.passList.length})`,
      });
      continue;
    }

    let trainCandidateCount = 0;
    for (let i = 1; i < train.passList.length; i += 1) {
      const stop = train.passList[i];
      if (!stop?.arrival || !stop.station?.id) {
        continue;
      }

      candidates.push({ train, stop, stopIndex: i });
      candidateDebugInfo.push({
        trainNum: train.number,
        depTs: train.stop.departureTimestamp,
        depStr: train.stop.departure,
      });
      trainCandidateCount++;
    }

    if (trainCandidateCount === 0) {
      skippedTrains.push({
        trainNum: train.number,
        reason: "no valid stops (missing arrival or station id)",
      });
    }
  }

  if (skippedTrains.length > 0) {
    // console.debug(`[BuildCandidates] Skipped trains:`, skippedTrains);
  }

  // Show sample of departure timestamps
  // console.debug(
  //   `[BuildCandidates] Candidate departure timestamps sample:`,
  //   candidateDebugInfo.slice(0, 5),
  // );
  // console.debug(
  //   `[BuildCandidates] Built ${candidates.length} total candidates from ${stationboard.length} trains (${skippedTrains.length} skipped)`,
  // );

  return candidates;
}

export function computeWeight(
  candidate: JourneyCandidate,
  state: SimulationState,
  currentTime: string,
  hyperparams: HyperparamsData,
): number {
  const { train, stop, stopIndex } = candidate;

  if (stopIndex < hyperparams.minJourneyLegDistance) {
    return 0;
  }

  const destinationId = stop.station.id;
  if (destinationId && state.visited_station_ids.has(destinationId)) {
    return 0;
  }

  const waitTimeMinutes = diffMinutes(currentTime, train.stop.departure);
  if (waitTimeMinutes !== null && waitTimeMinutes < 0) {
    return 0;
  }

  // Hard filter: idle duration must be within [min, max] window
  if (waitTimeMinutes !== null) {
    if (
      waitTimeMinutes < hyperparams.minIdleDuration ||
      waitTimeMinutes > hyperparams.maxIdleDuration
    ) {
      return 0;
    }
  }

  let weight = 1;
  const extraStops = stopIndex - hyperparams.minJourneyLegDistance;
  weight *= 1 + extraStops * hyperparams.journeyLegDistanceFactor;

  // Penalize very short journey legs (1-2 stops) more heavily, moderated by distance
  if (stopIndex <= 2) {
    const departureCoord = train.passList[0]?.station?.coordinate;
    const arrivalCoord = stop.station?.coordinate;
    const legDistanceKm =
      departureCoord && arrivalCoord
        ? haversineKm(
            departureCoord.x,
            departureCoord.y,
            arrivalCoord.x,
            arrivalCoord.y,
          )
        : 0;

    const distanceFactor = Math.max(0, 1 - legDistanceKm / 100);
    weight *= Math.max(
      0.1,
      1 - hyperparams.shortJourneyLegPenalty * distanceFactor,
    );
  }

  // Penalize very short duration legs (< minimumLegDuration)
  const trainDeparture = train.stop.departure;
  const legArrival = stop.arrival;
  if (trainDeparture && legArrival) {
    const durationMinutes = diffMinutes(trainDeparture, legArrival);
    if (
      durationMinutes !== null &&
      durationMinutes < hyperparams.minimumLegDuration
    ) {
      weight *= Math.max(0.1, 1 - hyperparams.minimumLegDurationPenalty);
    }
  }

  if (waitTimeMinutes !== null && hyperparams.idleDurationFactor > 0) {
    const range = hyperparams.maxIdleDuration - hyperparams.minIdleDuration;
    const normalized =
      range <= 0
        ? 1
        : Math.max(
            0,
            1 - (waitTimeMinutes - hyperparams.minIdleDuration) / range,
          );
    weight *= 1 + normalized * hyperparams.idleDurationFactor;
  }

  if (!state.used_train_numbers.has(train.number)) {
    weight *= 1 + hyperparams.uniqueTrainFactor;
  }

  if (!state.used_transport_categories.has(train.category)) {
    weight *= 1 + hyperparams.uniqueMeanOfTransportFactor;
  }

  if (PREFERRED_CATEGORIES.includes(train.category)) {
    weight *= 1 + hyperparams.preferredCategoryFactor;
  }

  const fromId = train.passList[0]?.station?.id ?? "";
  const legKey = getLegKey(fromId, destinationId);
  if (state.visited_legs.has(legKey)) {
    weight *= hyperparams.alreadyVisitedLegFactor;
  }

  return Math.max(weight, 0);
}

export function weightedRandomPick<T>(items: T[], weights: number[]): T {
  if (items.length === 0 || items.length !== weights.length) {
    throw new Error(
      "Items and weights must be non-empty and have matching lengths.",
    );
  }

  const totalWeight = weights.reduce(
    (sum, weight) => sum + Math.max(weight, 0),
    0,
  );
  if (totalWeight === 0) {
    throw new Error(
      "All candidates have zero weight — no valid journey possible.",
    );
  }

  let randomValue = Math.random() * totalWeight;
  let fallback: T | undefined;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const weight = Math.max(weights[i] ?? 0, 0);

    if (item === undefined || weight <= 0) {
      continue;
    }

    fallback = item;
    randomValue -= weight;
    if (randomValue <= 0) {
      return item;
    }
  }

  if (fallback === undefined) {
    throw new Error("No candidate available for weighted selection.");
  }

  return fallback;
}

export async function runSimulation(
  config: SimulationConfig,
): Promise<SimulationLeg[]> {
  const legs: SimulationLeg[] = [];
  const endTime = parseIsoDate(config.endTime);
  if (!endTime) {
    return legs;
  }

  // console.debug(`[Simulation] Starting with config:`, {
  //   startStation: { name: config.startStationName, id: config.startStationId },
  //   timeWindow: { start: config.startTime, end: config.endTime },
  //   hyperparams: config.hyperparams,
  // });

  const state: SimulationState = {
    visited_station_ids: new Set(
      config.startStationId ? [config.startStationId] : [],
    ),
    used_train_numbers: new Set(),
    used_transport_categories: new Set(),
    visited_legs: new Set(),
  };

  let currentStationName = config.startStationName;
  let currentStationId = config.startStationId;
  let currentTime = config.startTime;
  let currentReferenceTimestamp: number | null = null;
  let currentCoordinates: [number, number] | null = null;
  let cumulativeDistanceKm = 0;

  try {
    const stations = await fetchTrainStationByName(config.startStationName);
    const matchedStation = findMatchingStation(
      stations,
      config.startStationId,
      config.startStationName,
    );
    currentCoordinates = getCoordinates(matchedStation);
    await sleep(API_DELAY_MS);
  } catch {
    currentCoordinates = null;
  }

  let iterationCount = 0;
  while (true) {
    iterationCount++;
    const currentDate = parseIsoDate(currentTime);
    if (!currentDate || currentDate >= endTime) {
      break;
    }

    // Calculate reference timestamp (in seconds) for deduplication
    currentReferenceTimestamp = Math.floor(currentDate.getTime() / 1000);

    // console.debug(`[Iteration ${iterationCount}] Timestamp validation:`, {
    //   currentTime,
    //   parsedDate: currentDate.toISOString(),
    //   referenceTimestamp: currentReferenceTimestamp,
    //   referenceTimestampDate: new Date(
    //     currentReferenceTimestamp * 1000,
    //   ).toISOString(),
    //   endTime,
    //   withinTimeWindow: currentDate < endTime,
    // });

    try {
      let stationboard = await fetchStationBoard(
        currentStationId,
        currentTime,
        config.hyperparams.stationboardLimit,
      );

      // console.debug(
      //   `[Iteration ${iterationCount}] Stationboard fetched (pre-dedup):`,
      //   {
      //     count: stationboard.length,
      //     currentStationId,
      //     currentTime,
      //     trains: stationboard.map((train) => ({
      //       number: train.number,
      //       category: train.category,
      //       to: train.to,
      //       departure: train.stop.departure,
      //       departureTimestamp: train.stop.departureTimestamp,
      //       passListLength: train.passList.length,
      //     })),
      //   },
      // );

      stationboard = deduplicateStationBoard(
        stationboard,
        currentTime,
        config.hyperparams.minIdleDuration,
        config.hyperparams.maxIdleDuration,
      );
      const numTrainsAvailable = stationboard.length;

      // console.debug(`[Iteration ${iterationCount}] Stationboard fetched:`, {
      //   count: numTrainsAvailable,
      //   currentStationId,
      //   currentTime,
      //   trains: stationboard.map((train) => ({
      //     number: train.number,
      //     category: train.category,
      //     to: train.to,
      //     departure: train.stop.departure,
      //     departureTimestamp: train.stop.departureTimestamp,
      //     passListLength: train.passList.length,
      //   })),
      // });

      if (numTrainsAvailable === 0) {
        // console.warn(
        //   `[Iteration ${iterationCount}] No trains available at station ${currentStationId} at ${currentTime}`,
        // );
        break;
      }

      const candidates = buildCandidates(stationboard);
      if (candidates.length === 0) {
        // console.warn(
        //   `[Iteration ${iterationCount}] No valid candidates built from ${numTrainsAvailable} trains`,
        // );
        break;
      }

      const beforeDedup = candidates.length;
      const dedupCandidates = deduplicateCandidatesByDestination(
        candidates,
        config.hyperparams.minIdleDuration,
        config.hyperparams.maxIdleDuration,
        currentReferenceTimestamp,
      );

      if (dedupCandidates.length === 0) {
        // console.warn(
        //   `[Iteration ${iterationCount}] CRITICAL: Deduplication filtered from ${beforeDedup} to 0 candidates`,
        //   {
        //     currentTime,
        //     currentStationId,
        //     currentStationName,
        //     referenceTimestamp: currentReferenceTimestamp,
        //     minIdleDuration: config.hyperparams.minIdleDuration,
        //     maxIdleDuration: config.hyperparams.maxIdleDuration,
        //     hyperparams: config.hyperparams,
        //   },
        // );

        // Debug: Show full stationboard when zero candidates
        // console.warn(
        //   `[Iteration ${iterationCount}] FULL STATIONBOARD (${stationboard.length} trains):`,
        //   stationboard.map((train) => ({
        //     number: train.number,
        //     category: train.category,
        //     to: train.to,
        //     departure: train.stop.departure,
        //     departureTimestamp: train.stop.departureTimestamp,
        //     passListLength: train.passList.length,
        //     passList: train.passList.slice(0, 5).map((stop, idx) => ({
        //       stopIdx: idx,
        //       station: stop.station?.name,
        //       arrival: stop.arrival,
        //       departure: stop.departure,
        //       departureTimestamp: stop.departureTimestamp,
        //     })),
        //   })),
        // );
      } else {
        // console.debug(
        //   `[Iteration ${iterationCount}] Deduplication filtered from ${beforeDedup} to ${dedupCandidates.length} candidates by destination`,
        //   {
        //     minIdleDuration: config.hyperparams.minIdleDuration,
        //     maxIdleDuration: config.hyperparams.maxIdleDuration,
        //     referenceTimestamp: currentReferenceTimestamp,
        //     currentTime,
        //     candidateDetails: dedupCandidates.map((c) => ({
        //       trainNumber: c.train.number,
        //       category: c.train.category,
        //       destination: c.stop.station?.name,
        //       destinationId: c.stop.station?.id,
        //       departureTime: c.train.stop.departure,
        //       stopIndex: c.stopIndex,
        //     })),
        //   },
        // );
      }

      const weights = dedupCandidates.map((candidate, idx) => {
        const weight = computeWeight(
          candidate,
          state,
          currentTime,
          config.hyperparams,
        );
        if (weight <= 0) {
          // console.debug(
          //   `[Iteration ${iterationCount}] Candidate ${idx} has zero weight:`,
          //   {
          //     train: candidate.train.number,
          //     destination: candidate.stop.station?.name,
          //     stopIndex: candidate.stopIndex,
          //     destination_already_visited: state.visited_station_ids.has(
          //       candidate.stop.station?.id ?? "",
          //     ),
          //     arrival: candidate.stop.arrival,
          //   },
          // );
        }
        return weight;
      });

      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      if (totalWeight <= 0) {
        // console.warn(
        //   `[Iteration ${iterationCount}] All ${dedupCandidates.length} candidates have zero weight at station ${currentStationId}`,
        //   {
        //     stationId: currentStationId,
        //     stationName: currentStationName,
        //     currentTime,
        //     visitedStationCount: state.visited_station_ids.size,
        //     weights: weights.map((w, idx) => ({
        //       candidateIdx: idx,
        //       train: dedupCandidates[idx]?.train.number,
        //       destination: dedupCandidates[idx]?.stop.station?.name,
        //       weight: w,
        //     })),
        //   },
        // );
        break;
      }

      let routeFound = false;
      let attempts = 0;

      while (attempts < MAX_SELECTION_ATTEMPTS) {
        const currentTotalWeight = weights.reduce(
          (sum, weight) => sum + weight,
          0,
        );
        if (currentTotalWeight <= 0) {
          break;
        }

        const selectedCandidate = weightedRandomPick(dedupCandidates, weights);
        const selectedIndex = dedupCandidates.indexOf(selectedCandidate);
        const selectedWeight = weights[selectedIndex] ?? 0;
        attempts += 1;

        const arrivalTime = selectedCandidate.stop.arrival;
        const arrivalStationName = selectedCandidate.stop.station.name;
        const arrivalStationId = selectedCandidate.stop.station.id;

        if (!arrivalTime || !arrivalStationName || !arrivalStationId) {
          weights[selectedIndex] = 0;
          continue;
        }

        const waitTimeMinutes = diffMinutes(
          currentTime,
          selectedCandidate.train.stop.departure,
        );
        const durationMinutes = diffMinutes(
          selectedCandidate.train.stop.departure,
          arrivalTime,
        );

        if (
          !validateRouteChoice(
            waitTimeMinutes,
            arrivalStationId,
            state.visited_station_ids,
            config.hyperparams,
          )
        ) {
          weights[selectedIndex] = 0;
          continue;
        }

        const arrivalCoordinates = getCoordinates(
          selectedCandidate.stop.station,
        );
        let legDistanceKm: number | null = null;
        if (currentCoordinates && arrivalCoordinates) {
          legDistanceKm = haversineKm(
            currentCoordinates[0],
            currentCoordinates[1],
            arrivalCoordinates[0],
            arrivalCoordinates[1],
          );
          cumulativeDistanceKm = Number(
            (cumulativeDistanceKm + legDistanceKm).toFixed(3),
          );
        }

        const visitedBefore = state.visited_station_ids.has(arrivalStationId);
        legs.push({
          departure_station_name: currentStationName,
          departure_station_id: currentStationId,
          arrival_station_name: arrivalStationName,
          arrival_station_id: arrivalStationId,
          train_line: getTrainLine(selectedCandidate.train),
          train_number: selectedCandidate.train.number,
          train_category: selectedCandidate.train.category,
          departure_time: selectedCandidate.train.stop.departure,
          arrival_time: arrivalTime,
          platform_departure: selectedCandidate.train.stop.platform,
          platform_arrival: selectedCandidate.stop.platform,
          wait_time_minutes: waitTimeMinutes,
          duration_minutes: durationMinutes,
          leg_distance_km: legDistanceKm,
          cumulative_distance_km: Number(cumulativeDistanceKm.toFixed(3)),
          selection_weight: Number(selectedWeight.toFixed(6)),
          visited_before: visitedBefore,
          num_trains_available: numTrainsAvailable,
          stop_index_in_route: selectedCandidate.stopIndex,
        });

        // console.debug(`[Iteration ${iterationCount}] Selected journey`, {
        //   from: currentStationName,
        //   to: arrivalStationName,
        //   departure: selectedCandidate.train.stop.departure,
        //   arrival: arrivalTime,
        //   trainNumber: selectedCandidate.train.number,
        //   trainCategory: selectedCandidate.train.category,
        //   waitTimeMinutes,
        //   durationMinutes,
        //   weight: selectedWeight,
        // });

        state.visited_station_ids.add(arrivalStationId);
        state.used_train_numbers.add(selectedCandidate.train.number);
        state.used_transport_categories.add(selectedCandidate.train.category);
        state.visited_legs.add(
          getLegKey(
            selectedCandidate.train.passList[0]?.station?.id ??
              currentStationId,
            arrivalStationId,
          ),
        );

        // console.debug(
        //   `[Iteration ${iterationCount}] State updated after selection:`,
        //   {
        //     visited_stations: state.visited_station_ids.size,
        //     used_train_numbers: state.used_train_numbers.size,
        //     used_categories: state.used_transport_categories.size,
        //     visited_legs: state.visited_legs.size,
        //   },
        // );

        currentStationName = arrivalStationName;
        currentStationId = arrivalStationId;
        currentTime = arrivalTime;
        currentCoordinates = arrivalCoordinates;
        routeFound = true;
        break;
      }

      if (!routeFound) {
        break;
      }

      await sleep(API_DELAY_MS);
    } catch {
      break;
    }
  }

  return legs;
}
