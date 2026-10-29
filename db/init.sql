-- =====================================================================
-- Montreal Rentals near Metro / REM
-- Runs once, on first initialisation of the pgdata volume.
-- Note: backend and scraper also run idempotent schema migrations on
-- startup so existing volumes upgrade automatically without data loss.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------
-- stations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stations (
    id               SERIAL PRIMARY KEY,
    name             TEXT        NOT NULL,
    network          TEXT        NOT NULL CHECK (network IN ('METRO', 'REM')),
    line             TEXT        NOT NULL CHECK (line IN ('Green', 'Orange', 'Blue', 'Yellow', 'REM')),
    branch           TEXT,
    line_color       TEXT        NOT NULL,
    is_operational   BOOLEAN     NOT NULL DEFAULT TRUE,
    coords_verified  BOOLEAN     NOT NULL DEFAULT FALSE,
    location         GEOGRAPHY(Point, 4326) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT stations_name_line_unique UNIQUE (name, line)
);

CREATE INDEX IF NOT EXISTS idx_stations_location ON stations USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_stations_network  ON stations (network);
CREATE INDEX IF NOT EXISTS idx_stations_line     ON stations (line);

-- ---------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
    id                         BIGSERIAL PRIMARY KEY,
    centris_id                 TEXT        NOT NULL UNIQUE,
    title                      TEXT,
    property_type              TEXT,
    price                      NUMERIC(10, 2),
    initial_price              NUMERIC(10, 2),
    previous_price             NUMERIC(10, 2),
    price_changed_at           TIMESTAMPTZ,
    bedrooms                   SMALLINT,
    bathrooms                  SMALLINT,
    net_area_sqft              INTEGER,
    parking_available          BOOLEAN     NOT NULL DEFAULT FALSE,
    pets_allowed               BOOLEAN,
    furnished                  BOOLEAN     NOT NULL DEFAULT FALSE,
    appliances_included        BOOLEAN     NOT NULL DEFAULT FALSE,
    laundry_in_unit            BOOLEAN     NOT NULL DEFAULT FALSE,
    heating_included           BOOLEAN     NOT NULL DEFAULT FALSE,
    hydro_included             BOOLEAN     NOT NULL DEFAULT FALSE,
    internet_included          BOOLEAN     NOT NULL DEFAULT FALSE,
    air_conditioning           BOOLEAN     NOT NULL DEFAULT FALSE,
    balcony                    BOOLEAN     NOT NULL DEFAULT FALSE,
    move_in_date               DATE,
    move_in_label              TEXT,
    available_immediately      BOOLEAN     NOT NULL DEFAULT FALSE,
    description_excerpt        TEXT,
    photo_urls                 TEXT[]      NOT NULL DEFAULT '{}',
    address                    TEXT,
    city                       TEXT,
    location                   GEOGRAPHY(Point, 4326),
    url                        TEXT        NOT NULL,
    image_url                  TEXT,
    nearest_station_id         INTEGER REFERENCES stations (id) ON DELETE SET NULL,
    nearest_station_distance_m DOUBLE PRECISION,
    walk_minutes               DOUBLE PRECISION,
    within_15_min              BOOLEAN     NOT NULL DEFAULT FALSE,
    reachable_lines            TEXT[]      NOT NULL DEFAULT '{}',
    reachable_networks         TEXT[]      NOT NULL DEFAULT '{}',
    reachable_station_ids      INTEGER[]   NOT NULL DEFAULT '{}',
    nearby_stations            JSONB       NOT NULL DEFAULT '[]'::jsonb,
    is_active                  BOOLEAN     NOT NULL DEFAULT TRUE,
    first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scraped_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    detail_scraped_at          TIMESTAMPTZ,
    detail_schema_version      SMALLINT    NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_properties_location           ON properties USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_properties_price              ON properties (price);
CREATE INDEX IF NOT EXISTS idx_properties_bedrooms           ON properties (bedrooms);
CREATE INDEX IF NOT EXISTS idx_properties_active             ON properties (is_active, within_15_min);
CREATE INDEX IF NOT EXISTS idx_properties_scraped_at         ON properties (scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_first_seen_at      ON properties (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_reachable_lines    ON properties USING GIN (reachable_lines);
CREATE INDEX IF NOT EXISTS idx_properties_reachable_stations ON properties USING GIN (reachable_station_ids);

-- ---------------------------------------------------------------------
-- property_price_history (tracks rent changes across scrape runs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_price_history (
    id          BIGSERIAL PRIMARY KEY,
    property_id BIGINT         NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
    price       NUMERIC(10, 2) NOT NULL,
    recorded_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_property
    ON property_price_history (property_id, recorded_at ASC);

-- ---------------------------------------------------------------------
-- scrape_runs (audit log for the scraper)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_runs (
    id                 BIGSERIAL PRIMARY KEY,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at        TIMESTAMPTZ,
    status             TEXT        NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'success', 'failed')),
    listings_found     INTEGER     NOT NULL DEFAULT 0,
    listings_upserted  INTEGER     NOT NULL DEFAULT 0,
    error_message      TEXT
);

-- ---------------------------------------------------------------------
-- Price tracking triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION track_property_price_before() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.price IS NOT NULL AND NEW.initial_price IS NULL THEN
            NEW.initial_price := NEW.price;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        NEW.initial_price := COALESCE(OLD.initial_price, OLD.price, NEW.price);
        IF NEW.price IS NOT NULL AND OLD.price IS NOT NULL AND NEW.price <> OLD.price THEN
            NEW.previous_price   := OLD.price;
            NEW.price_changed_at := NOW();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_price_before ON properties;
CREATE TRIGGER trg_properties_price_before
    BEFORE INSERT OR UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION track_property_price_before();

CREATE OR REPLACE FUNCTION track_property_price_after() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.price IS NOT NULL THEN
        IF TG_OP = 'INSERT' THEN
            INSERT INTO property_price_history (property_id, price, recorded_at)
            VALUES (NEW.id, NEW.price, COALESCE(NEW.first_seen_at, NOW()));
        ELSIF TG_OP = 'UPDATE' AND (OLD.price IS NULL OR NEW.price <> OLD.price) THEN
            INSERT INTO property_price_history (property_id, price, recorded_at)
            VALUES (NEW.id, NEW.price, NOW());
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_price_after ON properties;
CREATE TRIGGER trg_properties_price_after
    AFTER INSERT OR UPDATE OF price ON properties
    FOR EACH ROW EXECUTE FUNCTION track_property_price_after();

-- ---------------------------------------------------------------------
-- Proximity trigger: on every insert/update of a property's location,
-- compute nearest operational station, straight-line distance (m),
-- walking minutes (80 m/min ~ 4.8 km/h), the 15-minute flag (<= 1200 m),
-- and all reachable transfer lines / stations within 15 minutes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_property_transit() RETURNS TRIGGER AS $$
DECLARE
    v_station_id INTEGER;
    v_distance   DOUBLE PRECISION;
    v_speed_mpm  CONSTANT DOUBLE PRECISION := 80.0;
    v_max_min    CONSTANT DOUBLE PRECISION := 15.0;
    v_max_dist   CONSTANT DOUBLE PRECISION := 1200.0;
BEGIN
    IF NEW.location IS NULL THEN
        NEW.nearest_station_id         := NULL;
        NEW.nearest_station_distance_m := NULL;
        NEW.walk_minutes               := NULL;
        NEW.within_15_min              := FALSE;
        NEW.reachable_lines            := '{}';
        NEW.reachable_networks         := '{}';
        NEW.reachable_station_ids      := '{}';
        NEW.nearby_stations            := '[]'::jsonb;
        RETURN NEW;
    END IF;

    SELECT s.id, ST_Distance(s.location, NEW.location)
      INTO v_station_id, v_distance
      FROM stations s
     WHERE s.is_operational = TRUE
     ORDER BY s.location <-> NEW.location, s.id ASC
     LIMIT 1;

    NEW.nearest_station_id         := v_station_id;
    NEW.nearest_station_distance_m := v_distance;
    NEW.walk_minutes               := CASE WHEN v_distance IS NULL THEN NULL ELSE v_distance / v_speed_mpm END;
    NEW.within_15_min              := COALESCE((v_distance / v_speed_mpm) <= v_max_min, FALSE);

    IF NEW.within_15_min THEN
        SELECT COALESCE(array_agg(sub.id ORDER BY sub.dist ASC, sub.id ASC), '{}')
          INTO NEW.reachable_station_ids
          FROM (
              SELECT s.id, ST_Distance(s.location, NEW.location) AS dist
                FROM stations s
               WHERE s.is_operational = TRUE
                 AND ST_DWithin(s.location, NEW.location, v_max_dist + 5.0)
                 AND ST_Distance(s.location, NEW.location) <= v_max_dist
          ) sub;

        SELECT COALESCE(array_agg(sub.line ORDER BY sub.min_dist ASC, sub.line ASC), '{}')
          INTO NEW.reachable_lines
          FROM (
              SELECT s.line, MIN(ST_Distance(s.location, NEW.location)) AS min_dist
                FROM stations s
               WHERE s.is_operational = TRUE
                 AND ST_DWithin(s.location, NEW.location, v_max_dist + 5.0)
                 AND ST_Distance(s.location, NEW.location) <= v_max_dist
               GROUP BY s.line
          ) sub;

        SELECT COALESCE(array_agg(sub.network ORDER BY sub.min_dist ASC, sub.network ASC), '{}')
          INTO NEW.reachable_networks
          FROM (
              SELECT s.network, MIN(ST_Distance(s.location, NEW.location)) AS min_dist
                FROM stations s
               WHERE s.is_operational = TRUE
                 AND ST_DWithin(s.location, NEW.location, v_max_dist + 5.0)
                 AND ST_Distance(s.location, NEW.location) <= v_max_dist
               GROUP BY s.network
          ) sub;

        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'station_id', sub.station_id,
                    'name', sub.name,
                    'network', sub.network,
                    'lines', sub.lines,
                    'colors', sub.colors,
                    'distance_m', ROUND(sub.dist::numeric, 1),
                    'walk_minutes', ROUND((sub.dist / v_speed_mpm)::numeric, 1)
                )
                ORDER BY sub.dist ASC, sub.name ASC
            ),
            '[]'::jsonb
        )
          INTO NEW.nearby_stations
          FROM (
              SELECT MIN(s.id) AS station_id,
                     s.name,
                     s.network,
                     MIN(ST_Distance(s.location, NEW.location)) AS dist,
                     array_agg(s.line ORDER BY s.id ASC) AS lines,
                     array_agg(s.line_color ORDER BY s.id ASC) AS colors
                FROM stations s
               WHERE s.is_operational = TRUE
                 AND ST_DWithin(s.location, NEW.location, v_max_dist + 5.0)
                 AND ST_Distance(s.location, NEW.location) <= v_max_dist
               GROUP BY s.name, s.network
          ) sub;
    ELSE
        NEW.reachable_lines       := '{}';
        NEW.reachable_networks    := '{}';
        NEW.reachable_station_ids := '{}';
        NEW.nearby_stations       := '[]'::jsonb;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_transit ON properties;
CREATE TRIGGER trg_properties_transit
    BEFORE INSERT OR UPDATE OF location ON properties
    FOR EACH ROW EXECUTE FUNCTION compute_property_transit();

-- ---------------------------------------------------------------------
-- Convenience view for the API
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_properties_near_transit;
CREATE VIEW v_properties_near_transit AS
SELECT p.id,
       p.centris_id,
       p.title,
       p.property_type,
       p.price,
       p.initial_price,
       p.previous_price,
       p.price_changed_at,
       CASE
           WHEN p.price IS NOT NULL AND p.previous_price IS NOT NULL AND p.price < p.previous_price
               THEN p.previous_price - p.price
           WHEN p.price IS NOT NULL AND p.initial_price IS NOT NULL AND p.price < p.initial_price
               THEN p.initial_price - p.price
           ELSE NULL
       END AS price_drop,
       CASE
           WHEN p.price IS NOT NULL AND p.net_area_sqft IS NOT NULL AND p.net_area_sqft > 0
               THEN ROUND((p.price / p.net_area_sqft)::numeric, 2)
           ELSE NULL
       END AS price_per_sqft,
       p.bedrooms,
       p.bathrooms,
       p.net_area_sqft,
       p.parking_available,
       p.pets_allowed,
       p.furnished,
       p.appliances_included,
       p.laundry_in_unit,
       p.heating_included,
       p.hydro_included,
       p.internet_included,
       p.air_conditioning,
       p.balcony,
       p.move_in_date,
       p.move_in_label,
       p.available_immediately,
       p.description_excerpt,
       p.photo_urls,
       p.address,
       p.city,
       ST_Y(p.location::geometry) AS latitude,
       ST_X(p.location::geometry) AS longitude,
       p.url,
       p.image_url,
       p.nearest_station_distance_m,
       p.walk_minutes,
       p.reachable_lines,
       p.reachable_networks,
       p.reachable_station_ids,
       p.nearby_stations,
       p.first_seen_at,
       p.scraped_at,
       s.id         AS station_id,
       s.name       AS station_name,
       s.network    AS station_network,
       s.line       AS station_line,
       s.line_color AS station_color
  FROM properties p
  JOIN stations s ON s.id = p.nearest_station_id
 WHERE p.is_active = TRUE
   AND p.within_15_min = TRUE;

-- ---------------------------------------------------------------------
-- Seed: stations  (lat, lon in WGS84)
-- coords_verified stays FALSE: values are approximate, see README notes.
-- ---------------------------------------------------------------------
INSERT INTO stations (name, network, line, branch, line_color, is_operational, location)
SELECT v.name, v.network, v.line, v.branch, v.line_color, v.is_operational,
       ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography
FROM (VALUES
    -- ===================== GREEN LINE (Line 1) =====================
    ('Angrignon'::text,          'METRO'::text, 'Green'::text, NULL::text, '#008E4F'::text, TRUE, 45.4468::float8, -73.6035::float8),
    ('Monk',                     'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4510, -73.5930),
    ('Jolicoeur',                'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4571, -73.5823),
    ('Verdun',                   'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4592, -73.5718),
    ('De l''Église',             'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4631, -73.5666),
    ('LaSalle',                  'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4710, -73.5679),
    ('Charlevoix',               'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4783, -73.5694),
    ('Lionel-Groulx',            'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4825, -73.5800),
    ('Atwater',                  'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4899, -73.5855),
    ('Guy-Concordia',            'METRO', 'Green', NULL, '#008E4F', TRUE, 45.4950, -73.5790),
    ('Peel',                     'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5008, -73.5746),
    ('McGill',                   'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5039, -73.5714),
    ('Place-des-Arts',           'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5083, -73.5682),
    ('Saint-Laurent',            'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5105, -73.5645),
    ('Berri-UQAM',               'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5153, -73.5612),
    ('Beaudry',                  'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5190, -73.5557),
    ('Papineau',                 'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5236, -73.5527),
    ('Frontenac',                'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5333, -73.5528),
    ('Préfontaine',              'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5415, -73.5518),
    ('Joliette',                 'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5469, -73.5515),
    ('Pie-IX',                   'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5535, -73.5516),
    ('Viau',                     'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5611, -73.5461),
    ('Assomption',               'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5694, -73.5475),
    ('Cadillac',                 'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5772, -73.5457),
    ('Langelier',                'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5826, -73.5420),
    ('Radisson',                 'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5899, -73.5390),
    ('Honoré-Beaugrand',         'METRO', 'Green', NULL, '#008E4F', TRUE, 45.5968, -73.5353),

    -- ===================== ORANGE LINE (Line 2) =====================
    ('Côte-Vertu',               'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5141, -73.6836),
    ('Du Collège',               'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5090, -73.6753),
    ('De la Savane',             'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5000, -73.6610),
    ('Namur',                    'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4950, -73.6560),
    ('Plamondon',                'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4943, -73.6392),
    ('Côte-Sainte-Catherine',    'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4929, -73.6322),
    ('Snowdon',                  'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4855, -73.6317),
    ('Villa-Maria',              'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4816, -73.6197),
    ('Vendôme',                  'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4741, -73.6043),
    ('Place-Saint-Henri',        'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4771, -73.5870),
    ('Lionel-Groulx',            'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4825, -73.5800),
    ('Georges-Vanier',           'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4880, -73.5795),
    ('Lucien-L''Allier',         'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4953, -73.5705),
    ('Bonaventure',              'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.4983, -73.5671),
    ('Square-Victoria–OACI',     'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5025, -73.5628),
    ('Place-d''Armes',           'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5048, -73.5598),
    ('Champ-de-Mars',            'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5100, -73.5560),
    ('Berri-UQAM',               'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5153, -73.5612),
    ('Sherbrooke',               'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5185, -73.5681),
    ('Mont-Royal',               'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5245, -73.5817),
    ('Laurier',                  'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5274, -73.5886),
    ('Rosemont',                 'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5316, -73.5977),
    ('Beaubien',                 'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5352, -73.6048),
    ('Jean-Talon',               'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5393, -73.6137),
    ('Jarry',                    'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5431, -73.6228),
    ('Crémazie',                 'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5468, -73.6342),
    ('Sauvé',                    'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5515, -73.6427),
    ('Henri-Bourassa',           'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5569, -73.6680),
    ('Cartier',                  'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5603, -73.7077),
    ('De la Concorde',           'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5600, -73.7131),
    ('Montmorency',              'METRO', 'Orange', NULL, '#ED8B00', TRUE, 45.5581, -73.7213),

    -- ===================== BLUE LINE (Line 5) =====================
    ('Snowdon',                  'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.4855, -73.6317),
    ('Côte-des-Neiges',          'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.4961, -73.6224),
    ('Université-de-Montréal',   'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5036, -73.6180),
    ('Édouard-Montpetit',        'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5101, -73.6130),
    ('Outremont',                'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5204, -73.6153),
    ('Acadie',                   'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5235, -73.6246),
    ('Parc',                     'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5300, -73.6252),
    ('De Castelnau',             'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5343, -73.6181),
    ('Jean-Talon',               'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5393, -73.6137),
    ('Fabre',                    'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5445, -73.6082),
    ('D''Iberville',             'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5527, -73.6036),
    ('Saint-Michel',             'METRO', 'Blue', NULL, '#0085CA', TRUE, 45.5598, -73.5994),

    -- ===================== YELLOW LINE (Line 4) =====================
    ('Berri-UQAM',                          'METRO', 'Yellow', NULL, '#F9B900', TRUE, 45.5153, -73.5612),
    ('Jean-Drapeau',                        'METRO', 'Yellow', NULL, '#F9B900', TRUE, 45.5129, -73.5336),
    ('Longueuil–Université-de-Sherbrooke',  'METRO', 'Yellow', NULL, '#F9B900', TRUE, 45.5249, -73.5217),

    -- ===================== REM — A1 South Shore (Brossard) =====================
    ('Gare Centrale',            'REM', 'REM', 'A1/A3/A4 Trunk',     '#5EB33B', TRUE, 45.4997, -73.5666),
    ('Griffintown–Bernard-Landry','REM', 'REM', 'A1 Brossard',        '#5EB33B', TRUE, 45.4893, -73.5551),
    ('Île-des-Sœurs',            'REM', 'REM', 'A1 Brossard',        '#5EB33B', TRUE, 45.4630, -73.5445),
    ('Panama',                   'REM', 'REM', 'A1 Brossard',        '#5EB33B', TRUE, 45.4546, -73.4711),
    ('Du Quartier',              'REM', 'REM', 'A1 Brossard',        '#5EB33B', TRUE, 45.4528, -73.4653),
    ('Brossard',                 'REM', 'REM', 'A1 Brossard',        '#5EB33B', TRUE, 45.4517, -73.4590),

    -- ===================== REM — A3 Deux-Montagnes =====================
    ('McGill',                   'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5021, -73.5707),
    ('Édouard-Montpetit',        'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5108, -73.6128),
    ('Canora',                   'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5163, -73.6392),
    ('Ville-de-Mont-Royal',      'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5185, -73.6513),
    ('Côte-de-Liesse',           'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5274, -73.6665),
    ('Montpellier',              'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5226, -73.6740),
    ('Du Ruisseau',              'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5139, -73.6972),
    ('Bois-Franc',               'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5099, -73.7152),
    ('Sunnybrooke',              'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.4968, -73.7701),
    ('Pierrefonds-Roxboro',      'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5113, -73.8036),
    ('Île-Bigras',               'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5381, -73.8316),
    ('Sainte-Dorothée',          'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5452, -73.8573),
    ('Grand-Moulin',             'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5408, -73.8705),
    ('Deux-Montagnes',           'REM', 'REM', 'A3 Deux-Montagnes',  '#5EB33B', TRUE, 45.5381, -73.8984),

    -- ===================== REM — A4 Anse-à-l'Orme =====================
    ('Des Sources',              'REM', 'REM', 'A4 Anse-à-l''Orme',  '#5EB33B', TRUE, 45.4846, -73.7899),
    ('Fairview–Pointe-Claire',   'REM', 'REM', 'A4 Anse-à-l''Orme',  '#5EB33B', TRUE, 45.4777, -73.8189),
    ('Kirkland',                 'REM', 'REM', 'A4 Anse-à-l''Orme',  '#5EB33B', TRUE, 45.4535, -73.8708),
    ('Anse-à-l''Orme',           'REM', 'REM', 'A4 Anse-à-l''Orme',  '#5EB33B', TRUE, 45.4319, -73.9363),

    -- ===================== REM — A2 Airport (not yet open) =====================
    ('Marie-Curie',                   'REM', 'REM', 'A2 Aéroport',   '#5EB33B', FALSE, 45.4864, -73.7467),
    ('Aéroport Montréal-Trudeau',     'REM', 'REM', 'A2 Aéroport',   '#5EB33B', FALSE, 45.4687, -73.7415)
) AS v(name, network, line, branch, line_color, is_operational, lat, lon)
ON CONFLICT (name, line) DO NOTHING;

ANALYZE stations;
