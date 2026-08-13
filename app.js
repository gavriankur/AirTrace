const STORAGE_KEY = "airtrace.preparedJourney.v2";
const config = window.AIRTRACE_CONFIG || {};
const $ = id => document.getElementById(id);

let journey = null;
let previewProgress = null;
let clockTimer = null;
let animationFrame = null;
let map = null;
let planeMarker = null;
let mapReady = false;

function setDefaultDate() {
  const tomorrow = new Date(Date.now() + 86400000);
  $("flightDate").value = tomorrow.toISOString().slice(0, 10);
}

function setNetworkState() {
  const online = navigator.onLine;
  document.body.classList.toggle("offline", !online);
  $("network").classList.toggle("offline", !online);
  $("network").querySelector("b").textContent = online ? "Online — ready to prepare" : "Offline — using saved data";
}

function cleanFlightNumber(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60000));
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function formatClock(iso, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short"
  }).format(new Date(iso));
}

function interpolateRoute(points, progress) {
  if (!points.length) return { lat: 0, lon: 0, altitudeFt: 0 };
  if (progress <= points[0].progress) return points[0];
  if (progress >= points.at(-1).progress) return points.at(-1);

  let rightIndex = points.findIndex(point => point.progress >= progress);
  let left = points[rightIndex - 1];
  let right = points[rightIndex];
  let amount = (progress - left.progress) / (right.progress - left.progress || 1);
  let longitudeDelta = right.lon - left.lon;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;
  let lon = left.lon + longitudeDelta * amount;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;

  return {
    lat: left.lat + (right.lat - left.lat) * amount,
    lon,
    altitudeFt: Math.round((left.altitudeFt || 0) + ((right.altitudeFt || 0) - (left.altitudeFt || 0)) * amount)
  };
}

function unwrapRoute(points) {
  const coordinates = [];
  let previous = null;
  points.forEach(point => {
    let lon = point.lon;
    if (previous !== null) {
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
    }
    coordinates.push([lon, point.lat]);
    previous = lon;
  });
  return coordinates;
}

function routeGeoJson() {
  const coordinates = unwrapRoute(journey.route.points);
  const start = coordinates[0];
  const end = coordinates.at(-1);
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "route" }, geometry: { type: "LineString", coordinates } },
      { type: "Feature", properties: { kind: "airport" }, geometry: { type: "Point", coordinates: start } },
      { type: "Feature", properties: { kind: "airport" }, geometry: { type: "Point", coordinates: end } }
    ]
  };
}

function planeElement() {
  const element = document.createElement("div");
  element.className = "plane-marker";
  element.setAttribute("aria-label", "Estimated aircraft position");
  element.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="plane-disc" cx="20" cy="20" r="16"/><path class="plane-shape" d="M18.5 21.2 9 17.3l1.4-2.1 9.6 1.8 5.1-8.3 3 1-2.8 8.8 5.8 4.3-1.8 2.3-6.2-2.3-3.4 8.3-2.8-.8.5-8.8Z"/></svg>`;
  return element;
}

function bearingBetween(a, b) {
  const toRadians = value => value * Math.PI / 180;
  const toDegrees = value => value * 180 / Math.PI;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function fitRoute() {
  if (!mapReady || !journey) return;
  const coordinates = unwrapRoute(journey.route.points);
  if (!coordinates.length) return;
  const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

  const refit = () => {
    map.resize();
    map.fitBounds(bounds, {
      padding: { top: 75, right: 75, bottom: 75, left: 75 },
      maxZoom: 9,
      duration: 500
    });
  };

  requestAnimationFrame(refit);
  setTimeout(refit, 300);
  setTimeout(refit, 1000);
}

function updateMapRoute() {
  if (!mapReady || !journey) return;
  const data = routeGeoJson();
  if (map.getSource("journey")) map.getSource("journey").setData(data);
  else {
    map.addSource("journey", { type: "geojson", data });
    map.addLayer({ id: "journey-line-shadow", type: "line", source: "journey", filter: ["==", ["get", "kind"], "route"], paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": .82 } });
    map.addLayer({ id: "journey-line", type: "line", source: "journey", filter: ["==", ["get", "kind"], "route"], paint: { "line-color": "#ff6b2c", "line-width": 3, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "journey-airports", type: "circle", source: "journey", filter: ["==", ["get", "kind"], "airport"], paint: { "circle-radius": 6, "circle-color": "#ff6b2c", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  }
  if (!planeMarker) planeMarker = new maplibregl.Marker({ element: planeElement(), rotationAlignment: "map", pitchAlignment: "map" }).addTo(map);
  fitRoute();
}

function initializeMap() {
  if (map || !window.maplibregl) return;
  map = new maplibregl.Map({
    container: "mapCanvas",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [0, 24],
    zoom: 1.2,
    attributionControl: true,
    renderWorldCopies: true
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    mapReady = true;
    $("mapLoading").classList.add("ready");
    updateMapRoute();
  });
  map.on("error", event => {
    if (!mapReady && !navigator.onLine) $("mapLoading").textContent = "Offline map detail was not cached — route data is still saved";
    if (event?.error) console.warn("Map resource unavailable", event.error.message);
  });
}

function currentClockProgress() {
  const start = new Date(journey.flight.departureUtc).getTime();
  const end = new Date(journey.flight.arrivalUtc).getTime();
  return clamp((Date.now() - start) / (end - start));
}

function updatePlaneMarker(progress) {
  if (!planeMarker || !journey) return;
  const point = interpolateRoute(journey.route.points, progress);
  const ahead = interpolateRoute(journey.route.points, Math.min(1, progress + .002));
  planeMarker.setLngLat([point.lon, point.lat]);
  planeMarker.setRotation(bearingBetween(point, ahead));
}

function renderTracker() {
  const progress = previewProgress === null ? currentClockProgress() : previewProgress;
  const point = interpolateRoute(journey.route.points, progress);
  const now = Date.now();
  const departure = new Date(journey.flight.departureUtc).getTime();
  const arrival = new Date(journey.flight.arrivalUtc).getTime();

  updatePlaneMarker(progress);
  $("progressText").textContent = `${Math.round(progress * 100)}%`;
  $("progressBar").style.width = `${progress * 100}%`;
  $("previewSlider").value = Math.round(progress * 100);
  $("latitude").textContent = `${Math.abs(point.lat).toFixed(2)}°${point.lat >= 0 ? "N" : "S"}`;
  $("longitude").textContent = `${Math.abs(point.lon).toFixed(2)}°${point.lon >= 0 ? "E" : "W"}`;
  $("altitude").textContent = `${Math.max(0, point.altitudeFt || 0).toLocaleString()} ft`;

  if (previewProgress !== null) {
    $("phaseLabel").textContent = "PREVIEW MODE";
    $("remainingTime").textContent = `${Math.round(progress * 100)}%`;
    $("phaseDetail").textContent = "Move the slider to explore the route";
  } else if (now < departure) {
    $("phaseLabel").textContent = "DEPARTS IN";
    $("remainingTime").textContent = formatDuration(departure - now);
    $("phaseDetail").textContent = "Waiting for the scheduled departure time";
  } else if (now >= arrival) {
    $("phaseLabel").textContent = "JOURNEY STATUS";
    $("remainingTime").textContent = "Landed";
    $("phaseDetail").textContent = "Scheduled journey complete";
  } else {
    $("phaseLabel").textContent = "TIME REMAINING";
    $("remainingTime").textContent = formatDuration(arrival - now);
    $("phaseDetail").textContent = `${formatDuration(now - departure)} elapsed`;
  }
}

function openJourney(data) {
  journey = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  $("setupView").classList.add("hidden");
  $("trackerView").classList.remove("hidden");
  $("flightIdentity").textContent = `${data.flight.airline || "Flight"} · ${data.flight.ident} · ${data.flight.status || "Scheduled"}`;
  $("originCity").textContent = data.flight.origin.city || data.flight.origin.code;
  $("destinationCity").textContent = data.flight.destination.city || data.flight.destination.code;
  $("originCode").textContent = data.flight.origin.code;
  $("destinationCode").textContent = data.flight.destination.code;
  $("arrivalTime").textContent = `Estimated arrival ${formatClock(data.flight.arrivalUtc, data.flight.destination.timeZone)}`;
  $("routeSource").textContent = data.route.sampleCount > 0 ? `Usual path from ${data.route.sampleCount} recent track${data.route.sampleCount === 1 ? "" : "s"}` : "Schedule-based route estimate";
  $("confidence").textContent = data.route.confidence;
  $("sampleDetail").textContent = data.route.sampleCount ? `${data.route.sampleCount} completed flights analysed` : "Airport-to-airport geometry; not a filed route";
  initializeMap();
  updateMapRoute();
  renderTracker();
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { if (previewProgress === null) renderTracker(); }, 1000);
  cancelAnimationFrame(animationFrame);
  const animate = () => {
    if (journey && previewProgress === null) updatePlaneMarker(currentClockProgress());
    animationFrame = requestAnimationFrame(animate);
  };
  animationFrame = requestAnimationFrame(animate);
}

async function prepareFlight(event) {
  event.preventDefault();
  const apiBase = (config.API_BASE_URL || "").replace(/\/$/, "");
  if (!apiBase) {
    showMessage("The data service has not been connected yet. Deploy the Worker and set API_BASE_URL in config.js, or use the demonstration.", true);
    return;
  }
  if (!navigator.onLine) {
    showMessage("You are offline. Reconnect to prepare a new flight, or use the journey already saved on this device.", true);
    return;
  }

  const flight = cleanFlightNumber($("flightNumber").value);
  const date = $("flightDate").value;
  const button = $("prepareButton");
  button.disabled = true;
  button.firstChild.textContent = "Preparing route… ";
  showMessage("Looking up the itinerary and building an offline route estimate. This can take a few seconds.");

  try {
    const response = await fetch(`${apiBase}/prepare?flight=${encodeURIComponent(flight)}&date=${encodeURIComponent(date)}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Flight service returned ${response.status}`);
    previewProgress = null;
    openJourney(body);
  } catch (error) {
    showMessage(error.message || "The flight could not be prepared.", true);
  } finally {
    button.disabled = false;
    button.firstChild.textContent = "Prepare this flight ";
  }
}

function showMessage(text, isError = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", isError);
}

function showFreshJourney() {
  clearInterval(clockTimer);
  cancelAnimationFrame(animationFrame);
  previewProgress = null;
  $("trackerView").classList.add("hidden");
  $("setupView").classList.remove("hidden");
  $("flightNumber").value = "";
  setDefaultDate();
  showMessage("Your current journey remains saved until you successfully prepare a new one.");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => $("flightNumber").focus(), 250);
}

function loadDemo() {
  const start = Date.now() - 6.5 * 3600000;
  const end = start + 15.8 * 3600000;
  const origin = { lat: 13.199, lon: 77.706 };
  const destination = { lat: 37.621, lon: -122.379 };
  const toVector = point => {
    const lat = point.lat * Math.PI / 180;
    const lon = point.lon * Math.PI / 180;
    return { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
  };
  const fromVector = vector => ({
    lat: Math.atan2(vector.z, Math.sqrt(vector.x ** 2 + vector.y ** 2)) * 180 / Math.PI,
    lon: Math.atan2(vector.y, vector.x) * 180 / Math.PI
  });
  const a = toVector(origin);
  const b = toVector(destination);
  const angle = Math.acos(a.x * b.x + a.y * b.y + a.z * b.z);
  const route = [];
  for (let index = 0; index <= 100; index++) {
    const p = index / 100;
    const left = Math.sin((1 - p) * angle) / Math.sin(angle);
    const right = Math.sin(p * angle) / Math.sin(angle);
    const coordinate = fromVector({ x: left * a.x + right * b.x, y: left * a.y + right * b.y, z: left * a.z + right * b.z });
    route.push({ progress: p, ...coordinate, altitudeFt: Math.round(37000 * Math.min(1, p / .12, (1 - p) / .12)) });
  }
  previewProgress = null;
  openJourney({
    preparedAt: new Date().toISOString(),
    flight: {
      ident: "AI175", airline: "Air India", status: "Demonstration",
      origin: { code: "BLR", city: "Bengaluru", timeZone: "Asia/Kolkata" },
      destination: { code: "SFO", city: "San Francisco", timeZone: "America/Los_Angeles" },
      departureUtc: new Date(start).toISOString(), arrivalUtc: new Date(end).toISOString()
    },
    route: { source: "demo", sampleCount: 3, confidence: "High", points: route }
  });
}

$("prepareForm").addEventListener("submit", prepareFlight);
$("demoButton").addEventListener("click", loadDemo);
$("previewSlider").addEventListener("input", event => { previewProgress = Number(event.target.value) / 100; renderTracker(); });
$("clockButton").addEventListener("click", () => { previewProgress = null; renderTracker(); });
$("changeFlight").addEventListener("click", showFreshJourney);
window.addEventListener("online", setNetworkState);
window.addEventListener("offline", setNetworkState);

setDefaultDate();
setNetworkState();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

try {
  const savedJourney = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (savedJourney?.route?.points?.length) openJourney(savedJourney);
} catch (_) {
  localStorage.removeItem(STORAGE_KEY);
}
