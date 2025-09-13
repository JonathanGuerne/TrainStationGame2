# Train Game

A web-based game that challenges players to plan train journeys using real-time Swiss public transport data. Built with TypeScript, Vite, and Pico CSS.

## Features

- Fetches real train station and departure data based on your GPS location (uses [transport.opendata.ch](https://transport.opendata.ch/)).
- Randomly generates train journeys for the player to complete.
- Stores journey history in cookies for session persistence.
- Clean, responsive UI using Pico CSS.
- Deployable as a single HTML file (via vite-plugin-singlefile).

## Getting Started

### Prerequisites

- Node.js (v20 recommended)
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/JonathanGuerne/TrainStationGame2.git
   cd TrainStationGame2
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Development

To start a local development server:

```bash
npm run dev
```

### Build

To build a single-file distributable:

```bash
npm run build
```

The output will be in the `dist/` folder as a single `index.html` file.

### Deployment

This project is configured to deploy automatically to GitHub Pages using GitHub Actions. On every push to the `main` branch, the site will be built and published to GitHub Pages.

## License

MIT

## Credits

- [Pico CSS](https://picocss.com/) for the UI framework
- [Swiss public transport API](https://transport.opendata.ch/)
