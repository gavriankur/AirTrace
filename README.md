# Airtrace

Airtrace prepares a flight while the user is online, then estimates the aircraft's position while offline. It retrieves the itinerary by passenger flight number or ATC callsign, calculates an airport-to-airport route, stores the prepared journey locally, and advances a moving aircraft marker using the device clock.

This is an **estimated journey**, not live aircraft tracking.

## v33 empty flight input

The flight field starts empty. It shows `e.g. AI175 or IGO376E` as placeholder text, so tapping the field lets you type immediately without deleting a prefilled flight number.

## v32 reliable online refresh

V32 makes **Refresh live details** provide visible progress, success and failure messages, including a successful refresh timestamp with seconds. It can reconstruct the flight number and departure date for journeys saved by older AirTrace versions that do not contain a `lookup` object. Requests explicitly bypass browser caches, duplicate refreshes are blocked, and offline or incomplete-journey failures are explained instead of silently doing nothing.

## v31 climb and descent counters

V31 adds a rapid whole-foot estimated-altitude counter for the first 10,000 feet after takeoff, shown with an upward arrow. The existing final-descent counter runs from 10,000 feet down to zero with a downward arrow. Above 10,000 feet, AirTrace returns to the normal estimated climb, cruise or descent display. Live phone or provider altitude still takes priority, and reaching 100% remains locked to 0 feet.

## v30 touchdown consistency

V30 keeps the final altitude animation synchronized with the calculated descent, including when Safari slows background timers. A journey below 100% can display no more than 99%; once it genuinely reaches 100%, the estimated altitude is forced to 0 feet and the touchdown message is shown. Moving the preview slider to 100% follows the same rule.

## v29 final descent and state restoration

V29 starts the rapid estimated-altitude countdown at 10,000 feet and displays whole-foot values continuously down to zero instead of rounding the final descent to broad altitude steps. The value remains explicitly labelled as an estimate unless phone GPS or provider altitude is available.

The lower **Currently flying over** line again appends a state when it can identify one. Its offline fallback now covers additional Karnataka places, including Hunsur, so the example shown by testers becomes **Flying over Hunsur, Karnataka**. State names remain excluded from the large origin-to-destination heading.

## v28 state name placement

V28 keeps the large route heading concise with city names only, for example `Mumbai → Bengaluru`. State or region names remain limited to the lower **Currently flying over** line, such as **Flying over Ballari, Karnataka**.

## v27 state/region in “Currently flying over”

V27 adds a state or region to the nearby-place description when it can be identified reliably, for example **Flying over Ballari, Karnataka**. It first uses regional attributes supplied by the cached map, then nearby state/province labels, and finally an offline place-to-state fallback for common Indian cities. When no reliable region is available, AirTrace keeps the city-only wording instead of guessing.

## v26 simplified milestones and state names

V26 removes the **Doors opened now / Gate in** milestone card. The remaining milestones are gate departure, wheels up and wheels down.

Origin and destination headings now use `City, State/Region` when a reliable airport-region match is available, for example `Mumbai, Maharashtra → Bengaluru, Karnataka`. The Worker also includes the resolved region in newly prepared journeys; the page contains an offline fallback for common airports so existing saved journeys can display the region without being prepared again.

## v25 opt-in diagnostics

V25 keeps up to seven days of troubleshooting events locally on each device. It records application version, network changes, lookup/refresh results, service-worker and map errors, sensor permission/status, data-source changes and coarse progress checkpoints. Exact coordinates are not logged by default.

The tester can explicitly send a report to AirTrace, share it through the phone's share sheet, download it as JSON or clear the local log. Selecting **Include the current precise position** adds only the current position to that generated report.

Submitted reports are stored for seven days in a Cloudflare Workers KV namespace. The protected `admin.html` page lists reports only after the administrator enters the private `ADMIN_TOKEN`; the token is not stored in GitHub or embedded in the page.

### Diagnostics storage setup

From the `worker` directory, create a KV namespace:

```bash
npx wrangler kv namespace create AIRTRACE_DIAGNOSTICS
```

Add the returned namespace ID to `worker/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "AIRTRACE_DIAGNOSTICS"
id = "PASTE_THE_RETURNED_NAMESPACE_ID"
```

Create a strong administrator token and deploy:

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Open `https://gavriankur.github.io/AirTrace/admin.html`, enter the same token and select **Load reports**. Reports expire automatically after seven days.

## v24 distance beside time remaining

V24 moves the continuously updated kilometres-remaining figure into the primary flight-status area beside the time remaining. On narrow phone screens the two values wrap cleanly while staying grouped together.

## v23 direction, distance, location and turbulence outlook

V23 makes the aircraft's direction explicit: the position card leads with wording such as **Travelling South-East**, followed by the true route heading in degrees and the latitude/longitude coordinates. The timeline aircraft always points right to represent departure-to-arrival progress, while the aircraft drawn on the map still follows the route's geographic bearing.

The journey panel now shows approximate kilometres remaining. The **Currently flying over** field can identify supported seas, gulfs and oceans from the cached map surface and saved coordinates, including the Bay of Bengal, before falling back to a nearby cached city/town or conservative route wording.

Phone-location errors now reset the active location watch and offer a clear retry action instead of incorrectly displaying **Stop phone location**. The flight header suppresses an unhelpful provider status of **Unknown**.

When a flight is prepared close to departure, the Worker checks published NOAA Aviation Weather Center turbulence SIGMET advisories against the estimated route, altitude and flight window. The result is saved with the journey for offline viewing. It is only a significant-weather advisory and cannot predict every instance of turbulence or guarantee a smooth flight.

## v21 identifier lookup

AirTrace accepts both passenger flight numbers such as `6E5184` and operational ATC callsigns such as `IGO376E`. It first checks the value as a flight number, then automatically retries it as a callsign when no numbered flight is found. A callsign result is saved using the resolved passenger flight number so subsequent live-detail refreshes remain stable.

## Sensor Assist (beta)

The tracker can optionally use browser geolocation while the page remains open. A usable phone fix can correct progress along the saved route, detect a likely delayed takeoff, detect a likely landing near the destination, and show phone-reported coordinates or GPS altitude. Poor or implausible fixes are ignored and the clock simulation continues.

Manual **We just took off** and **We have landed** controls remain available because GPS reception inside an aircraft is not guaranteed. Sensor readings stay in the browser and are saved only with the journey on that device.

When connectivity returns, **Refresh live details** retrieves revised flight information from AeroDataBox.

## v22 tracker display

V22 adds a live device clock with seconds, an aircraft-shaped timeline control, side-by-side altitude and speed, route-heading compass, and cached-map place labels for nearby cities and towns. During the final estimated 1,000 feet, altitude counts down rapidly to touchdown. Once the calculated landing time passes, the journey is shown as landed and the estimated aircraft is placed at the destination. The baggage-belt panel has been removed, and the offline-map message now explains that only previously viewed tiles and zoom levels are available.

## v20 live-data safeguards

AirTrace keeps gate/block and airborne milestones separate: gate out, wheels up, wheels down, and gate in. Published block duration is used only for gate milestones. It never determines the aircraft's airborne progress or altitude.

The airborne clock prioritises a manually or sensor-confirmed takeoff, followed by a plausible provider runway interval. When those are unavailable, duration is estimated independently from great-circle distance and aircraft type. Implausible provider runway intervals are rejected so schedule padding cannot turn a roughly 90-minute flight into a four-hour simulation.

V20 also rejects a runway departure timestamp that is earlier than a newer revised departure, requests provider positional data when available, and recalibrates medium-distance jet timing. A clock reaching 100% no longer claims that the aircraft has landed: landing is shown as confirmed only after a provider, phone-sensor, or manual confirmation.

Phone-reported GPS altitude takes priority whenever the browser supplies it, including low-confidence readings that are clearly labelled with their accuracy. When GPS altitude is unavailable, the fallback uses flight duration, elapsed airborne time, and time remaining to model climb and descent. It is displayed with an approximation mark and likely range instead of presenting a synthetic cruise altitude as exact.
