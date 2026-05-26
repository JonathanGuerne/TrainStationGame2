// ============================================================
// SELECTION HYPERPARAMETERS
// These are the knobs the GA will optimise. Adjust manually
// for testing, or let the Python GA sweep them.
// ============================================================
const HYPERPARAMS = {
  // --- Distance (proxy: stop index in passList) ---
  // Legs shorter than this many stops are discarded entirely
  minJourneyLegDistance: 1,
  // Weight multiplier per extra stop beyond the minimum
  // Higher → prefer longer legs
  journeyLegDistanceFactor: 0.3,

  // --- Idle time between legs (minutes) ---
  // If the wait at the current station is outside [min, max], candidate is discarded
  minIdleDuration: 2,
  maxIdleDuration: 60,
  // Reward for idle durations closer to the middle of the window
  // (not used as a hard filter, just a soft reward — set to 0 to ignore)
  idleDurationFactor: 0.1,

  // --- Novelty bonuses (multiplicative, applied as 1 + factor) ---
  // Reward for picking a train number not yet used in this journey
  uniqueTrainFactor: 0.5,
  // Reward for picking a transport category (IC, RE, S, Bus…) not yet used
  uniqueMeanOfTransportFactor: 0.4,

  // --- Penalty multipliers (should be in (0, 1]) ---
  // Applied when the exact (from → to) leg was already completed
  alreadyVisitedLegFactor: 0.05,
  // Applied when the destination station was already visited
  alreadySteppedInFactor: 0.2,
};
// ============================================================

const btnIntro = document.getElementById("btn-intro");
const btnBackIntro = document.getElementById("btn-back-intro");
const gameArticle = document.getElementById("game-article");
const introArticle = document.getElementById("intro-article");
const departureStationDiv = document.getElementById(
  "departure-station",
) as HTMLElement | null;
const departureTimeDiv = document.getElementById(
  "departure-time",
) as HTMLElement | null;
const departurePlatformDiv = document.getElementById(
  "departure-platform",
) as HTMLElement | null;
const arrivalStationDiv = document.getElementById(
  "arrival-station",
) as HTMLElement | null;
const arrivalTimeDiv = document.getElementById(
  "arrival-time",
) as HTMLElement | null;
const arrivalPlatformDiv = document.getElementById(
  "arrival-platform",
) as HTMLElement | null;
const btnReloadTrain = document.getElementById("btn-reload-train");
const sectionError = document.getElementById("error-section");
const sectionTrainDetails = document.getElementById("train-details-section");
const sectionLoading = document.getElementById("loading-section");
const btnValidateTrain = document.getElementById("btn-validate-train");
const btnClearJourney = document.getElementById("btn-clear-journey");
const ulJourneyList = document.getElementById("journey-info-list");
const DEBUG_PREFIX = "[train-debug]";

// ============================================================
// TYPES
// ============================================================

type TrainStationResponse = {
  stations: TrainStation[];
};

type TrainStationBoardEntry = {
  capacity1st: number;
  capacity2nd: number;
  category: string;
  categoryCode: string;
  name: string;
  number: string;
  operator: string;
  to: string;
  stop: Stop;
  passList: PassListItem[];
};

type TrainStationWithBoardResponse = {
  stationboard: TrainStationBoardEntry[];
  station: StationRef;
};

type TrainStation = {
  name: string;
  id: string;
  icon: string;
  coordinate: Coordinate;
  distance: number;
};

type StationRef = {
  id: string;
  name: string | null;
};
// Stop: used for the `stop` field on a stationboard entry — departure is required
type Stop = {
  arrival: string | null;
  arrivalTimestamp: number | null;
  delay: number | null;
  departure: string;
  departureTimestamp: number;
  platform: string | null;
};

// PassListItem: entries in a train's passList (departure may be nullable for future stops)
type PassListItem = {
  station: StationRef;
  arrival: string | null;
  arrivalTimestamp: number | null;
  delay: number | null;
  departure: string | null;
  departureTimestamp: number | null;
  platform: string | null;
  capacity1st: number | null;
  capacity2nd: number | null;
};

type Coordinate = { type: string; x: number; y: number };

/** Extended to store IDs so journey state can be rebuilt reliably from the cookie */
type TrainJourneyInfo = {
  departureStation: string;
  departureStationId: string;
  departureTime: string;
  departurePlatform: string | null;
  arrivalStation: string;
  arrivalStationId: string;
  arrivalTime: string;
  arrivalPlatform: string | null;
  trainNumber: string;
  trainCategory: string;
};

/** One candidate = one (line × destination-stop) tuple */
type JourneyCandidate = {
  train: TrainStationBoardEntry;
  stop: TrainStationBoardEntry["passList"][number];
  /** Position in passList (0 = departure stop, excluded). Used as distance proxy. */
  stopIndex: number;
};

/** Live state of the current journey, rebuilt from cookie history each time */
type JourneyState = {
  visitedStationIds: Set<string>;
  /** "fromId->toId" composite keys */
  visitedLegs: Set<string>;
  usedTrainNumbers: Set<string>;
  usedTransportCategories: Set<string>;
  /** Unix timestamp (seconds) of the last validated departure, or null */
  lastDepartureTimestamp: number | null;
};

// ============================================================
// UI EVENT HANDLERS
// ============================================================

btnIntro?.addEventListener("click", () => {
  introArticle?.setAttribute("hidden", "true");
  gameArticle?.removeAttribute("hidden");
  updateUITrain();
});

btnReloadTrain?.addEventListener("click", () => {
  updateUITrain();
});

btnValidateTrain?.addEventListener("click", () => {
  const currentJourneyInfo = getCookieJourneyInfo();
  if (!currentJourneyInfo) return;

  const newEntry: TrainJourneyInfo = {
    departureStation: departureStationDiv?.innerText || "N/A",
    departureStationId: departureStationDiv?.dataset.stationId || "",
    departureTime: departureTimeDiv?.innerText || "N/A",
    departurePlatform: departurePlatformDiv?.innerText || "N/A",
    arrivalStation: arrivalStationDiv?.innerText || "N/A",
    arrivalStationId: arrivalStationDiv?.dataset.stationId || "",
    arrivalTime: arrivalTimeDiv?.innerText || "N/A",
    arrivalPlatform: arrivalPlatformDiv?.innerText || "N/A",
    trainNumber: departureStationDiv?.dataset.trainNumber || "",
    trainCategory: departureStationDiv?.dataset.trainCategory || "",
  };

  setCookieJourneyInfo([...currentJourneyInfo, newEntry]);
  updateUIJourneyListInfo();
});

btnClearJourney?.addEventListener("click", () => {
  document.cookie = "journeyInfo=; path=/; max-age=0";
  updateUIJourneyListInfo();
});

btnBackIntro?.addEventListener("click", () => {
  gameArticle?.setAttribute("hidden", "true");
  introArticle?.removeAttribute("hidden");
});

// ============================================================
// UI RENDERING
// ============================================================

function formatDurationMs(startTime: number): string {
  return `${(performance.now() - startTime).toFixed(1)}ms`;
}

function debugLog(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`${DEBUG_PREFIX} ${message}`);
    return;
  }

  console.info(`${DEBUG_PREFIX} ${message}`, details);
}

function updateUITrain() {
  const reloadStartedAt = performance.now();
  debugLog("Reload train requested");
  sectionError?.setAttribute("hidden", "true");
  sectionTrainDetails?.setAttribute("hidden", "true");
  sectionLoading?.removeAttribute("hidden");
  updateTrainInfo()
    .then(() => {
      sectionLoading?.setAttribute("hidden", "true");
      sectionTrainDetails?.removeAttribute("hidden");
      debugLog(`Reload train finished in ${formatDurationMs(reloadStartedAt)}`);
    })
    .catch((error) => {
      sectionLoading?.setAttribute("hidden", "true");
      sectionError?.removeAttribute("hidden");
      console.error(
        `${DEBUG_PREFIX} Reload train failed after ${formatDurationMs(reloadStartedAt)}`,
        error,
      );
    });
  updateUIJourneyListInfo();
}

function updateUIJourneyListInfo() {
  if (!ulJourneyList) return;
  ulJourneyList.innerHTML = "";
  const journeyInfo = getCookieJourneyInfo();
  if (!journeyInfo || journeyInfo.length === 0) return;

  const fragment = document.createDocumentFragment();
  journeyInfo.forEach((info) => {
    const li = document.createElement("li");
    li.innerText = `From ${info.departureStation} at ${info.departureTime} on platform ${info.departurePlatform} to ${info.arrivalStation} at ${info.arrivalTime} on platform ${info.arrivalPlatform}`;
    fragment.appendChild(li);
  });
  ulJourneyList.appendChild(fragment);
}

// ============================================================
// DATA FETCHING
// ============================================================

async function getCurrentPlayerGPSLocation(): Promise<[number, number]> {
  if (!navigator.geolocation) {
    throw new Error("Geolocation is not supported by this browser.");
  }
  const geolocationStartedAt = performance.now();
  debugLog("Requesting current geolocation");
  return new Promise<[number, number]>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        debugLog(
          `Geolocation resolved in ${formatDurationMs(geolocationStartedAt)}`,
          coords,
        );
        resolve([coords.latitude, coords.longitude]);
      },
      (error) => {
        console.error(
          `${DEBUG_PREFIX} Geolocation failed after ${formatDurationMs(geolocationStartedAt)}`,
          error,
        );
        reject(error);
      },
    );
  });
}

async function fetchTrainStationData(
  lat: number,
  lon: number,
): Promise<TrainStation | undefined> {
  const stationFetchStartedAt = performance.now();
  debugLog("Fetching nearby stations", { lat, lon });
  const response = await fetch(
    `https://transport.opendata.ch/v1/locations?x=${lon}&y=${lat}&type=station`,
  );
  if (!response.ok) throw new Error("Failed to fetch train data.");
  debugLog(
    `Nearby stations API responded in ${formatDurationMs(stationFetchStartedAt)}`,
    { status: response.status },
  );
  const stations: TrainStationResponse = await response.json();
  if (!stations.stations || stations.stations.length === 0) return undefined;

  stations.stations.sort((a, b) => a.distance - b.distance);
  const closestTrainStation = stations.stations.find(
    (station) => station.icon === "train",
  );
  debugLog(
    `Processed ${stations.stations.length} nearby stations in ${formatDurationMs(stationFetchStartedAt)}`,
    closestTrainStation
      ? {
          closestTrainStation: closestTrainStation.name,
          closestTrainStationDistance: closestTrainStation.distance,
        }
      : { closestTrainStation: null },
  );
  return closestTrainStation;
}

async function fetchNextTrain(
  stationId: string,
): Promise<TrainStationBoardEntry[] | undefined> {
  const stationboardFetchStartedAt = performance.now();
  debugLog("Fetching stationboard", { stationId });
  const response = await fetch(
    `https://transport.opendata.ch/v1/stationboard?id=${stationId}&limit=10`,
  );
  if (!response.ok) throw new Error("Failed to fetch next train data.");
  debugLog(
    `Stationboard API responded in ${formatDurationMs(stationboardFetchStartedAt)}`,
    { status: response.status, stationId },
  );
  const data: TrainStationWithBoardResponse = await response.json();
  if (!data.stationboard || data.stationboard.length === 0) return undefined;
  debugLog(
    `Loaded ${data.stationboard.length} stationboard entries in ${formatDurationMs(stationboardFetchStartedAt)}`,
    { stationId, stationName: data.station.name },
  );
  return data.stationboard;
}

// ============================================================
// JOURNEY STATE
// ============================================================

/** Reconstruct the in-memory journey state from persisted cookie history */
function buildStateFromHistory(history: TrainJourneyInfo[]): JourneyState {
  const state: JourneyState = {
    visitedStationIds: new Set(),
    visitedLegs: new Set(),
    usedTrainNumbers: new Set(),
    usedTransportCategories: new Set(),
    lastDepartureTimestamp: null,
  };

  for (const entry of history) {
    if (entry.departureStationId)
      state.visitedStationIds.add(entry.departureStationId);
    if (entry.arrivalStationId)
      state.visitedStationIds.add(entry.arrivalStationId);
    if (entry.departureStationId && entry.arrivalStationId) {
      state.visitedLegs.add(
        `${entry.departureStationId}->${entry.arrivalStationId}`,
      );
    }
    if (entry.trainNumber) state.usedTrainNumbers.add(entry.trainNumber);
    if (entry.trainCategory)
      state.usedTransportCategories.add(entry.trainCategory);
  }

  // Use the departure timestamp of the most recent leg as the idle reference
  if (history.length > 0) {
    const lastEntry = history[history.length - 1];
    // The arrival time of the last leg is the earliest we can depart again
    // Parse the HH:MM:SS string into a today-relative timestamp (seconds)
    const parsed = parseTimeToTimestamp(lastEntry.arrivalTime);
    if (parsed !== null) state.lastDepartureTimestamp = parsed;
  }

  return state;
}

/**
 * Parse a "HH:MM:SS" or "HH:MM" time string into a Unix-like seconds value
 * anchored to today. Returns null on failure.
 */
function parseTimeToTimestamp(timeStr: string): number | null {
  const parts = timeStr.split(":").map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  const [h, m, s = 0] = parts;
  const now = new Date();
  now.setHours(h, m, s, 0);
  return Math.floor(now.getTime() / 1000);
}

// ============================================================
// WEIGHTED SELECTION CORE
// ============================================================

/** Flatten all (train × stop) tuples from the stationboard */
function buildCandidates(
  possibilities: TrainStationBoardEntry[],
): JourneyCandidate[] {
  const candidates: JourneyCandidate[] = [];
  for (const train of possibilities) {
    const passList = train.passList;
    if (passList.length < 2) continue;
    // index 0 is the departure stop itself — skip it
    for (let i = 1; i < passList.length; i++) {
      const stop = passList[i];
      if (!stop.arrival || !stop.station?.name) continue;
      candidates.push({ train, stop, stopIndex: i });
    }
  }
  return candidates;
}

/**
 * Compute a non-negative weight for a single (train × stop) candidate.
 * Returns 0 to hard-exclude a candidate.
 */
function computeWeight(
  candidate: JourneyCandidate,
  state: JourneyState,
): number {
  const { train, stop, stopIndex } = candidate;
  const p = HYPERPARAMS;

  // --- Hard filter: minimum leg distance ---
  if (stopIndex < p.minJourneyLegDistance) return 0;

  // --- Hard filter: idle duration window ---
  if (state.lastDepartureTimestamp !== null) {
    const depTs = train.stop.departureTimestamp; // seconds
    const idleMinutes = (depTs - state.lastDepartureTimestamp) / 60;
    if (idleMinutes < p.minIdleDuration) return 0;
    if (idleMinutes > p.maxIdleDuration) return 0;
  }

  let weight = 1.0;

  // --- Distance reward ---
  const extraStops = stopIndex - p.minJourneyLegDistance;
  weight *= 1 + extraStops * p.journeyLegDistanceFactor;

  // --- Idle duration reward (soft, peaks at midpoint of window) ---
  if (state.lastDepartureTimestamp !== null && p.idleDurationFactor > 0) {
    const depTs = train.stop.departureTimestamp;
    const idleMinutes = (depTs - state.lastDepartureTimestamp) / 60;
    const mid = (p.minIdleDuration + p.maxIdleDuration) / 2;
    const range = (p.maxIdleDuration - p.minIdleDuration) / 2;
    // Gaussian-like reward: 1 at midpoint, decays toward edges
    const normalised = Math.max(0, 1 - Math.abs(idleMinutes - mid) / range);
    weight *= 1 + normalised * p.idleDurationFactor;
  }

  // --- Novelty bonuses ---
  if (!state.usedTrainNumbers.has(train.number)) {
    weight *= 1 + p.uniqueTrainFactor;
  }
  if (!state.usedTransportCategories.has(train.category)) {
    weight *= 1 + p.uniqueMeanOfTransportFactor;
  }

  // --- Penalty: already visited destination ---
  const destId = stop.station.id;
  if (destId && state.visitedStationIds.has(destId)) {
    weight *= p.alreadySteppedInFactor;
  }

  // --- Penalty: already took this exact leg ---
  const fromId = train.passList[0]?.station?.id ?? "";
  const legKey = `${fromId}->${destId}`;
  if (state.visitedLegs.has(legKey)) {
    weight *= p.alreadyVisitedLegFactor;
  }

  return Math.max(weight, 0);
}

/** Weighted random pick from an array given parallel weight values */
function weightedRandomPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0)
    throw new Error(
      "All candidates have zero weight — no valid journey possible.",
    );
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ============================================================
// MAIN SELECTION FUNCTION
// ============================================================

function getRandomTrainJourney(
  departureStation: TrainStation,
  possibilities: TrainStationBoardEntry[],
  state: JourneyState,
): TrainJourneyInfo {
  const selectionStartedAt = performance.now();
  const candidates = buildCandidates(possibilities);
  if (candidates.length === 0)
    throw new Error("No valid candidates after flattening.");

  const weights = candidates.map((c) => computeWeight(c, state));
  debugLog(
    `Computed ${candidates.length} candidate weights in ${formatDurationMs(selectionStartedAt)}`,
    candidates.map((c, i) => ({
      train: c.train.number,
      category: c.train.category,
      destination: c.stop.station.name,
      stopIndex: c.stopIndex,
      weight: weights[i],
    })),
  );

  const chosen = weightedRandomPick(candidates, weights);
  const departurePass = chosen.train.passList[0];

  if (!departurePass?.departure)
    throw new Error("No departure info on selected candidate.");

  const journeyInfo = {
    departureStation: departureStation.name,
    departureStationId: departureStation.id,
    departureTime: departurePass.departure,
    departurePlatform: departurePass.platform,
    arrivalStation: chosen.stop.station.name!,
    arrivalStationId: chosen.stop.station.id,
    arrivalTime: chosen.stop.arrival!,
    arrivalPlatform: chosen.stop.platform,
    trainNumber: chosen.train.number,
    trainCategory: chosen.train.category,
  };
  debugLog(
    `Selected journey in ${formatDurationMs(selectionStartedAt)}`,
    journeyInfo,
  );
  return journeyInfo;
}

// ============================================================
// UPDATE LOOP
// ============================================================

async function updateTrainInfo(): Promise<void> {
  const updateStartedAt = performance.now();
  debugLog("Starting train info refresh");
  const [lat, lon] = await getCurrentPlayerGPSLocation();
  const fetchedTrainStationData = await fetchTrainStationData(lat, lon);
  if (!fetchedTrainStationData)
    throw new Error("No train station found nearby.");

  const nextTrainData = await fetchNextTrain(fetchedTrainStationData.id);
  if (!nextTrainData) throw new Error("No next train data found.");

  const stateBuildStartedAt = performance.now();
  const history = getCookieJourneyInfo();
  const state = buildStateFromHistory(history);
  debugLog(
    `Rebuilt journey state in ${formatDurationMs(stateBuildStartedAt)}`,
    {
      historyEntries: history.length,
      visitedStations: state.visitedStationIds.size,
      visitedLegs: state.visitedLegs.size,
      usedTrainNumbers: state.usedTrainNumbers.size,
      usedTransportCategories: state.usedTransportCategories.size,
    },
  );

  const journeyInfo = getRandomTrainJourney(
    fetchedTrainStationData,
    nextTrainData,
    state,
  );

  const domUpdateStartedAt = performance.now();
  if (departureStationDiv) {
    departureStationDiv.innerText = journeyInfo.departureStation;
    departureStationDiv.dataset.stationId = journeyInfo.departureStationId;
    departureStationDiv.dataset.trainNumber = journeyInfo.trainNumber;
    departureStationDiv.dataset.trainCategory = journeyInfo.trainCategory;
  }
  if (departureTimeDiv) departureTimeDiv.innerText = journeyInfo.departureTime;
  if (departurePlatformDiv)
    departurePlatformDiv.innerText =
      journeyInfo.departurePlatform?.toString() || "N/A";
  if (arrivalStationDiv) {
    arrivalStationDiv.innerText = journeyInfo.arrivalStation;
    arrivalStationDiv.dataset.stationId = journeyInfo.arrivalStationId;
  }
  if (arrivalTimeDiv) arrivalTimeDiv.innerText = journeyInfo.arrivalTime;
  if (arrivalPlatformDiv)
    arrivalPlatformDiv.innerText =
      journeyInfo.arrivalPlatform?.toString() || "N/A";
  debugLog(
    `Updated train details UI in ${formatDurationMs(domUpdateStartedAt)}`,
  );
  debugLog(
    `Train info refresh completed in ${formatDurationMs(updateStartedAt)}`,
  );
}

// ============================================================
// COOKIE PERSISTENCE
// ============================================================

function getCookieJourneyInfo(): TrainJourneyInfo[] {
  if (!navigator.cookieEnabled) return [];
  const cookies = document.cookie.split("; ");
  const journeyInfoCookie = cookies.find((c) => c.startsWith("journeyInfo="));
  if (!journeyInfoCookie) return [];
  const cookieValue = journeyInfoCookie.split("=")[1];
  if (!cookieValue) return [];
  try {
    return JSON.parse(decodeURIComponent(cookieValue)) as TrainJourneyInfo[];
  } catch {
    return [];
  }
}

function setCookieJourneyInfo(journeyInfo: TrainJourneyInfo[]): void {
  if (!navigator.cookieEnabled) throw new Error("Cookies are not enabled.");
  document.cookie = `journeyInfo=${encodeURIComponent(JSON.stringify(journeyInfo))}; path=/; max-age=86400`;
}
