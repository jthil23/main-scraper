import { getF1Pool, logScrape } from "../db/connection.js";

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const OPENF1_BASE = "https://api.openf1.org/v1";

interface JolpicaPitStop {
  driverId: string;
  stop: string;
  lap: string;
  time: string;
  duration: string;
}

interface JolpicaLapTiming {
  number: string;
  Timings: Array<{
    driverId: string;
    position: string;
    time: string;
  }>;
}

interface JolpicaRace {
  round: string;
  PitStops?: JolpicaPitStop[];
  Laps?: JolpicaLapTiming[];
}

interface OpenF1Session {
  session_key: number;
  session_name: string;
  year: number;
  country_name: string;
}

interface OpenF1Weather {
  date: string;
  air_temperature: number;
  track_temperature: number;
  humidity: number;
  wind_speed: number;
  wind_direction: number;
  pressure: number;
  rainfall: number;
}

interface OpenF1Stint {
  driver_number: number;
  stint_number: number;
  compound: string;
  tyre_age_at_start: number;
  lap_start: number;
  lap_end: number;
}

function parseTimeToMs(time: string): number | null {
  // Parse "1:23.456" or "23.456" to milliseconds
  const parts = time.split(":");
  if (parts.length === 2) {
    const minutes = parseInt(parts[0]);
    const seconds = parseFloat(parts[1]);
    return minutes * 60000 + seconds * 1000;
  }
  const seconds = parseFloat(time);
  return isNaN(seconds) ? null : seconds * 1000;
}

async function getRaceId(pool: import("mysql2/promise").Pool, season: number, round: number): Promise<number | null> {
  const [rows] = await pool.execute(
    "SELECT race_id FROM races WHERE season = ? AND round = ?",
    [season, round]
  );
  const results = rows as Array<{ race_id: number }>;
  return results.length > 0 ? results[0].race_id : null;
}

// Map OpenF1 driver_number to Jolpica driver_id using the drivers table
async function getDriverIdByNumber(pool: import("mysql2/promise").Pool, driverNumber: number, season: number): Promise<string | null> {
  const [rows] = await pool.execute(
    "SELECT driver_id FROM drivers WHERE number = ?",
    [driverNumber]
  );
  const results = rows as Array<{ driver_id: string }>;
  return results.length > 0 ? results[0].driver_id : null;
}

export async function scrapePitStops(season: number): Promise<number> {
  const startedAt = new Date();
  const pool = getF1Pool();

  try {
    // Get the schedule to know how many rounds
    const schedRes = await fetch(`${JOLPICA_BASE}/${season}.json?limit=30`);
    if (!schedRes.ok) throw new Error(`Jolpica schedule error: ${schedRes.status}`);
    const schedData = await schedRes.json();
    const races = schedData.MRData.RaceTable.Races as Array<{ round: string; date: string }>;

    let totalCount = 0;

    for (const race of races) {
      // Skip future races
      if (new Date(race.date) > new Date()) continue;

      const round = parseInt(race.round);
      const raceId = await getRaceId(pool, season, round);
      if (!raceId) continue;

      // Check if we already have pit stops for this race
      const [existing] = await pool.execute("SELECT COUNT(*) as cnt FROM pit_stops WHERE race_id = ?", [raceId]);
      if ((existing as Array<{ cnt: number }>)[0].cnt > 0) continue;

      try {
        const res = await fetch(`${JOLPICA_BASE}/${season}/${round}/pitstops.json?limit=100`);
        if (!res.ok) continue;
        const data = await res.json();
        const raceData = data.MRData.RaceTable.Races[0] as JolpicaRace | undefined;
        if (!raceData?.PitStops) continue;

        for (const pit of raceData.PitStops) {
          const durationMs = parseTimeToMs(pit.duration);
          await pool.execute(
            `INSERT INTO pit_stops (race_id, driver_id, stop_number, lap, time_of_day, duration, duration_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE duration=VALUES(duration), duration_ms=VALUES(duration_ms)`,
            [raceId, pit.driverId, parseInt(pit.stop), parseInt(pit.lap), pit.time, pit.duration, durationMs]
          );
          totalCount++;
        }
      } catch {
        // Individual round failure, continue
      }
    }

    await logScrape("f1_pitstops", totalCount, "success", startedAt);
    console.log(`[F1] ${totalCount} pit stops recorded for ${season}`);
    return totalCount;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[F1] Pit stops error:", msg);
    await logScrape("f1_pitstops", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeLapTimes(season: number): Promise<number> {
  const startedAt = new Date();
  const pool = getF1Pool();

  try {
    const schedRes = await fetch(`${JOLPICA_BASE}/${season}.json?limit=30`);
    if (!schedRes.ok) throw new Error(`Jolpica schedule error: ${schedRes.status}`);
    const schedData = await schedRes.json();
    const races = schedData.MRData.RaceTable.Races as Array<{ round: string; date: string }>;

    let totalCount = 0;

    for (const race of races) {
      if (new Date(race.date) > new Date()) continue;

      const round = parseInt(race.round);
      const raceId = await getRaceId(pool, season, round);
      if (!raceId) continue;

      // Check existing
      const [existing] = await pool.execute("SELECT COUNT(*) as cnt FROM lap_times WHERE race_id = ?", [raceId]);
      if ((existing as Array<{ cnt: number }>)[0].cnt > 0) continue;

      try {
        const res = await fetch(`${JOLPICA_BASE}/${season}/${round}/laps.json?limit=2000`);
        if (!res.ok) continue;
        const data = await res.json();
        const raceData = data.MRData.RaceTable.Races[0] as JolpicaRace | undefined;
        if (!raceData?.Laps) continue;

        for (const lap of raceData.Laps) {
          for (const timing of lap.Timings) {
            const timeMs = parseTimeToMs(timing.time);
            await pool.execute(
              `INSERT INTO lap_times (race_id, driver_id, lap_number, position, time, time_ms)
               VALUES (?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE time=VALUES(time), time_ms=VALUES(time_ms)`,
              [raceId, timing.driverId, parseInt(lap.number), parseInt(timing.position), timing.time, timeMs]
            );
            totalCount++;
          }
        }
      } catch {
        // Individual round failure, continue
      }
    }

    await logScrape("f1_laptimes", totalCount, "success", startedAt);
    console.log(`[F1] ${totalCount} lap times recorded for ${season}`);
    return totalCount;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[F1] Lap times error:", msg);
    await logScrape("f1_laptimes", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeRaceWeather(season: number): Promise<number> {
  const startedAt = new Date();
  const pool = getF1Pool();

  try {
    // Get sessions from OpenF1 for the season
    const sessionsRes = await fetch(`${OPENF1_BASE}/sessions?year=${season}&session_type=Race`);
    if (!sessionsRes.ok) throw new Error(`OpenF1 sessions error: ${sessionsRes.status}`);
    const sessions: OpenF1Session[] = await sessionsRes.json();

    let totalCount = 0;

    for (const session of sessions) {
      // Find the corresponding race_id
      // Match by looking up races for this season where the schedule aligns
      const [raceRows] = await pool.execute(
        "SELECT race_id, round FROM races WHERE season = ?",
        [season]
      );
      const races = raceRows as Array<{ race_id: number; round: number }>;

      // Use the session index as rough round mapping (OpenF1 returns in order)
      const sessionIdx = sessions.indexOf(session);
      const race = races[sessionIdx];
      if (!race) continue;

      // Check existing
      const [existing] = await pool.execute("SELECT COUNT(*) as cnt FROM race_weather WHERE race_id = ?", [race.race_id]);
      if ((existing as Array<{ cnt: number }>)[0].cnt > 0) continue;

      try {
        const weatherRes = await fetch(`${OPENF1_BASE}/weather?session_key=${session.session_key}`);
        if (!weatherRes.ok) continue;
        const weatherData: OpenF1Weather[] = await weatherRes.json();

        // Sample every 10th reading to avoid massive data
        const sampled = weatherData.filter((_, i) => i % 10 === 0);
        for (const w of sampled) {
          const recordedAt = new Date(w.date).toISOString().slice(0, 19).replace("T", " ");
          await pool.execute(
            `INSERT INTO race_weather (race_id, session_key, recorded_at, air_temperature, track_temperature, humidity, wind_speed, wind_direction, pressure, rainfall)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [race.race_id, session.session_key, recordedAt, w.air_temperature, w.track_temperature, w.humidity, w.wind_speed, w.wind_direction, w.pressure, w.rainfall]
          );
          totalCount++;
        }
      } catch {
        // Individual session failure
      }
    }

    await logScrape("f1_weather", totalCount, "success", startedAt);
    console.log(`[F1] ${totalCount} weather readings recorded for ${season}`);
    return totalCount;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[F1] Weather error:", msg);
    await logScrape("f1_weather", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeTireStints(season: number): Promise<number> {
  const startedAt = new Date();
  const pool = getF1Pool();

  try {
    const sessionsRes = await fetch(`${OPENF1_BASE}/sessions?year=${season}&session_type=Race`);
    if (!sessionsRes.ok) throw new Error(`OpenF1 sessions error: ${sessionsRes.status}`);
    const sessions: OpenF1Session[] = await sessionsRes.json();

    const [raceRows] = await pool.execute("SELECT race_id, round FROM races WHERE season = ?", [season]);
    const races = raceRows as Array<{ race_id: number; round: number }>;

    let totalCount = 0;

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const race = races[i];
      if (!race) continue;

      const [existing] = await pool.execute("SELECT COUNT(*) as cnt FROM tire_stints WHERE race_id = ?", [race.race_id]);
      if ((existing as Array<{ cnt: number }>)[0].cnt > 0) continue;

      try {
        const stintsRes = await fetch(`${OPENF1_BASE}/stints?session_key=${session.session_key}`);
        if (!stintsRes.ok) continue;
        const stints: OpenF1Stint[] = await stintsRes.json();

        for (const stint of stints) {
          const driverId = await getDriverIdByNumber(pool, stint.driver_number, season);
          if (!driverId) continue;

          await pool.execute(
            `INSERT INTO tire_stints (race_id, session_key, driver_id, driver_number, stint_number, compound, tyre_age_at_start, lap_start, lap_end)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE compound=VALUES(compound), lap_end=VALUES(lap_end)`,
            [race.race_id, session.session_key, driverId, stint.driver_number, stint.stint_number, stint.compound, stint.tyre_age_at_start, stint.lap_start, stint.lap_end]
          );
          totalCount++;
        }
      } catch {
        // Individual session failure
      }
    }

    await logScrape("f1_stints", totalCount, "success", startedAt);
    console.log(`[F1] ${totalCount} tire stints recorded for ${season}`);
    return totalCount;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[F1] Tire stints error:", msg);
    await logScrape("f1_stints", 0, "error", startedAt, msg);
    return 0;
  }
}
