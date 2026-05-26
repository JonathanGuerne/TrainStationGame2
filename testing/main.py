# ## Enhanced simulation — Generation 2 with Corrected Weights
#
# ### New Constraints for Balanced Gameplay
#
# | Constraint | Value | Rationale |
# |---|---|---|
# | **Max Wait Time** | 60 minutes | Prevent tedious waiting; players wait longer than traveling |
# | **Min Connection Time** | 10 minutes | Realistic boarding/platform change time |
#
# ### Metadata Fields
#
# | Category | Field | Description |
# |---|---|---|
# | **Generation** | `generation` | "v2_corrected_weights" or "v1_baseline" |
# | **Times** | `train_departure` | Scheduled departure of the chosen train from current station |
# | | `wait_time_minutes` | Time between arriving and the train's departure |
# | | `duration_minutes` | Ride time from train departure to chosen stop |
# | **Route context** | `num_trains_available` | How many trains were at the station when the choice was made |
# | | `num_stops_on_train` | Total stops in the train's `passList` |
# | | `stop_index_in_route` | Index of the chosen stop (0-based) |
# | | `fraction_of_route` | `stop_index / num_stops_on_train` |
# | **Geography** | `departure_lat/lon`, `arrival_lat/lon` | WGS84 coordinates from API response |
# | | `leg_distance_km` | Haversine distance between departure and arrival |
# | | `cumulative_distance_km` | Total distance traveled in this run |
# | **Quality flags** | `visited_before` | Whether the arrival station was already visited in this run |
#
# ### Algorithm Improvements
#
# **Generation 1 (Baseline):**
# - Pick random train → pick random stop → accept (minimal validation)
#
# **Generation 2 (Corrected Weights):**
# - Pick random train
# - Try up to 5 stops on that train with full validation
# - For each stop, verify:
#   - ✓ Arrival/departure times exist
#   - ✓ Wait time in [10, 60] minutes
#   - ✓ Station not previously visited
# - Retry up to 5 trains if no valid stop found
# - Accept only valid routes; reject and retry on constraint violation
import json
import datetime
from pprint import pprint
import requests
import random
import pandas as pd
import time
import os
import math
import datetime
import uuid

FILE_NAME = "train_stops.csv"

START_TIME = "2026-05-25T08:00:00+0200"
START_STATION = "biel"
END_TIME = "2026-05-25T16:00:00+0200"

# ===== HYPERPARAMETERS (from index.ts) =====
HYPERPARAMS = {
    # --- Distance (proxy: stop index in passList) ---
    "minJourneyLegDistance": 1,
    "journeyLegDistanceFactor": 0.3,
    # --- Idle time between legs (minutes) ---
    "minIdleDuration": 2,
    "maxIdleDuration": 60,
    "idleDurationFactor": 0.1,
    # --- Novelty bonuses (multiplicative, applied as 1 + factor) ---
    "uniqueTrainFactor": 0.5,
    "uniqueMeanOfTransportFactor": 0.4,
    # --- Preferred category bonus (multiplicative, applied as 1 + factor) ---
    "preferredCategoryFactor": 0.4,
    # --- Short journey leg penalty (moderated by distance) ---
    "shortJourneyLegPenalty": 0.7,
    # --- Penalty multipliers (should be in (0, 1]) ---
    "alreadyVisitedLegFactor": 0.05,
    "alreadySteppedInFactor": 0.2,
}

PREFERRED_CATEGORIES = ["IC", "ICE", "IR", "EC", "TGV", "RE", "RJX"]

GENERATION = "v4_multi_factor_weights"


def fetch_train_station_by_name(station_name):
    query = f"https://transport.opendata.ch/v1/locations?query={station_name}"
    response = requests.get(query)
    data = response.json().get("stations", [])
    return [d for d in data if d["icon"] == "train"]


def fetch_train_station_data(station_id, datetime_for_departure):
    # convert datetime to YYYY-MM-DD hh:mm format
    if isinstance(datetime_for_departure, str):
        datetime_for_departure = datetime.datetime.fromisoformat(datetime_for_departure)
        datetime_for_departure = datetime_for_departure.strftime("%Y-%m-%d %H:%M")
    info = f"https://transport.opendata.ch/v1/stationboard?id={station_id}&limit=10&datetime={datetime_for_departure}"
    response = requests.get(info)
    data = response.json().get("stationboard", [])
    return data


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def validate_route_choice(wait_time_minutes, arrival_station_id, visited_station_ids):
    """
    Validate if a chosen route meets the constraints for improved gameplay.
    Returns (is_valid, reason_if_invalid)
    """
    if wait_time_minutes is None:
        return False, "Missing time data"

    # Constraint 1: Wait time cap (max 60 minutes)
    if wait_time_minutes > HYPERPARAMS["maxIdleDuration"]:
        return False, f"Wait time {wait_time_minutes:.0f}m exceeds max"

    # Constraint 2: Minimum connection time (avoid impossible transfers)
    if wait_time_minutes < HYPERPARAMS["minIdleDuration"]:
        return False, f"Connection gap too tight"

    # Constraint 3: No station revisits
    if arrival_station_id in visited_station_ids:
        return False, "Station already visited"

    return True, "Valid"


def parse_time_to_timestamp(time_str):
    """Parse an ISO datetime string to Unix timestamp (seconds since epoch)."""
    try:
        dt = datetime.datetime.fromisoformat(time_str)
        return int(dt.timestamp())
    except Exception:
        return None


def parse_time_of_day_to_timestamp(time_str):
    """
    Parse a time-of-day string (HH:MM:SS or HH:MM) to today-relative timestamp.
    Matches TypeScript's parseTimeToTimestamp behavior.
    Returns Unix timestamp (seconds since epoch) for today at that time.
    """
    try:
        parts = time_str.split(":")
        if len(parts) < 2:
            return None
        h, m = int(parts[0]), int(parts[1])
        s = int(parts[2]) if len(parts) > 2 else 0
        now = datetime.datetime.now()
        now = now.replace(hour=h, minute=m, second=s, microsecond=0)
        return int(now.timestamp())
    except (ValueError, IndexError):
        return None


def build_candidates(stationboard):
    """Flatten all (train × stop) tuples from the stationboard."""
    candidates = []
    for train in stationboard:
        pass_list = train.get("passList", [])
        if len(pass_list) < 2:
            continue
        # index 0 is the departure stop itself — skip it
        for i in range(1, len(pass_list)):
            stop = pass_list[i]
            if not stop.get("arrival") or not stop.get("station"):
                continue
            candidates.append({
                "train": train,
                "stop": stop,
                "stop_index": i
            })
    return candidates


def compute_weight(candidate, state, current_time):
    """
    Compute a non-negative weight for a single (train × stop) candidate.
    Returns 0 to hard-exclude a candidate.
    
    Args:
        candidate: dict with 'train', 'stop', 'stop_index'
        state: dict with 'used_train_numbers', 'used_transport_categories', 'visited_station_ids', 'visited_legs'
        current_time: ISO datetime string for current location
    """
    train = candidate["train"]
    stop = candidate["stop"]
    stop_index = candidate["stop_index"]
    p = HYPERPARAMS
    
    # --- Hard filter: minimum leg distance ---
    if stop_index < p["minJourneyLegDistance"]:
        return 0
    
    # --- Hard filter: station already visited ---
    dest_id = stop.get("station", {}).get("id")
    if dest_id and dest_id in state["visited_station_ids"]:
        return 0
    
    # Calculate wait time using actual ISO datetimes
    train_dep_str = (train.get("stop") or {}).get("departure")
    try:
        current_dt = datetime.datetime.fromisoformat(current_time)
        train_dep_dt = (
            datetime.datetime.fromisoformat(train_dep_str)
            if train_dep_str
            else None
        )
        wait_time_minutes = (
            round((train_dep_dt - current_dt).total_seconds() / 60, 1)
            if train_dep_dt
            else None
        )
    except Exception:
        wait_time_minutes = None
    
    # --- Hard filter: idle duration window ---
    if wait_time_minutes is not None:
        if wait_time_minutes < p["minIdleDuration"]:
            return 0
        if wait_time_minutes > p["maxIdleDuration"]:
            return 0
    
    weight = 1.0
    
    # --- Distance reward (via stop index) ---
    extra_stops = stop_index - p["minJourneyLegDistance"]
    weight *= 1 + extra_stops * p["journeyLegDistanceFactor"]
    
    # --- Penalize very short journey legs (1-2 stops), moderated by distance ---
    if stop_index <= 2:
        departure_coord = train.get("passList", [{}])[0].get("station", {}).get("coordinate", {})
        arrival_coord = stop.get("station", {}).get("coordinate", {})
        leg_distance_km = 0
        if departure_coord and arrival_coord:
            leg_distance_km = haversine_km(
                departure_coord.get("x", 0),
                departure_coord.get("y", 0),
                arrival_coord.get("x", 0),
                arrival_coord.get("y", 0),
            )
        distance_factor = max(0, 1 - leg_distance_km / 100)
        weight *= max(0.1, 1 - p["shortJourneyLegPenalty"] * distance_factor)
    
    # --- Idle duration reward (Gaussian-like at midpoint of window) ---
    if wait_time_minutes is not None and p["idleDurationFactor"] > 0:
        mid = (p["minIdleDuration"] + p["maxIdleDuration"]) / 2
        range_val = (p["maxIdleDuration"] - p["minIdleDuration"]) / 2
        # Gaussian-like reward: 1 at midpoint, decays toward edges
        normalized = max(0, 1 - abs(wait_time_minutes - mid) / range_val)
        weight *= 1 + normalized * p["idleDurationFactor"]
    
    # --- Novelty bonuses ---
    if train["number"] not in state["used_train_numbers"]:
        weight *= 1 + p["uniqueTrainFactor"]
    if train["category"] not in state["used_transport_categories"]:
        weight *= 1 + p["uniqueMeanOfTransportFactor"]
    
    # --- Preferred category bonus ---
    if train["category"] in PREFERRED_CATEGORIES:
        weight *= 1 + p["preferredCategoryFactor"]
    
    # --- Penalty: already took this exact leg ---
    from_id = train.get("passList", [{}])[0].get("station", {}).get("id") if train.get("passList") else ""
    leg_key = f"{from_id}->{dest_id}"
    if leg_key in state["visited_legs"]:
        weight *= p["alreadyVisitedLegFactor"]
    
    return max(weight, 0)


def weighted_random_pick(items, weights):
    """Weighted random selection from items based on weights."""
    total = sum(weights)
    if total == 0:
        raise ValueError("All candidates have zero weight — no valid journey possible.")
    r = random.random() * total
    for i, weight in enumerate(weights):
        r -= weight
        if r <= 0:
            return items[i]
    return items[-1]


start_station_info = fetch_train_station_by_name(START_STATION)[0]
start_station_id = start_station_info.get("id")
start_lat = start_station_info.get("coordinate", {}).get("x")
start_lon = start_station_info.get("coordinate", {}).get("y")


# Single run with multi-factor weighting
all_stops: list[dict] = []
visited_station_ids: set = set()
cumulative_distance_km = 0.0
run_id = str(uuid.uuid4())[:8]

# Initialize journey state for multi-factor weighting
state = {
    "used_train_numbers": set(),
    "used_transport_categories": set(),
    "visited_station_ids": set(),
    "visited_legs": set(),
}

print(f"Starting journey (run_id: {run_id})")

current_time = START_TIME
current_station_id = start_station_id
current_station_name = START_STATION
current_lat = start_lat
current_lon = start_lon
visited_station_ids.add(current_station_id)
state["visited_station_ids"].add(current_station_id)

while int(current_time.split("T")[1].split(":")[0]) < int(
    END_TIME.split("T")[1].split(":")[0]
):

    print(f"Current station: {current_station_name} at {current_time}")

    data = fetch_train_station_data(current_station_id, current_time)
    num_trains_available = len(data)

    # === GENERATION 4: Build ALL (train × stop) candidates, weight them all, select one ===
    if not data:
        print("Could not find valid route after max attempts, ending journey early...")
        break

    # Build all candidates across all trains
    all_candidates = build_candidates(data)
    
    if not all_candidates:
        print("Could not find valid route after max attempts, ending journey early...")
        break
    
    # Compute weights for all candidates
    weights = []
    for candidate in all_candidates:
        weight = compute_weight(candidate, state, current_time)
        weights.append(weight)
    
    # Try to find a valid candidate (some may have weight 0 due to hard constraints)
    route_found = False
    attempts = 0
    max_attempts = 5
    selected_weight = None
    
    while not route_found and attempts < max_attempts:
        # Use weighted random selection
        if sum(weights) <= 0:
            print("Could not find valid route after max attempts, ending journey early...")
            break
        
        selected_candidate = weighted_random_pick(all_candidates, weights)
        # Find the weight of the selected candidate
        selected_index = all_candidates.index(selected_candidate)
        selected_weight = weights[selected_index]
        
        attempts += 1
        
        random_line = selected_candidate["train"]
        random_entry = selected_candidate["stop"]
        stop_index_in_route = selected_candidate["stop_index"]
        
        cat = random_line.get("category")
        number = random_line.get("number")
        to = random_line.get("to")
        line_name = f"{cat}{number} to {to}"
        pass_list = random_line.get("passList", [])
        num_stops_on_train = len(pass_list)

        if (
            random_entry.get("arrival") is None
            or random_entry.get("station") is None
        ):
            continue

        random_entry_arrival = random_entry.get("arrival")
        random_entry_station_name = random_entry.get("station").get("name")
        random_entry_station_id = random_entry.get("station").get("id")
        arrival_coord = (random_entry.get("station") or {}).get(
            "coordinate"
        ) or {}
        arrival_lat = arrival_coord.get("x")
        arrival_lon = arrival_coord.get("y")

        arrival_time = random_entry_arrival

        # --- Derived metadata ---
        train_dep_str = (random_line.get("stop") or {}).get("departure")
        try:
            current_dt = datetime.datetime.fromisoformat(current_time)
            train_dep_dt = (
                datetime.datetime.fromisoformat(train_dep_str)
                if train_dep_str
                else None
            )
            arrival_dt = (
                datetime.datetime.fromisoformat(arrival_time)
                if arrival_time
                else None
            )
            wait_time_minutes = (
                round((train_dep_dt - current_dt).total_seconds() / 60, 1)
                if train_dep_dt
                else None
            )
            duration_minutes = (
                round((arrival_dt - train_dep_dt).total_seconds() / 60, 1)
                if arrival_dt and train_dep_dt
                else None
            )
        except Exception:
            wait_time_minutes = None
            duration_minutes = None

        leg_distance_km = None
        if None not in (current_lat, current_lon, arrival_lat, arrival_lon):
            leg_distance_km = round(
                haversine_km(
                    current_lat, current_lon, arrival_lat, arrival_lon
                ),
                3,
            )

        # === VALIDATION ===
        is_valid, reason = validate_route_choice(
            wait_time_minutes, random_entry_station_id, visited_station_ids
        )

        if is_valid:
            # Update cumulative distance
            if leg_distance_km is not None:
                cumulative_distance_km += leg_distance_km

            fraction_of_route = (
                round(stop_index_in_route / num_stops_on_train, 3)
                if num_stops_on_train
                else None
            )
            visited_before = random_entry_station_id in visited_station_ids

            all_stops.append(
                {
                    "run_id": run_id,
                    "generation": GENERATION,
                    "line": line_name,
                    # Stations
                    "departure_station_name": current_station_name,
                    "departure_station_id": current_station_id,
                    "arrival_station_name": random_entry_station_name,
                    "arrival_station_id": random_entry_station_id,
                    # Times
                    "train_departure": train_dep_str,
                    "arrival": arrival_time,
                    "wait_time_minutes": wait_time_minutes,
                    "duration_minutes": duration_minutes,
                    # Route context
                    "num_trains_available": num_trains_available,
                    "num_stops_on_train": num_stops_on_train,
                    "stop_index_in_route": stop_index_in_route,
                    "fraction_of_route": fraction_of_route,
                    # Geography
                    "departure_lat": current_lat,
                    "departure_lon": current_lon,
                    "arrival_lat": arrival_lat,
                    "arrival_lon": arrival_lon,
                    "leg_distance_km": leg_distance_km,
                    "cumulative_distance_km": round(cumulative_distance_km, 3),
                    # Quality flags
                    "visited_before": visited_before,
                    # Selection weight
                    "selection_weight": round(selected_weight, 6) if selected_weight else None,
                    # Hyperparameters (for optimization)
                    "minJourneyLegDistance": HYPERPARAMS["minJourneyLegDistance"],
                    "journeyLegDistanceFactor": HYPERPARAMS["journeyLegDistanceFactor"],
                    "minIdleDuration": HYPERPARAMS["minIdleDuration"],
                    "maxIdleDuration": HYPERPARAMS["maxIdleDuration"],
                    "idleDurationFactor": HYPERPARAMS["idleDurationFactor"],
                    "uniqueTrainFactor": HYPERPARAMS["uniqueTrainFactor"],
                    "uniqueMeanOfTransportFactor": HYPERPARAMS["uniqueMeanOfTransportFactor"],
                    "alreadyVisitedLegFactor": HYPERPARAMS["alreadyVisitedLegFactor"],
                    "alreadySteppedInFactor": HYPERPARAMS["alreadySteppedInFactor"],
                }
            )

            # Update state for next iteration
            visited_station_ids.add(random_entry_station_id)
            state["visited_station_ids"].add(random_entry_station_id)
            state["used_train_numbers"].add(random_line.get("number"))
            state["used_transport_categories"].add(random_line.get("category"))
            
            # Update visited legs
            from_id = random_line.get("passList")[0].get("station", {}).get("id") if random_line.get("passList") else ""
            leg_key = f"{from_id}->{random_entry_station_id}"
            state["visited_legs"].add(leg_key)
            
            current_time = arrival_time
            current_station_id = random_entry_station_id
            current_station_name = random_entry_station_name
            current_lat = arrival_lat
            current_lon = arrival_lon

            route_found = True
            break

    if not route_found:
        print(
            "Could not find valid route after max attempts, ending journey early..."
        )
        break

    time.sleep(0.5)

df = pd.DataFrame(all_stops)

# Validate consistency: arrival station of leg N should match departure station of leg N+1
if len(df) > 1:
    for i in range(len(df) - 1):
        curr_arrival = df.iloc[i]['arrival_station_id']
        next_departure = df.iloc[i + 1]['departure_station_id']
        if curr_arrival != next_departure:
            print(f"WARNING: Consistency check failed at leg {i+1}")
            print(f"  Leg {i+1} arrives at {df.iloc[i]['arrival_station_name']} ({curr_arrival})")
            print(f"  Leg {i+2} departs from {df.iloc[i+1]['departure_station_name']} ({next_departure})")

if os.path.exists(FILE_NAME):
    df.to_csv(FILE_NAME, mode="a", header=False, index=False)
else:
    df.to_csv(FILE_NAME, index=False)

print("==== Generation 4 simulation (v4_multi_factor_weights) complete!")
