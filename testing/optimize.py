"""
Genetic Algorithm Optimizer for Train Game Enjoyment Hyperparameters

This module uses pygad to optimize 8 hyperparameters controlling how enjoyable
train journeys are generated. The optimizer evolves these parameters to maximize
a composite enjoyment score based on:
- Number of visited stations
- Total distance traveled
- Variety of trains used
- Variety of transport categories used
"""

import json
import datetime
import requests
import random
import pandas as pd
import time
import math
import uuid
import os
from copy import deepcopy
from typing import Dict, Tuple, Set
import warnings
import pygad

# Import caching module
from api_cache import get_cache, cached_api_call

warnings.filterwarnings("ignore")

# ===== HYPERPARAMETER TEMPLATES =====
BASELINE_HYPERPARAMS = {
    "minJourneyLegDistance": 1,
    "journeyLegDistanceFactor": 0.3,
    "minIdleDuration": 7,
    "maxIdleDuration": 90,
    "idleDurationFactor": 0.1,
    "uniqueTrainFactor": 0.5,
    "uniqueMeanOfTransportFactor": 0.7,
    "alreadyVisitedLegFactor": 0.05,
    "alreadySteppedInFactor": 0.2,
    "preferredCategoryFactor": 0.4,
    "shortJourneyLegPenalty": 0.7,
    "minimumLegDurationPenalty": 0.8,
    "stationboardLimit": 10,
    "minimumLegDuration": 10,
}

PREFERRED_CATEGORIES = ["IC", "ICE", "IR", "EC", "TGV", "RE", "RJX"]

# ===== GA CONFIGURATION =====
GA_CONFIG = {
    "num_generations": 20,  # Reduced from 50 for faster testing
    "num_parents_mating": 6,  # Reduced proportionally
    "sol_per_pop": 12,  # Reduced from 30 for faster testing
    "mutation_type": "random",
    "mutation_percent_genes": 20,
    "crossover_type": "single_point",
    "parent_selection_type": "tournament",
    "K_tournament": 3,
}

# Number of independent journey runs per hyperparameter evaluation
# Higher = more stable fitness but slower optimization
RUNS_PER_EVALUATION = 3

# Random seed for evaluating baseline and optimized solutions
# Use separate seed from GA to ensure fair comparison with identical random sequence
EVAL_SEED = 123

# ===== JOURNEY SIMULATION SETTINGS =====
START_TIME = "2026-05-25T08:00:00+0200"
START_STATION = "biel"
END_TIME = "2026-05-25T16:00:00+0200"
CSV_FILE_NAME = "train_stops_optimized.csv"
GENERATION = "ga_optimized"


# ===== JOURNEY SIMULATION FUNCTIONS =====
def fetch_train_station_by_name(station_name):
    """Fetch train station info by name from the API."""

    def _fetch():
        query = f"https://transport.opendata.ch/v1/locations?query={station_name}"
        response = requests.get(query)
        time.sleep(0.1)  # Add delay to avoid rate limiting
        return response.json().get("stations", [])

    cache = get_cache()
    stations = cache.get_or_fetch("locations", _fetch, cache_key_args=(station_name,))
    return [d for d in stations if d.get("icon") == "train"]


def fetch_train_station_data(station_id, datetime_for_departure, limit=10):
    """Fetch stationboard data for a given station and time."""
    if isinstance(datetime_for_departure, str):
        datetime_for_departure = datetime.datetime.fromisoformat(datetime_for_departure)
        datetime_for_departure = datetime_for_departure.strftime("%Y-%m-%d %H:%M")

    def _fetch():
        info = f"https://transport.opendata.ch/v1/stationboard?id={station_id}&limit={limit}&datetime={datetime_for_departure}"
        response = requests.get(info)
        time.sleep(0.1)  # Add delay to avoid rate limiting
        return response.json().get("stationboard", [])

    cache = get_cache()
    return cache.get_or_fetch(
        "stationboard", _fetch, cache_key_args=(station_id, datetime_for_departure)
    )


def deduplicate_stationboard(stationboard, current_time):
    """
    Deduplicate trains by (category, number, destination).
    Keep only the first train (earliest departure) for each unique line.
    """
    seen = {}
    
    try:
        current_dt = datetime.datetime.fromisoformat(current_time)
    except Exception:
        return stationboard
    
    for train in stationboard:
        # Create a unique key from category, number, and destination
        key = f"{train.get('category')}::{train.get('number')}::{train.get('to', '')}"
        
        # Check if this train has already been seen
        if key not in seen:
            # For the first occurrence, just add it
            seen[key] = train
        else:
            # For subsequent occurrences, keep the one with the earliest departure after min_wait
            current_entry = seen[key]
            current_dep_str = (current_entry.get("stop") or {}).get("departure")
            new_dep_str = (train.get("stop") or {}).get("departure")
            
            try:
                current_dep_dt = datetime.datetime.fromisoformat(current_dep_str) if current_dep_str else None
                new_dep_dt = datetime.datetime.fromisoformat(new_dep_str) if new_dep_str else None
                
                current_wait = (current_dep_dt - current_dt).total_seconds() / 60 if current_dep_dt else None
                new_wait = (new_dep_dt - current_dt).total_seconds() / 60 if new_dep_dt else None
                
                # Keep the train with the earliest departure that hasn't passed yet
                # Prefer trains with valid (non-negative) wait times
                current_valid = current_wait is None or current_wait >= 0
                new_valid = new_wait is None or new_wait >= 0
                
                if new_valid and not current_valid:
                    seen[key] = train
                elif current_valid and new_valid:
                    if current_wait is None:
                        current_wait = float('inf')
                    if new_wait is None:
                        new_wait = float('inf')
                    if new_wait < current_wait:
                        seen[key] = train
            except Exception:
                # If we can't parse times, keep the current entry
                pass
    
    return list(seen.values())


def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two coordinates using haversine formula."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def validate_route_choice(
    wait_time_minutes, arrival_station_id, visited_station_ids, hyperparams
):
    """Validate if a chosen route meets the constraints."""
    if wait_time_minutes is None:
        return False, "Missing time data"

    if wait_time_minutes > hyperparams["maxIdleDuration"]:
        return False, f"Wait time {wait_time_minutes:.0f}m exceeds max"

    if wait_time_minutes < hyperparams["minIdleDuration"]:
        return False, f"Connection gap too tight"

    if arrival_station_id in visited_station_ids:
        return False, "Station already visited"

    return True, "Valid"


def build_candidates(stationboard):
    """Flatten all (train × stop) tuples from the stationboard."""
    candidates = []
    for train in stationboard:
        pass_list = train.get("passList", [])
        if len(pass_list) < 2:
            continue
        for i in range(1, len(pass_list)):
            stop = pass_list[i]
            if not stop.get("arrival") or not stop.get("station"):
                continue
            candidates.append({"train": train, "stop": stop, "stop_index": i})
    return candidates


def compute_weight(candidate, state, current_time, hyperparams):
    """Compute a non-negative weight for a single (train × stop) candidate."""
    train = candidate["train"]
    stop = candidate["stop"]
    stop_index = candidate["stop_index"]
    p = hyperparams

    if stop_index < p["minJourneyLegDistance"]:
        return 0

    dest_id = stop.get("station", {}).get("id")
    if dest_id and dest_id in state["visited_station_ids"]:
        return 0

    train_dep_str = (train.get("stop") or {}).get("departure")
    try:
        current_dt = datetime.datetime.fromisoformat(current_time)
        train_dep_dt = (
            datetime.datetime.fromisoformat(train_dep_str) if train_dep_str else None
        )
        wait_time_minutes = (
            round((train_dep_dt - current_dt).total_seconds() / 60, 1)
            if train_dep_dt
            else None
        )
    except Exception:
        wait_time_minutes = None

    if wait_time_minutes is not None:
        if wait_time_minutes < p["minIdleDuration"]:
            return 0
        if wait_time_minutes > p["maxIdleDuration"]:
            return 0

    weight = 1.0

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

    # --- Penalize very short duration legs (< minimumLegDuration) ---
    train_dep_str = (train.get("stop") or {}).get("departure")
    leg_arrival_str = stop.get("arrival")
    if train_dep_str and leg_arrival_str:
        try:
            train_dep_dt = datetime.datetime.fromisoformat(train_dep_str)
            leg_arrival_dt = datetime.datetime.fromisoformat(leg_arrival_str)
            duration_minutes = (leg_arrival_dt - train_dep_dt).total_seconds() / 60
            if duration_minutes < p["minimumLegDuration"]:
                weight *= max(0.1, 1 - p["minimumLegDurationPenalty"])
        except Exception:
            pass

    if wait_time_minutes is not None and p["idleDurationFactor"] > 0:
        range_val = p["maxIdleDuration"] - p["minIdleDuration"]
        # Linear decay: 100% reward at minIdleDuration, 0% at maxIdleDuration
        normalized = max(0, 1 - (wait_time_minutes - p["minIdleDuration"]) / range_val)
        weight *= 1 + normalized * p["idleDurationFactor"]

    if train["number"] not in state["used_train_numbers"]:
        weight *= 1 + p["uniqueTrainFactor"]
    if train["category"] not in state["used_transport_categories"]:
        weight *= 1 + p["uniqueMeanOfTransportFactor"]

    if train["category"] in PREFERRED_CATEGORIES:
        weight *= 1 + p["preferredCategoryFactor"]

    from_id = (
        train.get("passList", [{}])[0].get("station", {}).get("id")
        if train.get("passList")
        else ""
    )
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


def append_journey_to_csv(df, csv_file=CSV_FILE_NAME):
    """Append journey DataFrame to CSV file with same format as main.py."""
    import os
    
    if len(df) == 0:
        return
    
    if os.path.exists(csv_file):
        df.to_csv(csv_file, mode="a", header=False, index=False)
    else:
        df.to_csv(csv_file, index=False)


def simulate_journey(hyperparams: Dict) -> Tuple[pd.DataFrame, Dict]:
    """
    Simulate a single train journey with given hyperparameters.

    Returns:
        (df, stats) - DataFrame with journey legs and computed statistics
    """
    try:
        start_station_info = fetch_train_station_by_name(START_STATION)[0]
        start_station_id = start_station_info.get("id")
        start_lat = start_station_info.get("coordinate", {}).get("x")
        start_lon = start_station_info.get("coordinate", {}).get("y")
    except (IndexError, KeyError):
        return pd.DataFrame(), {
            "visited_stations": 0,
            "distance_km": 0,
            "unique_trains": 0,
            "unique_categories": 0,
        }

    all_stops = []
    visited_station_ids = set()
    cumulative_distance_km = 0.0
    run_id = str(uuid.uuid4())[:8]

    state = {
        "used_train_numbers": set(),
        "used_transport_categories": set(),
        "visited_station_ids": set(),
        "visited_legs": set(),
    }

    current_time = START_TIME
    current_station_id = start_station_id
    current_station_name = START_STATION
    current_lat = start_lat
    current_lon = start_lon
    visited_station_ids.add(current_station_id)
    state["visited_station_ids"].add(current_station_id)

    max_hour = int(END_TIME.split("T")[1].split(":")[0])

    while int(current_time.split("T")[1].split(":")[0]) < max_hour:
        data = fetch_train_station_data(current_station_id, current_time, hyperparams["stationboardLimit"])
        data = deduplicate_stationboard(data, current_time)
        num_trains_available = len(data)

        if not data:
            break

        all_candidates = build_candidates(data)
        if not all_candidates:
            break

        weights = []
        for candidate in all_candidates:
            weight = compute_weight(candidate, state, current_time, hyperparams)
            weights.append(weight)

        route_found = False
        attempts = 0
        max_attempts = 5

        while not route_found and attempts < max_attempts:
            if sum(weights) <= 0:
                break

            selected_candidate = weighted_random_pick(all_candidates, weights)
            selected_index = all_candidates.index(selected_candidate)
            selected_weight = weights[selected_index]
            attempts += 1

            random_line = selected_candidate["train"]
            random_entry = selected_candidate["stop"]
            stop_index_in_route = selected_candidate["stop_index"]

            if (
                random_entry.get("arrival") is None
                or random_entry.get("station") is None
            ):
                continue

            random_entry_arrival = random_entry.get("arrival")
            random_entry_station_name = random_entry.get("station").get("name")
            random_entry_station_id = random_entry.get("station").get("id")
            arrival_coord = (random_entry.get("station") or {}).get("coordinate") or {}
            arrival_lat = arrival_coord.get("x")
            arrival_lon = arrival_coord.get("y")

            arrival_time = random_entry_arrival
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
                    haversine_km(current_lat, current_lon, arrival_lat, arrival_lon),
                    3,
                )

            is_valid, _ = validate_route_choice(
                wait_time_minutes,
                random_entry_station_id,
                visited_station_ids,
                hyperparams,
            )

            if is_valid:
                if leg_distance_km is not None:
                    cumulative_distance_km += leg_distance_km

                # Build line name
                cat = random_line.get("category")
                number = random_line.get("number")
                to = random_line.get("to")
                line_name = f"{cat}{number} to {to}"
                pass_list = random_line.get("passList", [])
                num_stops_on_train = len(pass_list)
                
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
                        "minJourneyLegDistance": hyperparams["minJourneyLegDistance"],
                        "journeyLegDistanceFactor": hyperparams["journeyLegDistanceFactor"],
                        "minIdleDuration": hyperparams["minIdleDuration"],
                        "maxIdleDuration": hyperparams["maxIdleDuration"],
                        "idleDurationFactor": hyperparams["idleDurationFactor"],
                        "uniqueTrainFactor": hyperparams["uniqueTrainFactor"],
                        "uniqueMeanOfTransportFactor": hyperparams["uniqueMeanOfTransportFactor"],
                        "alreadyVisitedLegFactor": hyperparams["alreadyVisitedLegFactor"],
                        "alreadySteppedInFactor": hyperparams["alreadySteppedInFactor"],
                    }
                )

                visited_station_ids.add(random_entry_station_id)
                state["visited_station_ids"].add(random_entry_station_id)
                state["used_train_numbers"].add(random_line.get("number"))
                state["used_transport_categories"].add(random_line.get("category"))

                from_id = (
                    random_line.get("passList")[0].get("station", {}).get("id")
                    if random_line.get("passList")
                    else ""
                )
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
            break

    df = pd.DataFrame(all_stops)
    
    # Append to CSV in real-time
    append_journey_to_csv(df)

    stats = {
        "visited_stations": len(visited_station_ids),
        "distance_km": cumulative_distance_km,
        "unique_trains": len(state["used_train_numbers"]),
        "unique_categories": len(state["used_transport_categories"]),
        "num_legs": len(all_stops),
    }

    return df, stats


def calculate_enjoyment_score(stats: Dict) -> float:
    """
    Calculate composite enjoyment score from journey statistics.

    Weighing:
    - Visited stations: base factor (most important for exploration)
    - Distance: secondary factor (longer journeys are better)
    - Unique trains: bonus for variety
    - Unique categories: bonus for diversity in transport types
    """
    score = (
        stats["visited_stations"] * 10
        + stats["distance_km"] * 1.0
        + stats["unique_trains"] * 5
        + stats["unique_categories"] * 5
    )
    return max(score, 0.001)  # Avoid zero division


# ===== PYGAD SETUP =====
def fitness_function(ga_instance, solution, solution_idx):
    """
    Fitness function for pygad.

    Takes a solution vector (hyperparameters) and runs multiple journeys,
    returning the average enjoyment score. This reduces variance from
    random journey branching.

    Higher score = better fitness.
    """
    hyperparams = BASELINE_HYPERPARAMS.copy()

    param_names = list(BASELINE_HYPERPARAMS.keys())
    for i, param_name in enumerate(param_names):
        hyperparams[param_name] = solution[i]

    try:
        # Run multiple journeys and aggregate results
        enjoyment_scores = []
        for run_idx in range(RUNS_PER_EVALUATION):
            df, stats = simulate_journey(hyperparams)
            enjoyment = calculate_enjoyment_score(stats)
            enjoyment_scores.append(enjoyment)

        # Return average enjoyment across all runs
        avg_enjoyment = sum(enjoyment_scores) / len(enjoyment_scores)
        return avg_enjoyment
    except Exception as e:
        print(f"Error evaluating solution {solution_idx}: {e}")
        return 0.001


def on_generation(ga_instance):
    """Callback called at the end of each generation."""
    best_fitness = ga_instance.best_solutions_fitness[-1]
    print(
        f"Generation {ga_instance.generations_completed}: Best Fitness = {best_fitness:.4f}"
    )


# ===== MAIN OPTIMIZATION FUNCTION =====
def optimize_hyperparameters():
    """
    Run the genetic algorithm optimization.
    """
    param_names = list(BASELINE_HYPERPARAMS.keys())

    gene_space = [
        {"low": 1, "high": 10},  # minJourneyLegDistance
        {"low": 0.1, "high": 1.0},  # journeyLegDistanceFactor
        {"low": 1, "high": 10},  # minIdleDuration
        {"low": 30, "high": 120},  # maxIdleDuration
        {"low": 0.01, "high": 0.5},  # idleDurationFactor
        {"low": 0.1, "high": 2.0},  # uniqueTrainFactor
        {"low": 0.1, "high": 2.0},  # uniqueMeanOfTransportFactor
        {"low": 0.01, "high": 0.5},  # alreadyVisitedLegFactor
        {
            "low": 0.01,
            "high": 0.5,
        },  # alreadySteppedInFactor (not used in main logic but included for completeness)
    ]

    print("=" * 80)
    print("TRAIN GAME HYPERPARAMETER OPTIMIZATION")
    print("=" * 80)
    print(f"\nOptimizing {len(param_names)} hyperparameters:")
    for i, name in enumerate(param_names):
        space = gene_space[i]
        print(f"  {i+1}. {name}: [{space['low']}, {space['high']}]")

    print(f"\nGenetic Algorithm Configuration:")
    print(f"  Population size: {GA_CONFIG['sol_per_pop']}")
    print(f"  Generations: {GA_CONFIG['num_generations']}")
    print(f"  Mutation rate: {GA_CONFIG['mutation_percent_genes']}%")
    print(f"  Crossover type: {GA_CONFIG['crossover_type']}")
    print(f"  Runs per evaluation: {RUNS_PER_EVALUATION} (for variance reduction)")

    # Evaluate baseline with multiple runs for stability
    print(f"\nEvaluating baseline across {RUNS_PER_EVALUATION} runs...")
    random.seed(EVAL_SEED)
    baseline_scores = []
    baseline_all_stats = []
    for run_idx in range(RUNS_PER_EVALUATION):
        df, stats = simulate_journey(BASELINE_HYPERPARAMS)
        enjoyment = calculate_enjoyment_score(stats)
        baseline_scores.append(enjoyment)
        baseline_all_stats.append(stats)

    baseline_enjoyment = sum(baseline_scores) / len(baseline_scores)
    # Use stats from last run for reporting
    baseline_stats = baseline_all_stats[-1]

    print(f"\nBaseline (current hyperparameters):")
    print(
        f"  Average Enjoyment Score: {baseline_enjoyment:.4f} (std: {(sum((x-baseline_enjoyment)**2 for x in baseline_scores)/len(baseline_scores))**0.5:.4f})"
    )
    print(f"  Visited Stations: {baseline_stats['visited_stations']}")
    print(f"  Distance (km): {baseline_stats['distance_km']:.2f}")
    print(f"  Unique Trains: {baseline_stats['unique_trains']}")
    print(f"  Unique Categories: {baseline_stats['unique_categories']}")

    print("\n" + "=" * 80)
    print("Starting optimization...\n")

    # Create initial population seeded with baseline and variations
    initial_population = []

    # Add baseline as-is
    baseline_solution = [BASELINE_HYPERPARAMS[name] for name in param_names]
    initial_population.append(baseline_solution)

    # Add variations of baseline (perturbed by ±10-30%)
    for variation in range(GA_CONFIG["sol_per_pop"] - 1):
        perturbed = baseline_solution.copy()
        for gene_idx in range(len(perturbed)):
            space = gene_space[gene_idx]
            low, high = space["low"], space["high"]
            # Random perturbation of baseline
            perturbation = random.uniform(0.7, 1.3)  # ±30% variation
            new_val = perturbed[gene_idx] * perturbation
            # Clamp to gene space bounds
            perturbed[gene_idx] = max(low, min(high, new_val))
        initial_population.append(perturbed)

    initial_population = [list(x) for x in initial_population]

    try:
        ga = pygad.GA(
            num_generations=GA_CONFIG["num_generations"],
            num_parents_mating=GA_CONFIG["num_parents_mating"],
            fitness_func=fitness_function,
            sol_per_pop=GA_CONFIG["sol_per_pop"],
            num_genes=len(param_names),
            gene_space=gene_space,
            mutation_type=GA_CONFIG["mutation_type"],
            mutation_percent_genes=GA_CONFIG["mutation_percent_genes"],
            crossover_type=GA_CONFIG["crossover_type"],
            parent_selection_type=GA_CONFIG["parent_selection_type"],
            K_tournament=GA_CONFIG["K_tournament"],
            on_generation=on_generation,
            random_seed=42,  # For reproducibility
            initial_population=initial_population,  # Seed with baseline
            keep_elitism=2,  # Keep top 2 solutions between generations
            save_best_solutions=True,
        )
    except Exception as e:
        print(f"ERROR initializing GA: {e}")
        import traceback

        traceback.print_exc()
        return None, None

    try:
        ga.run()
    except Exception as e:
        print(f"ERROR during GA.run(): {e}")
        import traceback

        traceback.print_exc()
        return None, None

    solution, solution_fitness, solution_idx = ga.best_solution()

    optimized_hyperparams = BASELINE_HYPERPARAMS.copy()
    for i, param_name in enumerate(param_names):
        optimized_hyperparams[param_name] = solution[i]

    # Evaluate optimized solution with multiple runs for fair comparison
    print(f"\nEvaluating optimized solution across {RUNS_PER_EVALUATION} runs...")
    random.seed(EVAL_SEED)
    optimized_scores = []
    optimized_all_stats = []
    for run_idx in range(RUNS_PER_EVALUATION):
        df, stats = simulate_journey(optimized_hyperparams)
        enjoyment = calculate_enjoyment_score(stats)
        optimized_scores.append(enjoyment)
        optimized_all_stats.append(stats)

    optimized_enjoyment = sum(optimized_scores) / len(optimized_scores)
    # Use stats from last run for reporting
    optimized_stats = optimized_all_stats[-1]

    print("\n" + "=" * 80)
    print("OPTIMIZATION RESULTS")
    print("=" * 80)

    print("\nOptimized Hyperparameters:")
    for i, param_name in enumerate(param_names):
        baseline_val = BASELINE_HYPERPARAMS[param_name]
        optimized_val = solution[i]
        change = (
            ((optimized_val - baseline_val) / baseline_val * 100)
            if baseline_val != 0
            else 0
        )
        print(f"  {param_name}:")
        print(f"    Baseline:  {baseline_val}")
        print(f"    Optimized: {optimized_val:.4f}")
        print(f"    Change:    {change:+.1f}%")

    print(f"\nOptimized Enjoyment Score: {optimized_enjoyment:.4f}")
    print(f"Baseline Enjoyment Score:  {baseline_enjoyment:.4f}")
    improvement = (optimized_enjoyment - baseline_enjoyment) / baseline_enjoyment * 100
    print(f"Improvement: {improvement:+.1f}%")

    print(f"\nOptimized Journey Stats:")
    print(
        f"  Visited Stations: {optimized_stats['visited_stations']} (baseline: {baseline_stats['visited_stations']})"
    )
    print(
        f"  Distance (km): {optimized_stats['distance_km']:.2f} (baseline: {baseline_stats['distance_km']:.2f})"
    )
    print(
        f"  Unique Trains: {optimized_stats['unique_trains']} (baseline: {baseline_stats['unique_trains']})"
    )
    print(
        f"  Unique Categories: {optimized_stats['unique_categories']} (baseline: {baseline_stats['unique_categories']})"
    )
    print(
        f"  Number of Legs: {optimized_stats['num_legs']} (baseline: {baseline_stats['num_legs']})"
    )

    results = {
        "optimization_metadata": {
            "timestamp": datetime.datetime.now().isoformat(),
            "ga_config": GA_CONFIG,
            "enjoyment_formula": "stations*10 + distance*1 + unique_trains*5 + unique_categories*5",
        },
        "baseline": {
            "hyperparameters": BASELINE_HYPERPARAMS,
            "enjoyment_score": baseline_enjoyment,
            "stats": baseline_stats,
        },
        "optimized": {
            "hyperparameters": {
                param_names[i]: float(solution[i]) for i in range(len(param_names))
            },
            "enjoyment_score": float(optimized_enjoyment),
            "stats": optimized_stats,
        },
        "improvement_percent": improvement,
    }

    with open("optimization_results.json", "w") as f:
        json.dump(results, f, indent=2)

    # Print cache statistics
    cache = get_cache()
    cache_stats = cache.get_stats()
    print("\n" + "=" * 80)
    print("API CACHE STATISTICS")
    print("=" * 80)
    print(f"Total API calls: {cache_stats['total_calls']}")
    print(f"Cache hits: {cache_stats['hits']}")
    print(f"Cache misses: {cache_stats['misses']}")
    print(f"Hit rate: {cache_stats['hit_rate']:.1f}%")
    print(f"Time saved: ~{cache_stats['hits'] * 0.6:.0f} seconds (estimated)")

    print("\nResults saved to optimization_results.json")
    print("=" * 80)

    return optimized_hyperparams, results


if __name__ == "__main__":
    optimize_hyperparameters()
