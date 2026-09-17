const AERODATABOX_BASE = "https://aerodatabox.p.rapidapi.com";
const AVIATION_WEATHER_BASE = "https://aviationweather.gov/api/data";
const AIRPORT_REGION_NAMES = {
  AGX:"Lakshadweep", AGR:"Uttar Pradesh", AMD:"Gujarat", ATQ:"Punjab", AYJ:"Uttar Pradesh",
  BBI:"Odisha", BDQ:"Gujarat", BHO:"Madhya Pradesh", BHJ:"Gujarat", BLR:"Karnataka", BKB:"Rajasthan", BOM:"Maharashtra",
  CCJ:"Kerala", CCU:"West Bengal", CJB:"Tamil Nadu", CNN:"Kerala", COK:"Kerala",
  DBR:"Bihar", DED:"Uttarakhand", DEL:"Delhi", DGH:"Jharkhand", DIB:"Assam", DMU:"Nagaland",
  GAU:"Assam", GAY:"Bihar", GOI:"Goa", GOX:"Goa", GOP:"Uttar Pradesh", GWL:"Madhya Pradesh",
  HBX:"Karnataka", HYD:"Telangana", IDR:"Madhya Pradesh", IMF:"Manipur", ISK:"Maharashtra", IXA:"Tripura",
  IXB:"West Bengal", IXC:"Chandigarh", IXD:"Uttar Pradesh", IXE:"Karnataka", IXG:"Karnataka", IXJ:"Jammu and Kashmir",
  IXM:"Tamil Nadu", IXR:"Jharkhand", IXS:"Assam", IXU:"Maharashtra", IXZ:"Andaman and Nicobar Islands",
  JAI:"Rajasthan", JDH:"Rajasthan", JGA:"Gujarat", JGB:"Chhattisgarh", JLR:"Madhya Pradesh", JRG:"Odisha", JRH:"Assam", JSA:"Rajasthan",
  KNU:"Uttar Pradesh", KLH:"Maharashtra", KQH:"Rajasthan", KUU:"Himachal Pradesh",
  LKO:"Uttar Pradesh", LUH:"Punjab", MAA:"Tamil Nadu", MYQ:"Karnataka", NAG:"Maharashtra", PAT:"Bihar", PGH:"Uttarakhand",
  PNY:"Puducherry", PNQ:"Maharashtra", PRY:"Uttar Pradesh", PYG:"Sikkim", RAJ:"Gujarat", RDP:"West Bengal", RPR:"Chhattisgarh",
  SHL:"Meghalaya", SLV:"Himachal Pradesh", SXR:"Jammu and Kashmir", STV:"Gujarat", TCR:"Tamil Nadu", TEZ:"Assam",
  TIR:"Andhra Pradesh", TRV:"Kerala", TRZ:"Tamil Nadu", UDR:"Rajasthan", VGA:"Andhra Pradesh", VNS:"Uttar Pradesh", VTZ:"Andhra Pradesh",
  AUH:"Abu Dhabi", DXB:"Dubai", SHJ:"Sharjah", HND:"Tokyo", ITM:"Osaka", ICN:"Incheon", LAX:"California", SFO:"California", JFK:"New York", EWR:"New Jersey"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return json({
      ok: true,
      provider: "AeroDataBox",
      providerConfigured: Boolean(env.AERODATABOX_RAPIDAPI_KEY),
      diagnosticsConfigured: Boolean(env.AIRTRACE_DIAGNOSTICS && env.ADMIN_TOKEN)
    }, 200, cors);
    if (url.pathname === "/diagnostics" && request.method === "POST") return receiveDiagnosticReport(request, env, cors);
    if (url.pathname === "/diagnostics" && request.method === "GET") return listDiagnosticReports(request, env, cors);
    if (url.pathname.startsWith("/diagnostics/") && request.method === "GET") {
      return getDiagnosticReport(request, env, cors, decodeURIComponent(url.pathname.slice("/diagnostics/".length)));
    }
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
  if (!/^[A-Z0-9]{3,10}$/.test(ident)) throw new HttpError(400, "Enter a valid flight number or ATC callsign, such as 6E5184 or IGO376E.");
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

const DIAGNOSTIC_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const DIAGNOSTIC_MAX_BYTES = 96 * 1024;

function diagnosticAdminAuthorized(request, env) {
  const supplied = request.headers.get("Authorization") || "";
  return Boolean(env.ADMIN_TOKEN) && supplied === `Bearer ${env.ADMIN_TOKEN}`;
}

function diagnosticStore(env) {
  if (!env.AIRTRACE_DIAGNOSTICS) throw new HttpError(503, "Diagnostic storage is not configured.");
  return env.AIRTRACE_DIAGNOSTICS;
}

async function receiveDiagnosticReport(request, env, cors) {
  try {
    const declaredSize = Number(request.headers.get("Content-Length") || 0);
    if (declaredSize > DIAGNOSTIC_MAX_BYTES) throw new HttpError(413, "Diagnostic report is too large.");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > DIAGNOSTIC_MAX_BYTES) throw new HttpError(413, "Diagnostic report is too large.");
    let report;
    try { report = JSON.parse(text); } catch (_) { throw new HttpError(400, "Diagnostic report must be valid JSON."); }
    if (!report || typeof report !== "object" || Number(report.reportSchema) !== 1) throw new HttpError(400, "Unsupported diagnostic report.");
    if (!Array.isArray(report.events) || report.events.length > 300) throw new HttpError(400, "Diagnostic event list is invalid.");

    const store = diagnosticStore(env);
    const reportId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const stored = {
      ...report,
      reportId,
      receivedAt,
      installationId: String(report.installationId || "").slice(0, 80),
      appVersion: String(report.appVersion || "").slice(0, 20)
    };
    const metadata = {
      reportId,
      receivedAt,
      installationId: stored.installationId,
      appVersion: stored.appVersion,
      flight: String(report.journey?.flight || "").slice(0, 20) || null,
      route: String(report.journey?.route || "").slice(0, 30) || null,
      sensorStatus: String(report.journey?.sensorStatus || "").slice(0, 30) || null,
      eventCount: report.events.length,
      precisePositionIncluded: Boolean(report.precisePositionIncluded)
    };
    await store.put(`diag:${reportId}`, JSON.stringify(stored), {
      expirationTtl: DIAGNOSTIC_RETENTION_SECONDS,
      metadata
    });
    return json({ ok: true, reportId, receivedAt, expiresInDays: 7 }, 201, cors);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: error.message || "The diagnostic report could not be stored." }, status, cors);
  }
}

async function listDiagnosticReports(request, env, cors) {
  try {
    if (!diagnosticAdminAuthorized(request, env)) throw new HttpError(401, "Administrator authorization required.");
    const store = diagnosticStore(env);
    const listing = await store.list({ prefix: "diag:", limit: 100 });
    const reports = listing.keys.map(key => key.metadata || { reportId: key.name.slice(5) })
      .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
    return json({ reports, cursor: listing.list_complete ? null : listing.cursor }, 200, cors);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: error.message || "Diagnostic reports could not be listed." }, status, cors);
  }
}

async function getDiagnosticReport(request, env, cors, reportId) {
  try {
    if (!diagnosticAdminAuthorized(request, env)) throw new HttpError(401, "Administrator authorization required.");
    if (!/^[a-f0-9-]{20,50}$/i.test(reportId)) throw new HttpError(400, "Invalid diagnostic report ID.");
    const report = await diagnosticStore(env).get(`diag:${reportId}`, "json");
    if (!report) throw new HttpError(404, "Diagnostic report not found or already expired.");
    return json(report, 200, cors);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: error.message || "Diagnostic report could not be retrieved." }, status, cors);
  }
}

async function providerGet(path, apiKey, options = {}) {
  const response = await fetch(`${AERODATABOX_BASE}${path}`, {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
      "Accept": "application/json"
    }
  });
  if (response.status === 204 || response.status === 404) {
    if (options.notFoundAsEmpty) return [];
    throw new HttpError(404, "No matching flight was found for that departure date.");
  }
  if (response.status === 401 || response.status === 403) throw new HttpError(502, "The AeroDataBox key is invalid or the free plan does not permit this request.");
  if (response.status === 429) throw new HttpError(429, "The free flight lookup quota is temporarily exhausted. Try again later.");
  if (!response.ok) throw new HttpError(502, `Flight lookup service error (${response.status}).`);
  return response.json();
}

async function aviationWeatherGet(path) {
  const response = await fetch(`${AVIATION_WEATHER_BASE}${path}`, {
    headers: { "Accept": "application/json", "User-Agent": "AirTrace/23 contact: gavriankur.github.io/AirTrace" }
  });
  if (response.status === 204) return [];
  if (!response.ok) throw new Error(`Aviation weather service returned ${response.status}`);
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

async function prepareJourney(ident, date, apiKey) {
  const query = `dateLocalRole=Departure&withAircraftImage=false&withLocation=true&withFlightPlan=false`;
  const numberPath = `/flights/number/${encodeURIComponent(ident)}/${date}?${query}`;
  let searchBy = "number";
  let flights = await providerGet(numberPath, apiKey, { notFoundAsEmpty: true });

  if (!Array.isArray(flights) || !flights.length) {
    const callSignPath = `/flights/callsign/${encodeURIComponent(ident)}/${date}?${query}`;
    searchBy = "callsign";
    flights = await providerGet(callSignPath, apiKey, { notFoundAsEmpty: true });
  }

  if (!Array.isArray(flights) || !flights.length) {
    throw new HttpError(404, `No flight number or ATC callsign ${ident} was found departing on ${date}.`);
  }

  const target = chooseFlight(flights, ident, date);
  const origin = airportSummary(target.departure?.airport);
  const destination = airportSummary(target.arrival?.airport);
  const departureUtc = movementTime(target.departure);
  const arrivalUtc = movementTime(target.arrival);
  if (!departureUtc || !arrivalUtc || Date.parse(arrivalUtc) <= Date.parse(departureUtc)) throw new HttpError(502, "The provider returned incomplete departure or arrival times.");
  const greatCircleDistanceKm = routeDistanceKm(origin, destination);
  const estimatedAirborneMinutes = estimateAirborneMinutes(greatCircleDistanceKm, target.aircraft?.model);
  const routePoints = greatCircleRoute(origin, destination, estimatedAirborneMinutes);
  const turbulenceOutlook = await prepareTurbulenceOutlook(routePoints, departureUtc, arrivalUtc);

  return {
    schemaVersion: 10,
    preparedAt: new Date().toISOString(),
    provider: "AeroDataBox",
    turbulenceOutlook,
    lookup: { flight: target.number || ident, entered: ident, searchBy, date },
    flight: {
      ident: target.number || ident,
      callSign: target.callSign || (searchBy === "callsign" ? ident : null),
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
      liveLocation: flightLocationSummary(target.location),
      greatCircleDistanceKm,
      estimatedAirborneMinutes,
      origin,
      destination
    },
    route: {
      source: "distance-timed-estimate",
      sampleCount: 0,
      confidence: "Low",
      points: routePoints
    }
  };
}

async function prepareTurbulenceOutlook(routePoints, departureUtc, arrivalUtc) {
  const checkedAt = new Date().toISOString();
  const departureMs = Date.parse(departureUtc);
  const arrivalMs = Date.parse(arrivalUtc);
  if (!Number.isFinite(departureMs) || !Number.isFinite(arrivalMs)) {
    return { status: "unavailable", checkedAt, detail: "Flight timing was unavailable for the turbulence check." };
  }
  if (departureMs > Date.now() + 12 * 3600000) {
    return { status: "unavailable", checkedAt, detail: "Check again closer to departure; operational turbulence advisories are short-range." };
  }

  const results = await Promise.allSettled([
    aviationWeatherGet("/isigmet?hazard=turb&format=json"),
    aviationWeatherGet("/airsigmet?hazard=turb&format=json")
  ]);
  const successful = results.filter(result => result.status === "fulfilled");
  if (!successful.length) {
    return { status: "unavailable", checkedAt, detail: "Published aviation advisories could not be reached during preparation." };
  }

  const advisories = successful.flatMap(result => result.value);
  const matching = advisories.filter(advisory => {
    const validFrom = advisoryTimeMs(advisory.validTimeFrom);
    const validTo = advisoryTimeMs(advisory.validTimeTo);
    if (validFrom && validTo && (validTo < departureMs - 3600000 || validFrom > arrivalMs + 3600000)) return false;
    const polygon = Array.isArray(advisory.coords) ? advisory.coords : [];
    if (polygon.length < 3) return false;
    const baseFt = advisoryBaseFt(advisory);
    const topFt = advisoryTopFt(advisory);
    return routePoints.some(point => point.altitudeFt + 3000 >= baseFt
      && point.altitudeFt - 3000 <= topFt
      && pointInPolygon(point, polygon));
  }).slice(0, 4).map(advisory => ({
    severity: String(advisory.qualifier || advisory.severity || "Significant turbulence"),
    region: advisory.firName || advisory.icaoId || "Route area",
    baseFt: advisoryBaseFt(advisory),
    topFt: advisoryTopFt(advisory),
    validFromUtc: isoFromAdvisoryTime(advisory.validTimeFrom),
    validToUtc: isoFromAdvisoryTime(advisory.validTimeTo),
    seriesId: advisory.seriesId || null
  }));

  return {
    status: matching.length ? "advisory" : "none",
    checkedAt,
    source: "NOAA Aviation Weather Center SIGMET",
    advisories: matching,
    detail: matching.length
      ? "A published significant-turbulence advisory intersects the estimated route and altitude."
      : "No significant published turbulence advisory intersected the estimated route at preparation time."
  };
}

function advisoryTimeMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Number.isFinite(Number(value))) return Number(value) * 1000;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromAdvisoryTime(value) {
  const timestamp = advisoryTimeMs(value);
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function advisoryBaseFt(advisory) {
  const value = Number(advisory.base ?? advisory.altitudeLow1 ?? advisory.altitudeLow2 ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function advisoryTopFt(advisory) {
  const value = Number(advisory.top ?? advisory.altitudeHi1 ?? advisory.altitudeHi2 ?? 60000);
  return Number.isFinite(value) ? Math.max(0, value) : 60000;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const ax = Number(a.lon);
    const ay = Number(a.lat);
    const bx = Number(b.lon);
    const by = Number(b.lat);
    if (![ax, ay, bx, by].every(Number.isFinite)) continue;
    const crosses = (ay > point.lat) !== (by > point.lat)
      && point.lon < (bx - ax) * (point.lat - ay) / (by - ay || Number.EPSILON) + ax;
    if (crosses) inside = !inside;
  }
  return inside;
}

function chooseFlight(flights, ident, date) {
  const wanted = normalizeLoose(ident);
  return [...flights].sort((a, b) => flightScore(b, wanted, date) - flightScore(a, wanted, date))[0];
}

function flightScore(flight, wanted, date) {
  let score = normalizeLoose(flight.number) === wanted ? 10 : 0;
  if (normalizeLoose(flight.callSign) === wanted) score += 10;
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
  const code = airport.iata || airport.icao || airport.localCode || "—";
  return {
    code,
    icao: airport.icao || null,
    city: airport.municipalityName || airport.shortName || airport.name,
    name: airport.name,
    region: airport.regionName || airport.stateName || airport.region || AIRPORT_REGION_NAMES[String(code).toUpperCase()] || null,
    countryCode: airport.countryCode || airport.country?.code || airport.country?.iso2 || null,
    timeZone: airport.timeZone || "UTC",
    lat,
    lon,
    altitudeFt: 0
  };
}

function flightLocationSummary(location) {
  const lat = Number(location?.lat);
  const lon = Number(location?.lon);
  const reportedAtUtc = location?.reportedAtUtc || null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !reportedAtUtc) return null;
  const altitudeFt = Number(location?.altitude?.feet ?? location?.pressureAltitude?.feet);
  const groundSpeedKt = Number(location?.groundSpeed?.kt);
  const trueTrackDeg = Number(location?.trueTrack?.deg);
  return {
    lat,
    lon,
    reportedAtUtc,
    altitudeFt: Number.isFinite(altitudeFt) ? Math.round(altitudeFt) : null,
    groundSpeedKt: Number.isFinite(groundSpeedKt) ? Math.round(groundSpeedKt) : null,
    trueTrackDeg: Number.isFinite(trueTrackDeg) ? trueTrackDeg : null,
    verticalSpeedFpm: Number.isFinite(Number(location?.vsiFpm)) ? Number(location.vsiFpm) : null
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

function routeDistanceKm(origin, destination) {
  const radians = value => value * Math.PI / 180;
  const lat1 = radians(origin.lat);
  const lat2 = radians(destination.lat);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(destination.lon - origin.lon);
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.min(1, Math.sqrt(haversine))));
}

function estimateAirborneMinutes(distanceKm, aircraftType = "") {
  const turboprop = /\b(ATR|AT4|AT7|DHC|DH8|Q[1-4]00|DASH\s*8)\b/i.test(String(aircraftType));
  let speedKmh;
  let climbAndApproachMinutes;

  if (turboprop) {
    speedKmh = 470;
    climbAndApproachMinutes = 10;
  } else if (distanceKm <= 350) {
    speedKmh = 550;
    climbAndApproachMinutes = 12;
  } else if (distanceKm <= 1000) {
    speedKmh = 650;
    climbAndApproachMinutes = 10;
  } else if (distanceKm <= 1600) {
    speedKmh = 760;
    climbAndApproachMinutes = 8;
  } else if (distanceKm <= 3500) {
    speedKmh = 830;
    climbAndApproachMinutes = 5;
  } else {
    speedKmh = 870;
    climbAndApproachMinutes = 15;
  }

  return Math.round(Math.max(30, distanceKm / speedKmh * 60 + climbAndApproachMinutes));
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

function greatCircleRoute(origin, destination, durationMinutes) {
  const a = toCartesian(origin);
  const b = toCartesian(destination);
  const angle = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
  durationMinutes = Math.max(30, durationMinutes);
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
