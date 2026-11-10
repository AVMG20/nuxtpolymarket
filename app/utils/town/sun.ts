// Where the real sun is, for Polytown's "follow the sun" mode. Cosmetic only.
//
// The low-precision solar position from the Astronomical Almanac: good to a
// hundredth of a degree for centuries either side of 2000, far finer than a
// sunset needs.

const RAD = Math.PI / 180

/** The sun's height above the horizon in degrees at `date`, seen from lat/lon (degrees, east positive). */
export function solarElevation(date: Date, lat: number, lon: number): number {
    const n = date.getTime() / 86_400_000 + 2440587.5 - 2451545.0
    const meanLongitude = (280.46 + 0.9856474 * n) % 360
    const anomaly = ((357.528 + 0.9856003 * n) % 360) * RAD
    const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD
    const obliquity = (23.439 - 0.0000004 * n) * RAD
    const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude))
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))
    const siderealDegrees = (280.46061837 + 360.98564736629 * n + lon) % 360
    const hourAngle = siderealDegrees * RAD - rightAscension
    const sinElevation = Math.sin(lat * RAD) * Math.sin(declination) + Math.cos(lat * RAD) * Math.cos(declination) * Math.cos(hourAngle)
    return Math.asin(Math.max(-1, Math.min(1, sinElevation))) / RAD
}

/** Full daylight down to here, in degrees of sun elevation. */
const DAY_ABOVE = 4
/** Full night from here down: the end of civil twilight. */
const NIGHT_BELOW = -6

/**
 * How dark Polytown is with the sun at `elevation`: 0 in daylight, 1 at
 * night. The official sunset (-0.83°) lands mid-dusk, so the town glows
 * orange and the first lamps come on when the sun really goes down.
 */
export function townNightLevel(elevation: number): number {
    return Math.min(1, Math.max(0, (DAY_ABOVE - elevation) / (DAY_ABOVE - NIGHT_BELOW)))
}

/**
 * Rough coordinates for the common time zones: the sun is followed from the
 * player's time zone, never their location. Close enough that the sunset lands
 * within a few minutes of the real one for most of the zone.
 */
const ZONE_PLACES: Record<string, [number, number]> = {
    'Europe/Amsterdam': [52.37, 4.9],
    'Europe/Brussels': [50.85, 4.35],
    'Europe/Luxembourg': [49.61, 6.13],
    'Europe/London': [51.51, -0.13],
    'Europe/Dublin': [53.35, -6.26],
    'Europe/Paris': [48.86, 2.35],
    'Europe/Berlin': [52.52, 13.4],
    'Europe/Zurich': [47.38, 8.54],
    'Europe/Vienna': [48.21, 16.37],
    'Europe/Copenhagen': [55.68, 12.57],
    'Europe/Oslo': [59.91, 10.75],
    'Europe/Stockholm': [59.33, 18.07],
    'Europe/Helsinki': [60.17, 24.94],
    'Europe/Warsaw': [52.23, 21.01],
    'Europe/Prague': [50.08, 14.44],
    'Europe/Madrid': [40.42, -3.7],
    'Europe/Lisbon': [38.72, -9.14],
    'Europe/Rome': [41.9, 12.5],
    'Europe/Athens': [37.98, 23.73],
    'Europe/Istanbul': [41.01, 28.98],
    'America/New_York': [40.71, -74.01],
    'America/Chicago': [41.88, -87.63],
    'America/Denver': [39.74, -104.99],
    'America/Los_Angeles': [34.05, -118.24],
    'America/Toronto': [43.65, -79.38],
    'America/Sao_Paulo': [-23.55, -46.63],
    'Asia/Tokyo': [35.68, 139.69],
    'Asia/Singapore': [1.35, 103.82],
    'Asia/Kolkata': [28.61, 77.21],
    'Australia/Sydney': [-33.87, 151.21],
    'Australia/Melbourne': [-37.81, 144.96],
    'Australia/Brisbane': [-27.47, 153.03],
    'Australia/Adelaide': [-34.93, 138.6],
    'Australia/Perth': [-31.95, 115.86],
    'Australia/Darwin': [-12.46, 130.84],
    'Australia/Hobart': [-42.88, 147.33],
    'Pacific/Auckland': [-36.85, 174.76]
}

/**
 * A best guess at where the player is from their time zone alone. An unknown
 * zone gets the longitude its standard offset stands for and a mid-latitude:
 * southern when its summer time falls in January, northern otherwise.
 * `offsets` are getTimezoneOffset() in January and July (minutes behind UTC).
 */
export function townPlaceFromTimeZone(timeZone: string | undefined, offsets = localOffsets()): { lat: number, lon: number } {
    const known = timeZone ? ZONE_PLACES[timeZone] : undefined
    if (known) return { lat: known[0], lon: known[1] }
    const [january, july] = offsets
    // The larger offset is standard time; summer time puts the clock an hour ahead.
    const standardOffset = Math.max(january, july)
    const southern = january < july
    return { lat: southern ? -34 : 48, lon: -standardOffset / 4 }
}

function localOffsets(): [number, number] {
    const year = new Date().getFullYear()
    return [new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset()]
}
