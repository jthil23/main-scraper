-- Main Scraper Schema Additions
-- Only creates tables that DON'T already exist in JT-METRICS
-- Existing tables used as-is: weather_readings, air_quality_readings, speed_tests,
--   temperature_readings, ticker_prices, server_metrics, gas_prices,
--   generic_metrics, data_sources, phone_metrics, contact_sensor_events, lock_events

USE `JT-METRICS`;

-- ============================================================
-- NEW DATA SOURCES
-- ============================================================
INSERT IGNORE INTO data_sources (source_key, source_type, name, location, is_active) VALUES
  ('adguard', 'scraper', 'AdGuard Home', 'Home', 1),
  ('plex', 'scraper', 'Plex Media Server', 'Home', 1),
  ('frigate', 'scraper', 'Frigate NVR', 'Home', 1),
  ('news_rss', 'scraper', 'News RSS Feeds', NULL, 1),
  ('ha_scraper', 'scraper', 'Home Assistant Scraper', 'Home', 1),
  ('docker_monitor', 'server', 'Docker Monitor', 'Home', 1);

-- ============================================================
-- ADGUARD
-- ============================================================
CREATE TABLE IF NOT EXISTS adguard_stats (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  total_queries INT,
  blocked_queries INT,
  blocked_percentage DECIMAL(5,2),
  avg_processing_time DECIMAL(10,4),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_adguard_time (recorded_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS adguard_top_domains (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  domain VARCHAR(255) NOT NULL,
  query_count INT NOT NULL,
  is_blocked BOOLEAN DEFAULT FALSE,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_adguard_domain (recorded_at, domain)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS adguard_top_clients (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  client_ip VARCHAR(45) NOT NULL,
  client_name VARCHAR(100),
  query_count INT NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_adguard_client (recorded_at, client_ip)
) ENGINE=InnoDB;

-- ============================================================
-- PLEX
-- ============================================================
CREATE TABLE IF NOT EXISTS plex_libraries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  library_key VARCHAR(50) NOT NULL,
  library_name VARCHAR(200) NOT NULL,
  library_type VARCHAR(50),
  item_count INT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_plex_lib (library_key, recorded_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS plex_watch_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  media_type VARCHAR(50),
  grandparent_title VARCHAR(500),
  parent_index INT,
  `index` INT,
  year INT,
  duration_ms BIGINT,
  viewed_at TIMESTAMP NOT NULL,
  account_name VARCHAR(200),
  device_name VARCHAR(200),
  rating_key VARCHAR(50),
  UNIQUE KEY uq_plex_watch (rating_key, viewed_at),
  INDEX idx_plex_watch_time (viewed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS plex_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  active_sessions INT,
  bandwidth_total BIGINT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_plex_session_time (recorded_at)
) ENGINE=InnoDB;

-- ============================================================
-- FRIGATE
-- ============================================================
CREATE TABLE IF NOT EXISTS frigate_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  event_id VARCHAR(100) NOT NULL,
  camera VARCHAR(100) NOT NULL,
  label VARCHAR(100) NOT NULL,
  score DECIMAL(5,4),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NULL,
  has_clip BOOLEAN DEFAULT FALSE,
  has_snapshot BOOLEAN DEFAULT FALSE,
  zones JSON,
  UNIQUE KEY uq_frigate_event (event_id),
  INDEX idx_frigate_camera (camera),
  INDEX idx_frigate_time (start_time),
  INDEX idx_frigate_label (label)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS frigate_stats (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  camera VARCHAR(100) NOT NULL,
  fps DECIMAL(6,2),
  detection_fps DECIMAL(6,2),
  process_fps DECIMAL(6,2),
  skipped_fps DECIMAL(6,2),
  detection_enabled BOOLEAN,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_frigate_stats (recorded_at, camera)
) ENGINE=InnoDB;

-- ============================================================
-- NEWS / RSS
-- ============================================================
CREATE TABLE IF NOT EXISTS news_articles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  feed_name VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  link VARCHAR(1000),
  summary TEXT,
  author VARCHAR(200),
  published_at TIMESTAMP NULL,
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  guid VARCHAR(500),
  UNIQUE KEY uq_news_guid (feed_name, guid),
  INDEX idx_news_feed (feed_name),
  INDEX idx_news_published (published_at)
) ENGINE=InnoDB;

-- ============================================================
-- HOME ASSISTANT EXTENDED
-- ============================================================
CREATE TABLE IF NOT EXISTS ha_device_tracker (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  entity_id VARCHAR(200) NOT NULL,
  friendly_name VARCHAR(200),
  state VARCHAR(50),
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  battery_level INT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ha_tracker_entity (entity_id),
  INDEX idx_ha_tracker_time (recorded_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ha_automation_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  automation_id VARCHAR(200) NOT NULL,
  friendly_name VARCHAR(200),
  last_triggered TIMESTAMP NULL,
  state VARCHAR(50),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ha_auto (automation_id)
) ENGINE=InnoDB;

-- ============================================================
-- DOCKER CONTAINERS
-- ============================================================
CREATE TABLE IF NOT EXISTS docker_containers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  container_id VARCHAR(100) NOT NULL,
  container_name VARCHAR(200) NOT NULL,
  image VARCHAR(500),
  state VARCHAR(50),
  status VARCHAR(200),
  cpu_pct DECIMAL(6,2),
  memory_usage_mb DECIMAL(10,2),
  memory_limit_mb DECIMAL(10,2),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_docker_time (recorded_at),
  INDEX idx_docker_name (container_name)
) ENGINE=InnoDB;

-- ============================================================
-- SCRAPER META
-- ============================================================
CREATE TABLE IF NOT EXISTS scrape_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  scraper VARCHAR(100) NOT NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  records_written INT DEFAULT 0,
  error_message TEXT,
  INDEX idx_scrape_log (scraper, started_at)
) ENGINE=InnoDB;

-- ============================================================
-- F1 EXTENDED (in JT-F1 database)
-- ============================================================
CREATE TABLE IF NOT EXISTS `JT-F1`.pit_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  race_id INT NOT NULL,
  driver_id VARCHAR(100) NOT NULL,
  stop_number INT NOT NULL,
  lap INT NOT NULL,
  time_of_day VARCHAR(20),
  duration VARCHAR(20),
  duration_ms DECIMAL(10,3),
  UNIQUE KEY uq_pitstop (race_id, driver_id, stop_number),
  INDEX idx_pit_race (race_id),
  INDEX idx_pit_driver (driver_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `JT-F1`.lap_times (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  race_id INT NOT NULL,
  driver_id VARCHAR(100) NOT NULL,
  lap_number INT NOT NULL,
  position INT,
  time VARCHAR(20),
  time_ms DECIMAL(10,3),
  UNIQUE KEY uq_laptime (race_id, driver_id, lap_number),
  INDEX idx_lap_race (race_id),
  INDEX idx_lap_driver (driver_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `JT-F1`.race_weather (
  id INT AUTO_INCREMENT PRIMARY KEY,
  race_id INT NOT NULL,
  session_key INT,
  recorded_at TIMESTAMP NOT NULL,
  air_temperature DECIMAL(5,2),
  track_temperature DECIMAL(5,2),
  humidity DECIMAL(5,2),
  wind_speed DECIMAL(6,2),
  wind_direction INT,
  pressure DECIMAL(7,2),
  rainfall DECIMAL(5,2),
  INDEX idx_rw_race (race_id),
  INDEX idx_rw_time (recorded_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `JT-F1`.tire_stints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  race_id INT NOT NULL,
  session_key INT,
  driver_id VARCHAR(100) NOT NULL,
  driver_number INT NOT NULL,
  stint_number INT NOT NULL,
  compound VARCHAR(20),
  tyre_age_at_start INT,
  lap_start INT,
  lap_end INT,
  UNIQUE KEY uq_stint (race_id, driver_id, stint_number),
  INDEX idx_stint_race (race_id)
) ENGINE=InnoDB;
