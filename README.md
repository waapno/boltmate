# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Parking data and offline coordinates

The app combines nearby OSM parking with Ostrava's official JSON-LD open data through `/api/parking`. OSM is refreshed every 12 hours and the city feed every five minutes (the provider recommends at most one request per minute and limits clients to 100 requests per hour). The app rechecks the endpoint every five minutes while open. The Worker cache is regional rather than a globally replicated database; each device also saves coordinates and the last city availability locally for offline use. On the map, `M` markers use official occupancy colors while OSM-only `P` markers use the parking score. Stored availability is only the last observation, not a live offline value. Offline map tiles and route planning must be downloaded or provided by a navigation app separately.

The courier recommendation uses the configured hourly target and time-of-day demand as a cold-start estimate. Orders saved while a zone is selected are used to personalize that zone's net-per-hour and order-rate estimate; with GPS enabled, the next-30-minute estimate subtracts an approximate road detour, 20 km/h urban travel time, and vehicle cost. Parking selection excludes known-full and private/subscriber-only facilities when alternatives exist, then prefers free status, live availability, lower occupancy, and distance. OSM and operator availability/fee tags can be incomplete or out of date: verify signs and restrictions on site. The route drawn on the map is only a straight-line indicator; use a linked navigation app for road directions.

The current five hotspot centers can also be selected as manual location presets; they are approximate zone coordinates, not live GPS or restaurant-coordinate averages. The offer calculator remembers its last inputs and automatically estimates the minimum gross reward needed to cover vehicle costs and meet the configured hourly target. Its take/consider/decline suggestion uses net hourly earnings and the minimum net-per-kilometer threshold.

The “Bolt spoty z CSV” map layer reads `public/bolt_delivery_spoty_ostrava.csv`. Toggle it in the “Teď” panel; click a marker for its address, category, and access notes. Coordinates are geocoded or approximate address points, not a guarantee of an entrance or a currently valid parking permission; check the posted signs.
