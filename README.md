# Airtrace

Airtrace prepares a flight while the user is online, then estimates the aircraft's position while offline. It retrieves the itinerary by passenger flight number or ATC callsign, calculates an airport-to-airport route, stores the prepared journey locally, and advances a moving aircraft marker using the device clock.

This is an **estimated journey**, not live aircraft tracking.

## v21 identifier lookup

AirTrace accepts both passenger flight numbers such as `6E5184` and operational ATC callsigns such as `IGO376E`. It first checks the value as a flight number, then automatically retries it as a callsign when no numbered flight is found. A callsign result is saved using the resolved passenger flight number so subsequent live-detail refreshes remain stable.

## Sensor Assist (beta)

The tracker can optionally use browser geolocation while the page remains open. A usable phone fix can correct progress along the saved route, detect a likely delayed takeoff, detect a likely landing near the destination, and show phone-reported coordinates or GPS altitude. Poor or implausible fixes are ignored and the clock simulation continues.

Manual **We just took off** and **We have landed** controls remain available because GPS reception inside an aircraft is not guaranteed. Sensor readings stay in the browser and are saved only with the journey on that device.

When connectivity returns, **Refresh live details** retrieves revised flight information and an arrival baggage belt when AeroDataBox supplies one. Baggage information cannot be refreshed while fully offline.

## v20 live-data safeguards

AirTrace keeps gate/block and airborne milestones separate: gate out, wheels up, wheels down, and gate in. Published block duration is used only for gate milestones. It never determines the aircraft's airborne progress or altitude.

The airborne clock prioritises a manually or sensor-confirmed takeoff, followed by a plausible provider runway interval. When those are unavailable, duration is estimated independently from great-circle distance and aircraft type. Implausible provider runway intervals are rejected so schedule padding cannot turn a roughly 90-minute flight into a four-hour simulation.

V20 also rejects a runway departure timestamp that is earlier than a newer revised departure, requests provider positional data when available, and recalibrates medium-distance jet timing. A clock reaching 100% no longer claims that the aircraft has landed: landing is shown as confirmed only after a provider, phone-sensor, or manual confirmation.

Phone-reported GPS altitude takes priority whenever the browser supplies it, including low-confidence readings that are clearly labelled with their accuracy. When GPS altitude is unavailable, the fallback uses flight duration, elapsed airborne time, and time remaining to model climb and descent. It is displayed with an approximation mark and likely range instead of presenting a synthetic cruise altitude as exact.
