# Airtrace

Airtrace prepares a flight while the user is online, then estimates the aircraft's position while offline. It retrieves the itinerary by flight number, calculates an airport-to-airport route, stores the prepared journey locally, and advances a moving aircraft marker using the device clock.

This is an **estimated journey**, not live aircraft tracking.

## Sensor Assist (beta)

The tracker can optionally use browser geolocation while the page remains open. A usable phone fix can correct progress along the saved route, detect a likely delayed takeoff, detect a likely landing near the destination, and show phone-reported coordinates or GPS altitude. Poor or implausible fixes are ignored and the clock simulation continues.

Manual **We just took off** and **We have landed** controls remain available because GPS reception inside an aircraft is not guaranteed. Sensor readings stay in the browser and are saved only with the journey on that device.

When connectivity returns, **Refresh live details** retrieves revised flight information and an arrival baggage belt when AeroDataBox supplies one. Baggage information cannot be refreshed while fully offline.
