import {
  DEFAULT_HYPERPARAMS,
  loadHyperparameters,
  resetHyperparametersToDefaults,
  saveHyperparameters,
  type HyperparamsData,
} from "./hyperparams";
import {
  fetchTrainStationByName,
  runSimulation,
  type SimulationConfig,
  type SimulationLeg,
} from "./simulation";

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message: string, duration = 3000): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed;
    top: 2rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    background-color: white;
    border: 2px solid var(--form-element-valid-border-color);
    border-radius: 0.5rem;
    padding: 1rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideInDown 0.3s ease-out;
    max-width: 90vw;
  `;

  const checkmark = document.createElement("span");
  checkmark.textContent = "✓";
  checkmark.style.cssText = `
    color: var(--form-element-valid-border-color);
    font-size: 1.5rem;
    font-weight: bold;
    flex-shrink: 0;
  `;

  const text = document.createElement("span");
  text.textContent = message;
  text.style.cssText = `
    color: var(--muted-color);
    font-size: 1rem;
  `;

  toast.appendChild(checkmark);
  toast.appendChild(text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideOutUp 0.3s ease-out";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Add animation keyframes to document
if (!document.querySelector("style[data-toast-animations]")) {
  const style = document.createElement("style");
  style.setAttribute("data-toast-animations", "true");
  style.textContent = `
    @keyframes slideInDown {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
    @keyframes slideOutUp {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(-20px);
      }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// SELECTION HYPERPARAMETERS
// These are the knobs the GA will optimise. Adjust manually
// for testing, or let the Python GA sweep them.
// ============================================================
let HYPERPARAMS: HyperparamsData = loadHyperparameters();
// ============================================================

const btnIntro = document.getElementById("btn-intro");
const gameArticle = document.getElementById("game-article");
const introArticle = document.getElementById("intro-article");
const navIntro = document.getElementById("nav-intro") as HTMLAnchorElement | null;
const navGame = document.getElementById("nav-game") as HTMLAnchorElement | null;
const navSimulation = document.getElementById("nav-simulation") as HTMLAnchorElement | null;
const navSettings = document.getElementById("nav-settings") as HTMLAnchorElement | null;
const departureStationDiv = document.getElementById(
  "departure-station",
) as HTMLElement | null;
const departureTimeDiv = document.getElementById(
  "departure-time",
) as HTMLElement | null;
const departurePlatformDiv = document.getElementById(
  "departure-platform",
) as HTMLElement | null;
const departurePlatformLine = document.getElementById(
  "departure-platform-line",
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
const arrivalPlatformLine = document.getElementById(
  "arrival-platform-line",
) as HTMLElement | null;
const btnReloadTrain = document.getElementById("btn-reload-train");
const sectionError = document.getElementById("error-section");
const sectionTrainDetails = document.getElementById("train-details-section");
const sectionLoading = document.getElementById("loading-section");
const btnValidateTrain = document.getElementById("btn-validate-train");
const btnClearJourney = document.getElementById("btn-clear-journey");
const ulJourneyList = document.getElementById("journey-info-list");
const settingsModalArticle = document.getElementById(
  "settings-modal-article",
) as HTMLElement | null;
const settingsForm = document.getElementById(
  "settings-form",
) as HTMLFormElement | null;
const btnSettingsReset = document.getElementById(
  "btn-settings-reset",
) as HTMLButtonElement | null;
const btnSettingsSaveClose = document.getElementById(
  "btn-settings-save-close",
) as HTMLButtonElement | null;
const simulationArticle = document.getElementById(
  "simulation-article",
) as HTMLElement | null;
const simulationConfigSection = document.getElementById(
  "simulation-config-section",
) as HTMLElement | null;
const simulationForm = document.getElementById(
  "simulation-form",
) as HTMLFormElement | null;
const simStartStationInput = document.getElementById(
  "sim-start-station",
) as HTMLInputElement | null;
const simStartDateTimeInput = document.getElementById(
  "sim-start-datetime",
) as HTMLInputElement | null;
const simEndTimeInput = document.getElementById(
  "sim-end-time",
) as HTMLInputElement | null;
const btnUseCurrentLocation = document.getElementById(
  "btn-use-current-location",
) as HTMLButtonElement | null;
const btnRunSimulation = document.getElementById(
  "btn-run-simulation",
) as HTMLButtonElement | null;
const simulationLoadingSection = document.getElementById(
  "simulation-loading-section",
) as HTMLElement | null;
const simulationLoadingStatus = document.getElementById(
  "simulation-loading-status",
) as HTMLElement | null;
const btnCancelSimulation = document.getElementById(
  "btn-cancel-simulation",
) as HTMLButtonElement | null;
const simulationResultsSection = document.getElementById(
  "simulation-results-section",
) as HTMLElement | null;
const simulationSummaryText = document.getElementById(
  "simulation-summary-text",
) as HTMLElement | null;
const simulationDurationText = document.getElementById(
  "simulation-duration-text",
) as HTMLElement | null;
const simulationResultsBody = document.getElementById(
  "simulation-results-body",
) as HTMLTableSectionElement | null;
const btnExportCsv = document.getElementById(
  "btn-export-csv",
) as HTMLButtonElement | null;
const btnRunAnotherSimulation = document.getElementById(
  "btn-run-another-simulation",
) as HTMLButtonElement | null;
const simulationErrorSection = document.getElementById(
  "simulation-error-section",
) as HTMLElement | null;
const simulationErrorMessage = document.getElementById(
  "simulation-error-message",
) as HTMLElement | null;
const btnTrySimulationAgain = document.getElementById(
  "btn-try-simulation-again",
) as HTMLButtonElement | null;
const DEBUG_PREFIX = "[train-debug]";

type HyperparamControlConfig = {
  key: keyof HyperparamsData;
  rangeId: string;
  inputId: string;
  outputId: string;
};

const HYPERPARAM_CONTROL_CONFIG: HyperparamControlConfig[] = [
  {
    key: "minJourneyLegDistance",
    rangeId: "settings-minJourneyLegDistance-range",
    inputId: "settings-minJourneyLegDistance-input",
    outputId: "settings-minJourneyLegDistance-current",
  },
  {
    key: "journeyLegDistanceFactor",
    rangeId: "settings-journeyLegDistanceFactor-range",
    inputId: "settings-journeyLegDistanceFactor-input",
    outputId: "settings-journeyLegDistanceFactor-current",
  },
  {
    key: "minIdleDuration",
    rangeId: "settings-minIdleDuration-range",
    inputId: "settings-minIdleDuration-input",
    outputId: "settings-minIdleDuration-current",
  },
  {
    key: "maxIdleDuration",
    rangeId: "settings-maxIdleDuration-range",
    inputId: "settings-maxIdleDuration-input",
    outputId: "settings-maxIdleDuration-current",
  },
  {
    key: "idleDurationFactor",
    rangeId: "settings-idleDurationFactor-range",
    inputId: "settings-idleDurationFactor-input",
    outputId: "settings-idleDurationFactor-current",
  },
  {
    key: "uniqueTrainFactor",
    rangeId: "settings-uniqueTrainFactor-range",
    inputId: "settings-uniqueTrainFactor-input",
    outputId: "settings-uniqueTrainFactor-current",
  },
  {
    key: "uniqueMeanOfTransportFactor",
    rangeId: "settings-uniqueMeanOfTransportFactor-range",
    inputId: "settings-uniqueMeanOfTransportFactor-input",
    outputId: "settings-uniqueMeanOfTransportFactor-current",
  },
  {
    key: "alreadyVisitedLegFactor",
    rangeId: "settings-alreadyVisitedLegFactor-range",
    inputId: "settings-alreadyVisitedLegFactor-input",
    outputId: "settings-alreadyVisitedLegFactor-current",
  },
  {
    key: "alreadySteppedInFactor",
    rangeId: "settings-alreadySteppedInFactor-range",
    inputId: "settings-alreadySteppedInFactor-input",
    outputId: "settings-alreadySteppedInFactor-current",
  },
];

let hasUnsavedSettingsReset = false;
let latestSimulationResults: SimulationLeg[] = [];
let activeSimulationRequestId = 0;

// ============================================================
// TYPES
// ============================================================

export type TrainStationResponse = {
  stations: TrainStation[];
};

export type TrainStationBoardEntry = {
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

export type TrainStation = {
  name: string;
  id: string;
  icon: string;
  coordinate: Coordinate;
  distance: number;
};

export type StationRef = {
  id: string;
  name: string | null;
  coordinate?: Coordinate | null;
};
// Stop: used for the `stop` field on a stationboard entry — departure is required
export type Stop = {
  arrival: string | null;
  arrivalTimestamp: number | null;
  delay: number | null;
  departure: string;
  departureTimestamp: number;
  platform: string | null;
};

// PassListItem: entries in a train's passList (departure may be nullable for future stops)
export type PassListItem = {
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

export type Coordinate = { type: string; x: number; y: number };

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

function getInputElement(id: string): HTMLInputElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element : null;
}

function getOutputElement(id: string): HTMLOutputElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLOutputElement ? element : null;
}

function clampValueToRange(value: number, rangeElement: HTMLInputElement): number {
  const min = Number(rangeElement.min);
  const max = Number(rangeElement.max);
  return Math.min(max, Math.max(min, value));
}

function setSyncedControlValue(
  rangeElement: HTMLInputElement,
  inputElement: HTMLInputElement,
  outputElement: HTMLOutputElement,
  value: number,
): void {
  rangeElement.value = String(clampValueToRange(value, rangeElement));
  const normalisedValue = rangeElement.value;
  inputElement.value = normalisedValue;
  outputElement.value = normalisedValue;
  outputElement.textContent = normalisedValue;
}

function syncRangeAndInput(
  rangeId: string,
  inputId: string,
  outputId: string,
): void {
  const rangeElement = getInputElement(rangeId);
  const inputElement = getInputElement(inputId);
  const outputElement = getOutputElement(outputId);

  if (!rangeElement || !inputElement || !outputElement) {
    return;
  }

  const syncFromRange = (): void => {
    inputElement.value = rangeElement.value;
    outputElement.value = rangeElement.value;
    outputElement.textContent = rangeElement.value;
  };

  const syncFromInput = (): void => {
    const parsedValue = Number(inputElement.value);

    if (Number.isNaN(parsedValue)) {
      syncFromRange();
      return;
    }

    setSyncedControlValue(
      rangeElement,
      inputElement,
      outputElement,
      parsedValue,
    );
  };

  rangeElement.addEventListener("input", syncFromRange);
  inputElement.addEventListener("change", syncFromInput);
  syncFromRange();
}

function applySettingsToUI(params: HyperparamsData): void {
  for (const control of HYPERPARAM_CONTROL_CONFIG) {
    const rangeElement = getInputElement(control.rangeId);
    const inputElement = getInputElement(control.inputId);
    const outputElement = getOutputElement(control.outputId);

    if (!rangeElement || !inputElement || !outputElement) {
      continue;
    }

    setSyncedControlValue(
      rangeElement,
      inputElement,
      outputElement,
      params[control.key],
    );
  }
}

function loadSettingsIntoUI(): void {
  applySettingsToUI(HYPERPARAMS);
}

function readSettingsFromUI(): HyperparamsData {
  const params = { ...HYPERPARAMS };

  for (const control of HYPERPARAM_CONTROL_CONFIG) {
    const rangeElement = getInputElement(control.rangeId);
    const inputElement = getInputElement(control.inputId);

    if (!rangeElement || !inputElement) {
      continue;
    }

    const parsedValue = Number(inputElement.value);
    const clampedValue = Number.isNaN(parsedValue)
      ? Number(rangeElement.value)
      : clampValueToRange(parsedValue, rangeElement);

    rangeElement.value = String(clampedValue);
    inputElement.value = rangeElement.value;
    params[control.key] = Number(rangeElement.value);
  }

  return params;
}

function closeSettingsModal(discardChanges = false): void {
  if (discardChanges) {
    if (hasUnsavedSettingsReset) {
      saveHyperparameters(HYPERPARAMS);
      hasUnsavedSettingsReset = false;
    }
    loadSettingsIntoUI();
  }
}

function saveSettingsFromUI(): void {
  const params = readSettingsFromUI();
  saveHyperparameters(params);
  HYPERPARAMS = params;
  hasUnsavedSettingsReset = false;
  showToast("Settings saved successfully!");
}

for (const control of HYPERPARAM_CONTROL_CONFIG) {
  syncRangeAndInput(control.rangeId, control.inputId, control.outputId);
}

loadSettingsIntoUI();

// ============================================================
// SIMULATION UI HELPERS
// ============================================================

type PreparedSimulationInput = {
  startStationName: string;
  startDate: Date;
  endDate: Date;
  hyperparams: HyperparamsData;
};

function setElementHidden(element: HTMLElement | null, hidden: boolean): void {
  if (element) {
    element.hidden = hidden;
  }
}

function setButtonDisabled(
  button: HTMLButtonElement | null,
  disabled: boolean,
): void {
  if (button) {
    button.disabled = disabled;
  }
}

function setSimulationLoadingStatus(message: string): void {
  if (simulationLoadingStatus) {
    simulationLoadingStatus.textContent = message;
  }
}

function hideSimulationFeedbackSections(): void {
  setElementHidden(simulationLoadingSection, true);
  setElementHidden(simulationResultsSection, true);
  setElementHidden(simulationErrorSection, true);
}

function showSimulationFormSection(): void {
  hideSimulationFeedbackSections();
  setElementHidden(simulationConfigSection, false);
  setButtonDisabled(btnRunSimulation, false);
  setButtonDisabled(btnExportCsv, latestSimulationResults.length === 0);
}

function showSimulationLoadingSection(message: string): void {
  setElementHidden(simulationConfigSection, true);
  setElementHidden(simulationResultsSection, true);
  setElementHidden(simulationErrorSection, true);
  setElementHidden(simulationLoadingSection, false);
  setSimulationLoadingStatus(message);
  setButtonDisabled(btnRunSimulation, true);
}

function showSimulationErrorState(message: string): void {
  setElementHidden(simulationConfigSection, true);
  setElementHidden(simulationLoadingSection, true);
  setElementHidden(simulationResultsSection, true);
  setElementHidden(simulationErrorSection, false);
  if (simulationErrorMessage) {
    simulationErrorMessage.textContent = message;
  }
  setButtonDisabled(btnRunSimulation, false);
}

function parseDateInput(value: string): Date | null {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function toZurichIsoString(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  
  // Calculate Zurich timezone offset for this date
  // Zurich is UTC+1 (winter) or UTC+2 (summer)
  const zurichDate = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Zurich" }));
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetHours = (zurichDate.getHours() - utcDate.getHours()) % 24;
  const offsetSign = offsetHours >= 0 ? "+" : "-";
  const offsetStr = `${offsetSign}${String(Math.abs(offsetHours)).padStart(2, "0")}:00`;
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetStr}`;
}

function combineDateAndTime(startDate: Date, endTimeValue: string): Date | null {
  const timeMatch = endTimeValue.match(/^(\d{2}):(\d{2})$/);
  if (!timeMatch) {
    return null;
  }

  const endDate = new Date(startDate.getTime());
  endDate.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  return endDate;
}

function setDefaultSimulationTimes(): void {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  
  if (simStartDateTimeInput) {
    simStartDateTimeInput.value = `${year}-${month}-${day}T08:00`;
  }
  if (simEndTimeInput) {
    simEndTimeInput.value = "16:00";
  }
}

function getSelectedSimulationHyperparams(): HyperparamsData {
  return { ...HYPERPARAMS };
}

function prepareSimulationInput(): PreparedSimulationInput {
  const startStationName = simStartStationInput?.value.trim() ?? "";
  if (!startStationName) {
    throw new Error("Please enter a start station.");
  }

  const startDateValue = simStartDateTimeInput?.value ?? "";
  const startDate = parseDateInput(startDateValue);
  if (!startDate) {
    throw new Error("Please choose a valid start date and time.");
  }

  const endTimeValue = simEndTimeInput?.value ?? "";
  if (!endTimeValue) {
    throw new Error("Please choose an end time.");
  }

  const endDate = combineDateAndTime(startDate, endTimeValue);
  if (!endDate) {
    throw new Error("Please choose a valid end time.");
  }

  if (startDate >= endDate) {
    throw new Error("End time must be later than the start date and time.");
  }

  return {
    startStationName,
    startDate,
    endDate,
    hyperparams: getSelectedSimulationHyperparams(),
  };
}

async function resolveSimulationStartStation(
  stationName: string,
): Promise<TrainStation> {
  const stations = await fetchTrainStationByName(stationName);
  if (stations.length === 0) {
    throw new Error("Station not found.");
  }

  const normalizedQuery = stationName.trim().toLowerCase();
  const exactMatch = stations.find(
    (station) => station.name.trim().toLowerCase() === normalizedQuery,
  );
  const fallbackStation = stations[0];

  if (exactMatch) {
    return exactMatch;
  }

  if (!fallbackStation) {
    throw new Error("Station not found.");
  }

  return fallbackStation;
}

function formatSimulationDateTime(value: string): string {
  const match = value.match(/(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  return value;
}

function formatSimulationNumber(
  value: number | null | undefined,
  fractionDigits = 1,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(fractionDigits);
}

function formatSimulationWeight(value: number): string {
  return value.toFixed(6);
}

function formatSimulationElapsed(elapsedMs: number): string {
  if (elapsedMs < 1000) {
    return `${elapsedMs.toFixed(0)} ms`;
  }

  if (elapsedMs < 60000) {
    return `${(elapsedMs / 1000).toFixed(1)} s`;
  }

  return `${(elapsedMs / 60000).toFixed(1)} min`;
}

function formatSimulationTrain(leg: SimulationLeg): string {
  return [leg.train_category, leg.train_number].filter(Boolean).join("");
}

function getSimulationTotalDistance(legs: SimulationLeg[]): number {
  const lastLeg = legs[legs.length - 1];
  if (lastLeg && lastLeg.cumulative_distance_km > 0) {
    return lastLeg.cumulative_distance_km;
  }

  return Number(
    legs
      .reduce((sum, leg) => sum + (leg.leg_distance_km ?? 0), 0)
      .toFixed(3),
  );
}

function clearSimulationResultsTable(): void {
  if (simulationResultsBody) {
    simulationResultsBody.innerHTML = "";
  }
}

function renderSimulationResults(
  legs: SimulationLeg[],
  elapsedMs: number,
): void {
  latestSimulationResults = legs;
  clearSimulationResultsTable();

  const totalDistance = getSimulationTotalDistance(legs);
  if (simulationSummaryText) {
    simulationSummaryText.textContent = `Simulation complete: ${legs.length} legs, ${totalDistance.toFixed(3)} km total distance`;
  }
  if (simulationDurationText) {
    simulationDurationText.textContent = `Calculated in ${formatSimulationElapsed(elapsedMs)}`;
  }

  if (simulationResultsBody) {
    const fragment = document.createDocumentFragment();

    legs.forEach((leg, index) => {
      const row = document.createElement("tr");
      const values = [
        String(index + 1),
        leg.departure_station_name,
        leg.arrival_station_name,
        formatSimulationTrain(leg),
        formatSimulationDateTime(leg.departure_time),
        formatSimulationDateTime(leg.arrival_time),
        formatSimulationNumber(leg.wait_time_minutes, 1),
        formatSimulationNumber(leg.duration_minutes, 0),
        formatSimulationNumber(leg.leg_distance_km, 0),
      ];

      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      fragment.appendChild(row);
    });

    simulationResultsBody.appendChild(fragment);
  }

  setElementHidden(simulationConfigSection, true);
  setElementHidden(simulationLoadingSection, true);
  setElementHidden(simulationErrorSection, true);
  setElementHidden(simulationResultsSection, false);
  setButtonDisabled(btnRunSimulation, false);
  setButtonDisabled(btnExportCsv, false);
}

function escapeCsvValue(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replaceAll("\"", '""')}"`;
}

function exportSimulationResultsAsCsv(): void {
  if (latestSimulationResults.length === 0) {
    return;
  }

  const headers = [
    "Leg#",
    "From Station",
    "To Station",
    "Train",
    "Departure",
    "Arrival",
    "Wait (min)",
    "Duration (min)",
    "Distance (km)",
    "Weight",
  ];

  const rows = latestSimulationResults.map((leg, index) => [
    index + 1,
    leg.departure_station_name,
    leg.arrival_station_name,
    formatSimulationTrain(leg),
    leg.departure_time,
    leg.arrival_time,
    leg.wait_time_minutes ?? "",
    leg.duration_minutes ?? "",
    leg.leg_distance_km ?? "",
    leg.selection_weight,
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const downloadUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = downloadUrl;
  downloadLink.download = `journey_simulation_${new Date().toISOString().replaceAll(/[:.]/g, "-")}.csv`;
  downloadLink.style.display = "none";
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  URL.revokeObjectURL(downloadUrl);
}

function resetSimulationForm(): void {
  activeSimulationRequestId += 1;
  simulationForm?.reset();
  setDefaultSimulationTimes();
  latestSimulationResults = [];
  clearSimulationResultsTable();
  if (simulationSummaryText) {
    simulationSummaryText.textContent = "";
  }
  if (simulationDurationText) {
    simulationDurationText.textContent = "";
  }
  if (simulationErrorMessage) {
    simulationErrorMessage.textContent = "";
  }
  setButtonDisabled(btnExportCsv, true);
  showSimulationFormSection();
  simStartStationInput?.focus();
}

function openSimulationArticle(): void {
  introArticle?.setAttribute("hidden", "true");
  gameArticle?.setAttribute("hidden", "true");
  settingsModalArticle?.setAttribute("hidden", "true");
  simulationArticle?.removeAttribute("hidden");
  hideSimulationFeedbackSections();
  setElementHidden(simulationConfigSection, false);
  setButtonDisabled(btnExportCsv, latestSimulationResults.length === 0);
  simStartStationInput?.focus();
}

function getSimulationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (error.message.toLowerCase().includes("station not found")) {
      return "Station not found. Please enter a valid train station name.";
    }

    return error.message;
  }

  return "Simulation failed. Please try again.";
}

async function handleSimulationFormSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  let preparedInput: PreparedSimulationInput;
  try {
    preparedInput = prepareSimulationInput();
  } catch (error) {
    showSimulationErrorState(getSimulationErrorMessage(error));
    return;
  }

  const simulationStartedAt = performance.now();
  const requestId = activeSimulationRequestId + 1;
  activeSimulationRequestId = requestId;

  try {
    showSimulationLoadingSection("Looking up start station...");
    const startStation = await resolveSimulationStartStation(
      preparedInput.startStationName,
    );
    if (requestId !== activeSimulationRequestId) {
      return;
    }

    const config: SimulationConfig = {
      startStationName: startStation.name,
      startStationId: startStation.id,
      startTime: toZurichIsoString(preparedInput.startDate),
      endTime: toZurichIsoString(preparedInput.endDate),
      hyperparams: preparedInput.hyperparams,
    };

    setSimulationLoadingStatus("Running simulation...");
    const legs = await runSimulation(config);
    if (requestId !== activeSimulationRequestId) {
      return;
    }

    if (legs.length === 0) {
      throw new Error(
        "No journey legs matched your criteria. Try a different station, time range, or hyperparameter mode.",
      );
    }

    setSimulationLoadingStatus("Preparing results...");
    renderSimulationResults(legs, performance.now() - simulationStartedAt);
  } catch (error) {
    if (requestId !== activeSimulationRequestId) {
      return;
    }

    console.error("Simulation failed", error);
    showSimulationErrorState(getSimulationErrorMessage(error));
  }
}

setButtonDisabled(btnExportCsv, true);

// ============================================================
// UI EVENT HANDLERS
// ============================================================

btnIntro?.addEventListener("click", () => {
  introArticle?.setAttribute("hidden", "true");
  gameArticle?.removeAttribute("hidden");
  settingsModalArticle?.setAttribute("hidden", "true");
  simulationArticle?.setAttribute("hidden", "true");
  updateUITrain();
});

navIntro?.addEventListener("click", (e) => {
  e.preventDefault();
  introArticle?.removeAttribute("hidden");
  gameArticle?.setAttribute("hidden", "true");
  settingsModalArticle?.setAttribute("hidden", "true");
  simulationArticle?.setAttribute("hidden", "true");
});

navGame?.addEventListener("click", (e) => {
  e.preventDefault();
  introArticle?.setAttribute("hidden", "true");
  gameArticle?.removeAttribute("hidden");
  settingsModalArticle?.setAttribute("hidden", "true");
  simulationArticle?.setAttribute("hidden", "true");
  updateUITrain();
});

navSimulation?.addEventListener("click", (e) => {
  e.preventDefault();
  openSimulationArticle();
});

navSettings?.addEventListener("click", (e) => {
  e.preventDefault();
  introArticle?.setAttribute("hidden", "true");
  gameArticle?.setAttribute("hidden", "true");
  settingsModalArticle?.removeAttribute("hidden");
  simulationArticle?.setAttribute("hidden", "true");
});

btnReloadTrain?.addEventListener("click", () => {
  updateUITrain();
});

btnUseCurrentLocation?.addEventListener("click", async (e) => {
  e.preventDefault();
  btnUseCurrentLocation.disabled = true;
  btnUseCurrentLocation.textContent = "📍 Finding...";
  try {
    const [lat, lon] = await getCurrentPlayerGPSLocation();
    const station = await fetchTrainStationData(lat, lon);
    if (station) {
      if (simStartStationInput) simStartStationInput.value = station.name;
      setDefaultSimulationTimes();
    } else {
      alert("No train station found nearby.");
    }
  } catch (error) {
    console.error("Failed to get current location:", error);
    alert("Could not get your location. Please enable location access.");
  } finally {
    btnUseCurrentLocation.disabled = false;
    btnUseCurrentLocation.textContent = "📍 Use Current";
  }
});

simulationForm?.addEventListener("submit", (event) => {
  void handleSimulationFormSubmit(event);
});

btnCancelSimulation?.addEventListener("click", () => {
  activeSimulationRequestId += 1;
  showSimulationFormSection();
  simStartStationInput?.focus();
});

btnExportCsv?.addEventListener("click", () => {
  exportSimulationResultsAsCsv();
});

btnRunAnotherSimulation?.addEventListener("click", () => {
  resetSimulationForm();
});

btnTrySimulationAgain?.addEventListener("click", () => {
  showSimulationFormSection();
  simStartStationInput?.focus();
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

btnSettingsReset?.addEventListener("click", () => {
  const defaultHyperparams = resetHyperparametersToDefaults();
  saveHyperparameters(defaultHyperparams);
  HYPERPARAMS = defaultHyperparams;
  hasUnsavedSettingsReset = false;
  applySettingsToUI(defaultHyperparams);
  showToast("Settings reset to defaults!");
});

settingsForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettingsFromUI();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsModalArticle?.hidden) {
    navGame?.click();
  }
});

// Initialize default simulation times on page load
setDefaultSimulationTimes();

// ============================================================
// UI RENDERING
// ============================================================

function formatDurationMs(startTime: number): string {
  return `${(performance.now() - startTime).toFixed(1)}ms`;
}

function formatTimeOnly(isoDateTimeString: string): string {
  const match = isoDateTimeString.match(/(\d{2}):(\d{2})(?::\d{2})?/);
  if (match) return `${match[1]}:${match[2]}`;
  return isoDateTimeString;
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
    li.innerText = `${info.departureStation} ${formatTimeOnly(info.departureTime)} → ${info.arrivalStation} ${formatTimeOnly(info.arrivalTime)}`;
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
  const lastEntry = history[history.length - 1];
  if (lastEntry) {
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
  const h = parts[0];
  const m = parts[1];
  const s = parts[2] ?? 0;
  if (h === undefined || m === undefined) return null;
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
      if (!stop || !stop.arrival || !stop.station?.name) continue;
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
    const normalised = range <= 0
      ? Number(idleMinutes === mid)
      : Math.max(0, 1 - Math.abs(idleMinutes - mid) / range);
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
  const total = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0);
  if (total === 0)
    throw new Error(
      "All candidates have zero weight — no valid journey possible.",
    );

  let r = Math.random() * total;
  let fallback: T | undefined;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const weight = Math.max(weights[i] ?? 0, 0);

    if (item === undefined || weight <= 0) {
      continue;
    }

    fallback = item;
    r -= weight;
    if (r <= 0) return item;
  }

  if (fallback === undefined) {
    throw new Error("No candidate available for weighted selection.");
  }

  return fallback;
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
  if (departureTimeDiv) departureTimeDiv.innerText = formatTimeOnly(journeyInfo.departureTime);
  if (departurePlatformDiv && departurePlatformLine) {
    if (journeyInfo.departurePlatform) {
      departurePlatformDiv.innerText = journeyInfo.departurePlatform.toString();
      departurePlatformLine.hidden = false;
    } else {
      departurePlatformLine.hidden = true;
    }
  }
  if (arrivalStationDiv) {
    arrivalStationDiv.innerText = journeyInfo.arrivalStation;
    arrivalStationDiv.dataset.stationId = journeyInfo.arrivalStationId;
  }
  if (arrivalTimeDiv) arrivalTimeDiv.innerText = formatTimeOnly(journeyInfo.arrivalTime);
  if (arrivalPlatformDiv && arrivalPlatformLine) {
    if (journeyInfo.arrivalPlatform) {
      arrivalPlatformDiv.innerText = journeyInfo.arrivalPlatform.toString();
      arrivalPlatformLine.hidden = false;
    } else {
      arrivalPlatformLine.hidden = true;
    }
  }
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
