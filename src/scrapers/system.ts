import { getMetricsPool, getSourceId, logScrape } from "../db/connection.js";
import { config } from "../config.js";

interface PrometheusQueryResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value: [number, string];
    }>;
  };
}

async function promQuery(query: string): Promise<PrometheusQueryResult> {
  const res = await fetch(
    `http://${config.server.host}:9090/api/v1/query?query=${encodeURIComponent(query)}`
  );
  if (!res.ok) throw new Error(`Prometheus error: ${res.status}`);
  return res.json() as Promise<PrometheusQueryResult>;
}

function getResultValue(result: PrometheusQueryResult): number | null {
  if (result.data.result.length === 0) return null;
  return parseFloat(result.data.result[0].value[1]);
}

export async function scrapeSystemHealth(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    const sourceId = await getSourceId("unraid_server");

    const [cpuResult, memTotalResult, memAvailResult, uptimeResult] = await Promise.all([
      promQuery('100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
      promQuery("node_memory_MemTotal_bytes"),
      promQuery("node_memory_MemAvailable_bytes"),
      promQuery("node_time_seconds - node_boot_time_seconds"),
    ]);

    const cpuUsage = getResultValue(cpuResult);
    const memTotalBytes = getResultValue(memTotalResult);
    const memAvailBytes = getResultValue(memAvailResult);
    const uptime = getResultValue(uptimeResult);

    const memTotalGb = memTotalBytes ? memTotalBytes / (1024 ** 3) : null;
    const memUsedGb = memTotalBytes && memAvailBytes ? (memTotalBytes - memAvailBytes) / (1024 ** 3) : null;

    // Get disk info from filesystem metrics
    let diskUsedTb = null;
    let diskTotalTb = null;
    try {
      const [totalResult, availResult] = await Promise.all([
        promQuery('sum(node_filesystem_size_bytes{fstype!~"tmpfs|devtmpfs|overlay|shm"})'),
        promQuery('sum(node_filesystem_avail_bytes{fstype!~"tmpfs|devtmpfs|overlay|shm"})'),
      ]);
      const totalBytes = getResultValue(totalResult);
      const availBytes = getResultValue(availResult);
      if (totalBytes) {
        diskTotalTb = totalBytes / (1024 ** 4);
        diskUsedTb = availBytes ? (totalBytes - availBytes) / (1024 ** 4) : null;
      }
    } catch { /* disk metrics optional */ }

    // Get Docker container count
    let dockerRunning = null;
    try {
      const dockerRes = await fetch(`http://${config.server.host}:2375/containers/json`);
      if (dockerRes.ok) {
        const containers = await dockerRes.json() as unknown[];
        dockerRunning = containers.length;
      }
    } catch { /* Docker API optional */ }

    // Insert into existing server_metrics table
    await pool.execute(
      `INSERT INTO server_metrics
       (source_id, cpu_pct, ram_used_gb, ram_total_gb, disk_used_tb, disk_total_tb, network_rx_mbps, network_tx_mbps, docker_containers_running, uptime_seconds, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NOW())`,
      [sourceId, cpuUsage, memUsedGb, memTotalGb, diskUsedTb, diskTotalTb, dockerRunning, uptime ? Math.floor(uptime) : null]
    );

    await logScrape("system_health", 1, "success", startedAt);
    console.log(`[System] CPU: ${cpuUsage?.toFixed(1)}%, Mem: ${memUsedGb?.toFixed(1)}/${memTotalGb?.toFixed(1)}GB`);
    return 1;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[System] Health error:", msg);
    await logScrape("system_health", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeDockerContainers(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    const sourceId = await getSourceId("docker_monitor");

    const res = await fetch(`http://${config.server.host}:2375/containers/json?all=true`);
    if (!res.ok) throw new Error(`Docker API error: ${res.status}`);

    interface DockerContainer {
      Id: string;
      Names: string[];
      Image: string;
      State: string;
      Status: string;
    }

    const containers: DockerContainer[] = await res.json();
    let count = 0;

    for (const container of containers) {
      const name = container.Names[0]?.replace(/^\//, "") || container.Id.slice(0, 12);

      await pool.execute(
        `INSERT INTO docker_containers
         (source_id, container_id, container_name, image, state, status, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [sourceId, container.Id.slice(0, 12), name, container.Image, container.State, container.Status]
      );
      count++;
    }

    await logScrape("docker_containers", count, "success", startedAt);
    console.log(`[System] ${count} Docker containers recorded`);
    return count;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[System] Docker error:", msg);
    await logScrape("docker_containers", 0, "error", startedAt, msg);
    return 0;
  }
}

export async function scrapeInternetHealth(): Promise<number> {
  const startedAt = new Date();
  const pool = getMetricsPool();

  try {
    if (!config.homeAssistant.token) {
      console.log("[System] No HA token for internet health, skipping");
      return 0;
    }

    const sourceId = await getSourceId("speed_test");

    const [dlRes, ulRes, pingRes] = await Promise.all([
      fetch(`${config.homeAssistant.url}/api/states/sensor.speedtest_download`, {
        headers: { Authorization: `Bearer ${config.homeAssistant.token}` },
      }),
      fetch(`${config.homeAssistant.url}/api/states/sensor.speedtest_upload`, {
        headers: { Authorization: `Bearer ${config.homeAssistant.token}` },
      }),
      fetch(`${config.homeAssistant.url}/api/states/sensor.speedtest_ping`, {
        headers: { Authorization: `Bearer ${config.homeAssistant.token}` },
      }),
    ]);

    let download = null, upload = null, ping = null;

    if (dlRes.ok) {
      const data = await dlRes.json() as { state: string };
      download = parseFloat(data.state) || null;
    }
    if (ulRes.ok) {
      const data = await ulRes.json() as { state: string };
      upload = parseFloat(data.state) || null;
    }
    if (pingRes.ok) {
      const data = await pingRes.json() as { state: string };
      ping = parseFloat(data.state) || null;
    }

    if (download || upload || ping) {
      await pool.execute(
        `INSERT INTO speed_tests (source_id, download_mbps, upload_mbps, ping_ms, recorded_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [sourceId, download, upload, ping]
      );

      await logScrape("internet_health", 1, "success", startedAt);
      console.log(`[System] Speed: ↓${download}Mbps ↑${upload}Mbps ping:${ping}ms`);
      return 1;
    }

    return 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[System] Internet error:", msg);
    await logScrape("internet_health", 0, "error", startedAt, msg);
    return 0;
  }
}
