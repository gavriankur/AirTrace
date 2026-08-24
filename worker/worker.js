const AERODATABOX_BASE = "https://aerodatabox.p.rapidapi.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return json({ ok: true, provider: "AeroDataBox", providerConfigured: Boolean(env.AERODATABOX_RAPIDAPI_KEY) }, 200, cors);
    if (url.pathname !== "/prepare" || request.method !== "GET") return json({ error: "Not found" }, 404, cors);

    try {
      if (!env.AERODATABOX_RAPIDAPI_KEY) throw new HttpError(503, "The free flight lookup service is not configured yet.");
      const ident = normalizeIdent(url.searchParams.get("flight"));
      const date = validateDate(url.searchParams.get("date"));
      return json(await prepareJourney(ident, date, env.AERODATABOX_RAPIDAPI_KEY), 200, cors);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return json({ error: error.message || "The flight could not be prepared." }, status, cors);
    }
  }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function normalizeIdent(value) {
  const ident = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{3,8}$/.test(ident)) throw new HttpError(400, "Enter a valid airline flight number, such as AI175.");
  return ident;
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new HttpError(400, "Choose a valid departure date.");
  return value;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "*";
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map(item => item.trim());
  const permitted = allowed.includes("*") || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": permitted ? origin : "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

async function providerGet(path, apiKey) {
  const response = await fetch(`${AERODATABOX_BASE}${path}`, {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
      "Accept": "application/json"
    }
  });
  if (response.status === 204 || response.status === 404) throw new HttpError(404, "No matching flight was found for that departure date.");
  if (response.status === 401 || response.status === 403) throw new HttpError(502, "The AeroDataBox key is invalid or the free plan does not permit this request.");
  if (response.status === 429) throw new HttpError(429, "The free flight lookup quota is temporarily exhausted. Try again later.");
  if (!response.ok) throw new HttpError(502, `Flight lookup service error (${response.status}).`);
  return response.json();
}

async function prepareJourney(ident, date, apiKey) {
  const path = `/flights/number/${encodeURIComponent(ident)}/${date}?dateLocalRole=Departure&withAircraftImage=false&withLocation=false&withFlightPlan=false`;
  const flights = await providerGet(path, apiKey);
  if (!Array.isArray(flights) || !flights.length) throw new HttpError(404, `No ${ident} departure was found on ${date}.`);

  const target = chooseFlight(flights, ident, date);
  const origin = airportSummary(target.departure?.airport);
  const destination = airportSummary(target.arrival?.airport);
  const departureUtc = movementTime(target.departure);
  const arrivalUtc = movementTime(target.arrival);
  if (!departureUtc || !arrivalUtc || Date.parse(arrivalUtc) <= Date.parse(departureUtc)) throw new HttpError(502, "The provider returned incomplete departure or arrival times.");

  return {
    schemaVersion: 5,
    preparedAt: new Date().toISOString(),
    provider: "AeroDataBox",
    lookup: { flight: ident, date },
    flight: {
      ident: target.number || ident,
      airline: target.airline?.name || null,
      status: target.status || "Scheduled",
      aircraftType: target.aircraft?.model || null,
      departureUtc,
      arrivalUtc,
      scheduledDepartureUtc: target.departure?.scheduledTime?.utc || null,
      scheduledArrivalUtc: target.arrival?.scheduledTime?.utc || null,
      departureRevisedUtc: target.departure?.revisedTime?.utc || null,
      arrivalRevisedUtc: target.arrival?.revisedTime?.utc || null,
      departurePredictedUtc: target.departure?.predictedTime?.utc || null,
      arrivalPredictedUtc: target.arrival?.predictedTime?.utc || null,
      departureRunwayUtc: target.departure?.runwayTime?.utc || null,
      arrivalRunwayUtc: target.arrival?.runwayTime?.utc || null,
      arrivalGate: target.arrival?.gate || null,
      arrivalTerminal: target.arrival?.terminal || null,
      baggageBelt: target.arrival?.baggageBelt || null,
      providerLastUpdatedUtc: target.lastUpdatedUtc || null,
      origin,
      destination
    },
    route: {
      source: "schedule-estimate",
      sampleCount: 0,
      confidence: "Low",
      points: greatCircleRoute(origin, destination, Date.parse(departureUtc), Date.parse(arrivalUtc))
    }
  };
}

function chooseFlight(flights, ident, date) {
  const wanted = normalizeLoose(ident);
  return [...flights].sort((a, b) => flightScore(b, wanted, date) - flightScore(a, wanted, date))[0];
}

function flightScore(flight, wanted, date) {
  let score = normalizeLoose(flight.number) === wanted ? 10 : 0;
  if (flight.codeshareStatus === "IsOperator") score += 3;
  if (flight.departure?.scheduledTime?.local?.slice(0, 10) === date) score += 2;
  if (flight.departure?.airport?.location && flight.arrival?.airport?.location) score += 1;
  return score;
}

function normalizeLoose(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function movementTime(movement) {
  return movement?.revisedTime?.utc || movement?.predictedTime?.utc || movement?.scheduledTime?.utc || null;
}

function airportSummary(airport) {
  const lat = Number(airport?.location?.lat);
  const lon = Number(airport?.location?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(502, "Airport coordinates were unavailable.");
  return {
    code: airport.iata || airport.icao || airport.localCode || "—",
    icao: airport.icao || null,
    city: airport.municipalityName || airport.shortName || airport.name,
    name: airport.name,
    timeZone: airport.timeZone || "UTC",
    lat,
    lon,
    altitudeFt: 0
  };
}

function toCartesian(point) {
  const lat = point.lat * Math.PI / 180;
  const lon = point.lon * Math.PI / 180;
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
}

function fromCartesian(point) {
  return { lat: Math.atan2(point.z, Math.sqrt(point.x ** 2 + point.y ** 2)) * 180 / Math.PI, lon: Math.atan2(point.y, point.x) * 180 / Math.PI };
}

function cruiseAltitudeForMinutes(minutes) {
  if (minutes <= 45) return 24000;
  if (minutes <= 90) return 30000;
  if (minutes <= 180) return 35000;
  return 37000;
}

function profileAltitude(progress, durationMinutes) {
  const cruise = cruiseAltitudeForMinutes(durationMinutes);
  const elapsedMinutes = progress * durationMinutes;
  const remainingMinutes = (1 - progress) * durationMinutes;
  const climbMinutes = Math.min(22, Math.max(10, durationMinutes * .18));
  const descentMinutes = Math.min(40, Math.max(18, durationMinutes * .25));
  const climbFactor = Math.max(0, Math.min(1, elapsedMinutes / climbMinutes));
  const descentFactor = Math.max(0, Math.min(1, remainingMinutes / descentMinutes));
  return Math.max(0, Math.round(cruise * Math.min(climbFactor, descentFactor) / 500) * 500);
}

function greatCircleRoute(origin, destination, departureMs, arrivalMs) {
  const a = toCartesian(origin);
  const b = toCartesian(destination);
  const angle = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
  const durationMinutes = Math.max(30, (arrivalMs - departureMs) / 60000);
  const points = [];
  for (let index = 0; index <= 120; index++) {
    const progress = index / 120;
    const sinAngle = Math.sin(angle) || 1;
    const left = Math.sin((1 - progress) * angle) / sinAngle;
    const right = Math.sin(progress * angle) / sinAngle;
    const coordinate = fromCartesian({ x: left * a.x + right * b.x, y: left * a.y + right * b.y, z: left * a.z + right * b.z });
    const altitudeFt = profileAltitude(progress, durationMinutes);
    points.push({ progress, ...coordinate, altitudeFt: Math.max(0, altitudeFt) });
  }
  return points;
}
