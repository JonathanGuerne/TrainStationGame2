/**
 * Stop routes data module
 * Provides a lookup for the number of unique routes connected to each station.
 * Data is embedded during build from stop_routes.csv.
 */

import stopRoutesData from "../stop_routes.csv?raw";

type StopRoutesMap = Map<string, number>;

/**
 * Parse the raw CSV data and return a Map for O(1) station lookups.
 * Format: stop_name,unique_route_count
 */
function parseStopRoutes(): StopRoutesMap {
  const map: StopRoutesMap = new Map();
  const lines = stopRoutesData.trim().split("\n");

  // Skip header (line 0: "stop_name,unique_route_count")
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const [stationName, countStr] = line.split(",");
    if (!stationName || !countStr) continue;

    const routeCount = parseInt(countStr, 10);
    if (isNaN(routeCount)) continue;

    map.set(stationName.trim(), routeCount);
  }

  return map;
}

// Lazy-load and cache the stop routes data
let cachedRoutes: StopRoutesMap | null = null;

/**
 * Get the number of unique routes connected to a station.
 * Returns 1 (default) if the station is not found.
 */
export function getStationRouteCount(
  stationName: string | undefined | null,
): number {
  if (!stationName) {
    console.debug(
      "[StopRoutes] getStationRouteCount: undefined or null station name, returning default 1",
    );
    return 1; // Default fallback
  }

  if (!cachedRoutes) {
    cachedRoutes = parseStopRoutes();
    console.debug(
      `[StopRoutes] Parsed ${cachedRoutes.size} stations from CSV data`,
    );
  }

  const routeCount = cachedRoutes.get(stationName) ?? 1;
  // console.debug(`[StopRoutes] Station "${stationName}" has ${routeCount} unique routes`);
  return routeCount;
}
