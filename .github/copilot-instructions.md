# Copilot Instructions for TrainStationGame2

## Build & Development Commands

- **Development**: `npm run dev` - Starts Vite dev server with hot reload
- **Build**: `npm run build` - Creates single-file production build (`dist/index.html`)
- **Type check**: `npx tsc --noEmit` - Validate TypeScript without emitting files

**Build System**: The project uses Vite with `vite-plugin-singlefile` to bundle everything into a single HTML file. All dependencies are bundled; there is no separate bundle loading at runtime.

## Architecture Overview

The application is a single-page game built in TypeScript that challenges players to complete train journeys using Swiss public transport data.

### Core Modules

1. **`src/index.ts`** (main entry point)
   - DOM initialization and UI event handlers
   - Journey display and user interaction
   - Toast notification system
   - Integrates with simulation and hyperparameters modules

2. **`src/simulation.ts`** (journey generation engine)
   - `runSimulation()` - Core algorithm that generates valid train journeys
   - Fetches real train data from `transport.opendata.ch` API
   - `SimulationLeg` type represents each leg of a journey with metadata (times, platforms, distance)
   - Uses weighted selection based on hyperparameters to generate diverse, playable journeys

3. **`src/hyperparams.ts`** (parameter management)
   - `HyperparamsData` interface defines 9 tuning parameters (distance factors, idle duration, uniqueness weights, etc.)
   - Loads/saves parameters to localStorage for persistence
   - `DEFAULT_HYPERPARAMS` provides baseline values (tuned via Python GA in `testing/` directory)

### Data Flow

1. User provides GPS location → app fetches nearby train stations
2. `runSimulation()` generates a valid multi-leg journey to a random destination
3. Player attempts to complete the journey by booking each leg
4. Journey state persists in cookies for session continuity

### Type System

- Heavy use of discriminated unions (e.g., `Coordinate`, `TrainStation`, `TrainStationBoardEntry`)
- Strict TypeScript mode enabled: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- All external API responses are typed before use
- Use `type` for type-only exports (not `interface`) to comply with `verbatimModuleSyntax` setting

## Key Conventions

### Hyperparameter Tuning

- The 9 parameters in `HyperparamsData` are "selection knobs" that weight different aspects of journey candidates
- Python genetic algorithm in `testing/optimize.py` sweeps these parameters to maximize journey quality
- When modifying selection logic, ensure new factors are added as hyperparameters (not hard-coded multipliers)
- Export new parameters as fields in `HyperparamsData` and add to `HYPERPARAM_KEYS` array

### External API Integration

- Swiss transport API (`transport.opendata.ch`) is fetched client-side (no backend)
- API results are cached locally to reduce request volume
- Implement fetch with error handling and timeout fallbacks
- Never hardcode API keys; API is public

### DOM & UI

- UI uses Pico CSS for styling (minimal custom CSS)
- Toast notifications use fixed positioning and CSS animations (see `showToast()` pattern)
- All UI state lives in HTML elements; no separate state manager
- DOM selectors should use stable IDs (not class names prone to Pico CSS changes)

### Testing & Analysis

- No unit test framework configured
- The `testing/` directory is separate Python infrastructure for hyperparameter analysis
- Use `analysis_train_game_biases.ipynb` for exploratory data analysis of journey quality
- Run Python tests/analysis independently: `cd testing && python main.py` or use Jupyter notebooks

## File Organization

```
src/
├── index.ts           # UI and main app logic
├── simulation.ts      # Journey generation algorithm
└── hyperparams.ts     # Parameter loading/saving

testing/              # Python optimization suite (independent from web app)
├── optimize.py       # Genetic algorithm for hyperparameter tuning
├── main.py          # Analysis and testing
└── *.ipynb          # Jupyter notebooks for exploration
```

## Important Notes

- **Single-file build**: The output is a self-contained HTML file with all CSS, JS, and assets inlined. Avoid importing large external libraries.
- **No runtime dependencies**: Production build has only one dependency (`@picocss/pico`); keep it this way.
- **localStorage keys**: Hyperparameter storage key is `"trainGameHyperparams"`. Be careful if refactoring storage logic.
- **API responses**: `transport.opendata.ch` response format is documented in code comments; check before adding new API calls.
