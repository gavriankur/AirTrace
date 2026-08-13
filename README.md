# Airtrace

Airtrace prepares a flight while the user is online, then estimates the aircraft's position while offline. It retrieves the itinerary by flight number, calculates an airport-to-airport route, stores the prepared journey locally, and advances a moving aircraft marker using the device clock.

This is an **estimated journey**, not live aircraft tracking.

## What is free

- **MapLibre GL JS** renders the interactive vector map. Its browser bundle is included in `vendor/`, so the map engine itself works offline.
- **OpenFreeMap** supplies OpenStreetMap-based map tiles with no API key. Tiles viewed while online are cached by the service worker for the flight.
- **AeroDataBox via RapidAPI** supplies flight-number, schedule, airport, and status data. AeroDataBox advertises a limited free RapidAPI plan of unrestricted duration. Quotas and terms can change, so verify them before launch.
- **GitHub Pages** hosts the static frontend for free.
- **Cloudflare Workers** can host the small API proxy within Cloudflare's free allowance for a side project.

The current version does not claim to use historical trajectories. Reliable historical flight tracks are the difficult/usually paid part of aviation data. The app labels its route as a **schedule-based route estimate** and uses great-circle geometry. You can later add a licensed track provider without changing the offline frontend data format.

## Architecture

- `index.html`, `styles.css`, `app.js`: static GitHub Pages frontend
- `vendor/`: local MapLibre browser files
- `sw.js`: offline frontend and viewed-map-resource cache
- browser `localStorage`: prepared journey saved on the device
- `worker/worker.js`: secure flight lookup and route-preparation service
- AeroDataBox: flight-number search, schedule, status, and airport coordinates
- OpenFreeMap: detailed online map resources, cached as they are viewed

The API key is stored only as a Worker secret. Never put it in `config.js`, GitHub, or browser code.

## 1. Create a free AeroDataBox key

1. Open <https://aerodatabox.com/pricing/>.
2. Choose the RapidAPI free plan.
3. Subscribe and copy the RapidAPI key.

The Worker calls the official `Flight Status (single day)` endpoint by flight number and date. The frontend never sees the key.

## 2. Deploy the data Worker

Install Wrangler and authenticate:

```bash
npm install -g wrangler
wrangler login
```

From the `worker` directory, save the key as a secret and deploy:

```bash
wrangler secret put AERODATABOX_RAPIDAPI_KEY
wrangler deploy
```

Wrangler prints a URL similar to:

```text
https://airtrace-api.your-subdomain.workers.dev
```

Edit `config.js` and set that URL as `API_BASE_URL`.

After GitHub Pages is live, replace `ALLOWED_ORIGINS = "*"` in `worker/wrangler.toml` with the exact site origin, then deploy the Worker again.

## 3. Publish the frontend on GitHub Pages

Upload everything in this folder to a GitHub repository. In the repository:

1. Open **Settings → Pages**.
2. Choose **Deploy from a branch**.
3. Select `main` and `/root`.
4. Save.

Open the HTTPS Pages URL while online before the flight. Prepare the flight and leave the route visible until the detailed map finishes loading. The service worker stores the app, the prepared journey, and map resources used by the fitted route view.

## How the estimate works

1. The Worker queries AeroDataBox for the selected flight number and departure date.
2. It selects the operating flight with usable airports and times.
3. It creates 121 great-circle points between the published airport coordinates.
4. A simple climb/cruise/descent altitude profile is attached.
5. The browser stores the result in `localStorage`.
6. Offline progress is calculated from the device clock and saved departure/arrival timestamps.
7. MapLibre smoothly moves and rotates the aircraft marker along the prepared route.

## Offline map limits

The app caches map resources that were actually requested while online. It does **not** bulk-download the world map. The fitted route view should remain available, but zooming or panning into areas that were never viewed may show missing detail in airplane mode. The route data and aircraft estimate remain available even if a map tile is missing.

## Important limitations

- It cannot know about a reroute, diversion, hold, wind, weather avoidance, or runway change after preparation.
- Delays received after airplane mode begins cannot update the saved timeline.
- The path is great-circle geometry, not the filed ATC route and not a historical average.
- A flight number may have more than one operation per day; this version chooses the best matching operating record automatically.
- Provider coverage, quota, and terms can change. Recheck them before public or commercial use.
