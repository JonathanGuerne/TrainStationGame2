export interface HyperparamsData {
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
}

export const DEFAULT_HYPERPARAMS: HyperparamsData = {
  minJourneyLegDistance: 1,
  journeyLegDistanceFactor: 0.3,
  minIdleDuration: 7,
  maxIdleDuration: 90,
  idleDurationFactor: 0.1,
  uniqueTrainFactor: 0.5,
  uniqueMeanOfTransportFactor: 0.7,
  alreadyVisitedLegFactor: 0.05,
  alreadySteppedInFactor: 0.2,
  preferredCategoryFactor: 0.4,
  shortJourneyLegPenalty: 0.7,
  minimumLegDurationPenalty: 0.8,
  stationboardLimit: 10,
  minimumLegDuration: 10,
};

const HYPERPARAMS_STORAGE_KEY = "trainGameHyperparams";
const HYPERPARAM_KEYS: (keyof HyperparamsData)[] = [
  "minJourneyLegDistance",
  "journeyLegDistanceFactor",
  "minIdleDuration",
  "maxIdleDuration",
  "idleDurationFactor",
  "uniqueTrainFactor",
  "uniqueMeanOfTransportFactor",
  "alreadyVisitedLegFactor",
  "alreadySteppedInFactor",
  "preferredCategoryFactor",
  "shortJourneyLegPenalty",
  "minimumLegDurationPenalty",
  "stationboardLimit",
  "minimumLegDuration",
];

function isHyperparamsData(value: unknown): value is HyperparamsData {
  if (!value || typeof value !== "object") {
    return false;
  }

  return HYPERPARAM_KEYS.every((key) => typeof (value as HyperparamsData)[key] === "number");
}

export function loadHyperparameters(): HyperparamsData {
  try {
    const storedValue = localStorage.getItem(HYPERPARAMS_STORAGE_KEY);

    if (!storedValue) {
      console.info("No saved hyperparameters found. Using defaults.");
      return DEFAULT_HYPERPARAMS;
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    if (isHyperparamsData(parsedValue)) {
      return parsedValue;
    }

    console.warn("Saved hyperparameters were invalid. Using defaults.");
    return DEFAULT_HYPERPARAMS;
  } catch (error) {
    console.error("Failed to load hyperparameters. Using defaults.", error);
    return DEFAULT_HYPERPARAMS;
  }
}

export function saveHyperparameters(params: HyperparamsData): boolean {
  try {
    localStorage.setItem(HYPERPARAMS_STORAGE_KEY, JSON.stringify(params));
    return true;
  } catch (error) {
    console.error("Failed to save hyperparameters.", error);
    return false;
  }
}

export function resetHyperparametersToDefaults(): HyperparamsData {
  try {
    localStorage.removeItem(HYPERPARAMS_STORAGE_KEY);
    console.info("Hyperparameters reset to defaults.");
  } catch (error) {
    console.error("Failed to reset hyperparameters. Returning defaults.", error);
  }

  return DEFAULT_HYPERPARAMS;
}
