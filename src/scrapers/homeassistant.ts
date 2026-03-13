import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

async function haFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${config.homeAssistant.url}/api${path}`, {
    headers: {
      Authorization: `Bearer ${config.homeAssistant.token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`HA API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const SENSOR_PREFIXES = [
  "sensor.",
  "binary_sensor.",
  "climate.",
  "light.",
  "switch.",
  "cover.",
  "fan.",
  "lock.",
  "weather.",
];

const SKIP_PATTERNS = [
  "sensor.hacs",
  "_firmware",
  "_linkquality",
  "update.",
];

function shouldTrack(entityId: string): boolean {
  if (!SENSOR_PREFIXES.some((p) => entityId.startsWith(p))) return false;
  if (SKIP_PATTERNS.some((p) => entityId.includes(p))) return false;
  return true;
}

export async function scrapeSensorReadings(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.homeAssistant.token) {
      console.log("[HA] No token configured, skipping");
      return 0;
    }

    const sourceId = await getSourceId("ha_scraper");
    const states = await haFetch<HAState[]>("/states");
    let count = 0;

    for (const state of states) {
      if (!shouldTrack(state.entity_id)) continue;
      if (state.state === "unavailable" || state.state === "unknown") continue;

      const friendlyName = (state.attributes.friendly_name as string) || null;
      const value = parseFloat(state.state);

      // Store numeric sensor values in generic_metrics
      if (!isNaN(value)) {
        const unit = (state.attributes.unit_of_measurement as string) || null;
        const tags: Record<string, unknown> = { entity_id: state.entity_id };
        if (state.attributes.device_class) tags.device_class = state.attributes.device_class;
        if (unit) tags.unit = unit;

        await pool.execute(
          `INSERT INTO generic_metrics (source_id, metric_name, metric_value, metric_text, tags, recorded_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [sourceId, friendlyName || state.entity_id, value, unit, JSON.stringify(tags)]
        );
      } else {
        // Store non-numeric states in generic_metrics as text
        await pool.execute(
          `INSERT INTO generic_metrics (source_id, metric_name, metric_value, metric_text, tags, recorded_at)
           VALUES (?, ?, NULL, ?, ?, NOW())`,
          [sourceId, friendlyName || state.entity_id, state.state, JSON.stringify({ entity_id: state.entity_id })]
        );
      }
      count++;
    }

    await logScrape("ha_sensors", count, "success", startedAt);
    console.log(`[HA] ${count} sensor readings recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[HA] Error:", msg);
    await logScrape("ha_sensors", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeDeviceTrackers(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.homeAssistant.token) return 0;

    const sourceId = await getSourceId("ha_scraper");
    const states = await haFetch<HAState[]>("/states");
    let count = 0;

    for (const state of states) {
      if (!state.entity_id.startsWith("device_tracker.") && !state.entity_id.startsWith("person.")) continue;

      const friendlyName = (state.attributes.friendly_name as string) || null;
      const lat = state.attributes.latitude as number | undefined;
      const lng = state.attributes.longitude as number | undefined;
      const battery = state.attributes.battery_level as number | undefined;

      await pool.execute(
        `INSERT INTO ha_device_tracker (source_id, entity_id, friendly_name, state, latitude, longitude, battery_level, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [sourceId, state.entity_id, friendlyName, state.state, lat || null, lng || null, battery || null]
      );
      count++;
    }

    await logScrape("ha_device_tracker", count, "success", startedAt);
    console.log(`[HA] ${count} device trackers recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[HA] Device tracker error:", msg);
    await logScrape("ha_device_tracker", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeAutomations(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.homeAssistant.token) return 0;

    const sourceId = await getSourceId("ha_scraper");
    const states = await haFetch<HAState[]>("/states");
    let count = 0;

    for (const state of states) {
      if (!state.entity_id.startsWith("automation.")) continue;

      const friendlyName = (state.attributes.friendly_name as string) || null;
      const lastTriggered = (state.attributes.last_triggered as string) || null;

      await pool.execute(
        `INSERT INTO ha_automation_log (source_id, automation_id, friendly_name, last_triggered, state, recorded_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [sourceId, state.entity_id, friendlyName, lastTriggered, state.state]
      );
      count++;
    }

    await logScrape("ha_automations", count, "success", startedAt);
    console.log(`[HA] ${count} automations recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[HA] Automation error:", msg);
    await logScrape("ha_automations", 0, "error", startedAt, msg);
    return 0;
  }
}
