# Rooms

A University of Maryland campus availability map for classrooms, study rooms, parking, and dining.

`Rooms` started as a classroom finder and has grown into a campus utility app:
- live and scheduled classroom availability
- LibCal study-room browsing and in-app booking
- parking overlays with time-aware status
- dining hall status and menu browsing
- a 3D Mapbox campus map with mobile-friendly navigation

## What It Does

### Classrooms
- Browse classroom availability in `Now`, `Schedule`, or `All Rooms` mode
- Search by building, room, or class/event name
- View room timelines and event blocks
- Filter by minimum open duration
- Open any building and still see the full room list, with available rooms sorted first

### Library Study Rooms
- Integrates UMD Libraries LibCal study spaces
- Shows bookable rooms alongside classroom inventory
- Supports room-level date browsing for future booking
- Lets users reserve study rooms directly in-app
- Handles partial bookings inside larger available blocks

### Parking
- Displays free, restricted, and visitor parking on the map
- Colors parking by current parking status
- Includes UMD-specific parking rules and navigation links

### Dining
- Shows the 3 UMD dining halls on the map
- Displays current hall status and daily menu sections
- Supports browsing dining menus by day
- Includes direct links for navigation and the full menu page

### Map + UX
- Interactive 3D Mapbox map
- Color-coded building markers for available, opening soon, and unavailable rooms
- Dedicated markers for bookable library buildings, parking, and dining halls
- Dark mode with system-theme default
- Favorites for buildings and rooms
- Mobile-first sidebar behavior with focused detail views
- Haptic feedback via `bzzz`

## Tech Stack

- React 18
- Mapbox GL JS
- Netlify Functions
- `date-fns` + `date-fns-tz`
- `bzzz` for haptics

## Data Sources

This app combines several UMD-facing systems:

- **25Live** for classroom availability
- **UMD Libraries LibCal** for study-room availability and booking
- **UMD Dining nutrition site** for dining hall menus
- **UMD parking data + manually validated coordinates** for parking overlays

## Local Development

### 1. Install

```bash
git clone https://github.com/andrewxie04/umd_map.git
cd umd_map/mapbox-web
npm install
```

### 2. Configure Mapbox

Create `/Users/andrewxie/Documents/School/UMD Map /mapbox-web/.env`:

```env
REACT_APP_MAPBOX_ACCESS_TOKEN=your_mapbox_token_here
```

### 3. Start the app

```bash
npm start
```

This runs the React app and refreshes `public/buildings_data.json` before startup.

### 4. Full local feature development

Some features rely on Netlify Functions and will work best in a Netlify-style environment:

- on-demand past/future day fetches
- LibCal booking flow
- dining fetches

For those, use Netlify dev in addition to the frontend:

```bash
netlify dev
```

## Scripts

```bash
npm start        # start dev server (also refreshes room data first)
npm run build    # production build (also refreshes room data first)
npm run update-data
```

## Project Structure

```text
mapbox-web/
├── netlify/functions/     # server-side proxies for LibCal, dining, and dynamic fetches
├── public/                # static assets and generated room data
├── scripts/               # data update scripts
├── src/                   # React app, map logic, sidebar UI, availability helpers
└── README.md
```

## Notes

- `public/buildings_data.json` is generated from the UMD room data pipeline and cached for startup/build performance.
- Library rooms have different semantics than classrooms: they are **bookable**, not just “empty.”
- Dining status is based on UMD dining hours and meal service windows.
- Parking status is based on UMD-specific free/visitor/restricted rules.

## Author

**Andrew Xie**
- [GitHub](https://github.com/andrewxie04)
- [LinkedIn](https://linkedin.com/in/andrewxie04)

## License

MIT
