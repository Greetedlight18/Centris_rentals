import type { Network, Property, Station, TransitLine } from "@/services/api";

export interface TransitPolylineSegment {
  id: string;
  network: Network;
  line: TransitLine;
  color: string;
  operational: boolean;
  positions: [number, number][];
}

export interface CommuteDestination {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  isCustom?: boolean;
}

export interface CommuteEstimate {
  totalMinutes: number;
  mode: "walk" | "transit";
  summary: string;
  boardStation?: string;
  boardLine?: TransitLine;
  exitStation?: string;
  walkToStationMin?: number;
  transitRideMin?: number;
  walkFromStationMin?: number;
  transfers?: number;
}

export const COMMUTE_PRESETS: CommuteDestination[] = [
  { id: "mcgill", label: "McGill University", latitude: 45.5048, longitude: -73.5772 },
  { id: "concordia", label: "Concordia (SGW)", latitude: 45.4953, longitude: -73.5789 },
  { id: "udem", label: "Université de Montréal", latitude: 45.5048, longitude: -73.6132 },
  { id: "uqam", label: "UQAM / Quartier Latin", latitude: 45.5146, longitude: -73.5606 },
  { id: "downtown", label: "Downtown / Gare Centrale", latitude: 45.4998, longitude: -73.5667 },
  { id: "old-mtl", label: "Old Montréal / Square-Victoria", latitude: 45.5020, longitude: -73.5595 },
  { id: "mile-end", label: "Mile End (St-Viateur / Ubisoft)", latitude: 45.5269, longitude: -73.5985 },
  { id: "chum", label: "CHUM Hospital", latitude: 45.5117, longitude: -73.5576 },
];

interface LineDefinition {
  id: string;
  network: Network;
  line: TransitLine;
  color: string;
  operational: boolean;
  hopMinutes: number;
  stations: string[];
}

const LINE_DEFINITIONS: LineDefinition[] = [
  {
    id: "green",
    network: "METRO",
    line: "Green",
    color: "#008E4F",
    operational: true,
    hopMinutes: 1.75,
    stations: [
      "Angrignon",
      "Monk",
      "Jolicoeur",
      "Verdun",
      "De l'Église",
      "LaSalle",
      "Charlevoix",
      "Lionel-Groulx",
      "Atwater",
      "Guy-Concordia",
      "Peel",
      "McGill",
      "Place-des-Arts",
      "Saint-Laurent",
      "Berri-UQAM",
      "Beaudry",
      "Papineau",
      "Frontenac",
      "Préfontaine",
      "Joliette",
      "Pie-IX",
      "Viau",
      "Assomption",
      "Cadillac",
      "Langelier",
      "Radisson",
      "Honoré-Beaugrand",
    ],
  },
  {
    id: "orange",
    network: "METRO",
    line: "Orange",
    color: "#ED8B00",
    operational: true,
    hopMinutes: 1.8,
    stations: [
      "Côte-Vertu",
      "Du Collège",
      "De la Savane",
      "Namur",
      "Plamondon",
      "Côte-Sainte-Catherine",
      "Snowdon",
      "Villa-Maria",
      "Vendôme",
      "Place-Saint-Henri",
      "Lionel-Groulx",
      "Georges-Vanier",
      "Lucien-L'Allier",
      "Bonaventure",
      "Square-Victoria–OACI",
      "Place-d'Armes",
      "Champ-de-Mars",
      "Berri-UQAM",
      "Sherbrooke",
      "Mont-Royal",
      "Laurier",
      "Rosemont",
      "Beaubien",
      "Jean-Talon",
      "Jarry",
      "Crémazie",
      "Sauvé",
      "Henri-Bourassa",
      "Cartier",
      "De la Concorde",
      "Montmorency",
    ],
  },
  {
    id: "blue",
    network: "METRO",
    line: "Blue",
    color: "#0085CA",
    operational: true,
    hopMinutes: 1.75,
    stations: [
      "Snowdon",
      "Côte-des-Neiges",
      "Université-de-Montréal",
      "Édouard-Montpetit",
      "Outremont",
      "Acadie",
      "Parc",
      "De Castelnau",
      "Jean-Talon",
      "Fabre",
      "D'Iberville",
      "Saint-Michel",
    ],
  },
  {
    id: "yellow",
    network: "METRO",
    line: "Yellow",
    color: "#F9B900",
    operational: true,
    hopMinutes: 3.0,
    stations: ["Berri-UQAM", "Jean-Drapeau", "Longueuil–Université-de-Sherbrooke"],
  },
  {
    id: "rem-trunk",
    network: "REM",
    line: "REM",
    color: "#5EB33B",
    operational: true,
    hopMinutes: 2.3,
    stations: [
      "Brossard",
      "Du Quartier",
      "Panama",
      "Île-des-Sœurs",
      "Griffintown–Bernard-Landry",
      "Gare Centrale",
      "McGill",
      "Édouard-Montpetit",
      "Canora",
      "Ville-de-Mont-Royal",
      "Côte-de-Liesse",
      "Montpellier",
      "Du Ruisseau",
      "Bois-Franc",
    ],
  },
  {
    id: "rem-a3",
    network: "REM",
    line: "REM",
    color: "#5EB33B",
    operational: true,
    hopMinutes: 2.5,
    stations: [
      "Bois-Franc",
      "Sunnybrooke",
      "Pierrefonds-Roxboro",
      "Île-Bigras",
      "Sainte-Dorothée",
      "Grand-Moulin",
      "Deux-Montagnes",
    ],
  },
  {
    id: "rem-a4",
    network: "REM",
    line: "REM",
    color: "#5EB33B",
    operational: true,
    hopMinutes: 2.6,
    stations: [
      "Bois-Franc",
      "Des Sources",
      "Fairview–Pointe-Claire",
      "Kirkland",
      "Anse-à-l'Orme",
    ],
  },
];

const SPECIAL_HOP_MINUTES: Record<string, number> = {
  "REM|Île-des-Sœurs|Panama": 4.5,
  "REM|Panama|Île-des-Sœurs": 4.5,
  "REM|Édouard-Montpetit|Canora": 3.5,
  "REM|Canora|Édouard-Montpetit": 3.5,
  "METRO|Henri-Bourassa|Cartier": 3.0,
  "METRO|Cartier|Henri-Bourassa": 3.0,
};

interface TransferRule {
  fromNetwork: Network;
  fromLine: TransitLine;
  fromName: string;
  toNetwork: Network;
  toLine: TransitLine;
  toName: string;
  minutes: number;
}

const INTER_STATION_TRANSFERS: TransferRule[] = [
  {
    fromNetwork: "METRO",
    fromLine: "Orange",
    fromName: "Bonaventure",
    toNetwork: "REM",
    toLine: "REM",
    toName: "Gare Centrale",
    minutes: 4.5,
  },
  {
    fromNetwork: "METRO",
    fromLine: "Green",
    fromName: "McGill",
    toNetwork: "REM",
    toLine: "REM",
    toName: "McGill",
    minutes: 3.5,
  },
  {
    fromNetwork: "METRO",
    fromLine: "Blue",
    fromName: "Édouard-Montpetit",
    toNetwork: "REM",
    toLine: "REM",
    toName: "Édouard-Montpetit",
    minutes: 4.0,
  },
];

const WALK_SPEED_MPM = 80.0;
const INITIAL_BOARDING_WAIT_MIN = 2.5;
const MAX_DEST_STATION_RADIUS_M = 2000;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function buildTransitPolylines(stations: Station[]): TransitPolylineSegment[] {
  if (stations.length === 0) return [];
  const byKey = new Map<string, Station>();
  for (const station of stations) {
    byKey.set(`${station.network}|${station.line}|${station.name}`, station);
  }

  const segments: TransitPolylineSegment[] = [];
  for (const def of LINE_DEFINITIONS) {
    const positions: [number, number][] = [];
    for (const name of def.stations) {
      const station = byKey.get(`${def.network}|${def.line}|${name}`);
      if (station) {
        positions.push([station.latitude, station.longitude]);
      }
    }
    if (positions.length >= 2) {
      segments.push({
        id: def.id,
        network: def.network,
        line: def.line,
        color: def.color,
        operational: def.operational,
        positions,
      });
    }
  }
  return segments;
}

interface GraphEdge {
  to: string;
  weight: number;
  isTransfer: boolean;
}

function nodeKey(network: string, line: string, name: string): string {
  return `${network}|${line}|${name}`;
}

export interface StationRouteToDest {
  transitPlusEgressMin: number;
  transitRideMin: number;
  walkFromStationMin: number;
  boardLine: TransitLine;
  exitStation: string;
  transfers: number;
}

export interface CommuteLookup {
  destination: CommuteDestination;
  byHub: Map<string, StationRouteToDest>;
}

export function buildCommuteLookup(
  stations: Station[],
  destination: CommuteDestination | null,
): CommuteLookup | null {
  if (!destination || stations.length === 0) return null;

  const operational = stations.filter((s) => s.is_operational);
  const adj = new Map<string, GraphEdge[]>();
  const nodeMeta = new Map<string, { network: Network; line: TransitLine; name: string }>();

  const ensureNode = (network: Network, line: TransitLine, name: string): string => {
    const key = nodeKey(network, line, name);
    if (!adj.has(key)) {
      adj.set(key, []);
      nodeMeta.set(key, { network, line, name });
    }
    return key;
  };

  const addUndirected = (a: string, b: string, weight: number, isTransfer: boolean) => {
    adj.get(a)?.push({ to: b, weight, isTransfer });
    adj.get(b)?.push({ to: a, weight, isTransfer });
  };

  const validSet = new Set(operational.map((s) => nodeKey(s.network, s.line, s.name)));

  for (const def of LINE_DEFINITIONS) {
    if (!def.operational) continue;
    for (let i = 0; i < def.stations.length - 1; i++) {
      const s1 = def.stations[i];
      const s2 = def.stations[i + 1];
      const k1 = nodeKey(def.network, def.line, s1);
      const k2 = nodeKey(def.network, def.line, s2);
      if (!validSet.has(k1) || !validSet.has(k2)) continue;
      ensureNode(def.network, def.line, s1);
      ensureNode(def.network, def.line, s2);
      const special = SPECIAL_HOP_MINUTES[`${def.network}|${s1}|${s2}`];
      addUndirected(k1, k2, special ?? def.hopMinutes, false);
    }
  }

  // Same-hub Metro transfers (Berri-UQAM, Lionel-Groulx, Jean-Talon, Snowdon)
  const byHubName = new Map<string, Station[]>();
  for (const st of operational) {
    const hub = `${st.network}|${st.name}`;
    const list = byHubName.get(hub);
    if (list) list.push(st);
    else byHubName.set(hub, [st]);
  }
  for (const [, list] of byHubName.entries()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = ensureNode(list[i].network, list[i].line, list[i].name);
        const b = ensureNode(list[j].network, list[j].line, list[j].name);
        const transferPenalty = list[i].name === "Lionel-Groulx" ? 2.0 : 3.5;
        addUndirected(a, b, transferPenalty, true);
      }
    }
  }

  for (const tr of INTER_STATION_TRANSFERS) {
    const k1 = nodeKey(tr.fromNetwork, tr.fromLine, tr.fromName);
    const k2 = nodeKey(tr.toNetwork, tr.toLine, tr.toName);
    if (validSet.has(k1) && validSet.has(k2)) {
      ensureNode(tr.fromNetwork, tr.fromLine, tr.fromName);
      ensureNode(tr.toNetwork, tr.toLine, tr.toName);
      addUndirected(k1, k2, tr.minutes, true);
    }
  }

  // Reverse Dijkstra starting from stations near the destination
  interface State {
    totalFromBoard: number;
    transitMin: number;
    egressWalkMin: number;
    exitStation: string;
    transfers: number;
  }

  const best = new Map<string, State>();
  const visited = new Set<string>();

  for (const st of operational) {
    const k = nodeKey(st.network, st.line, st.name);
    if (!adj.has(k)) continue;
    const distM = haversineMeters(
      st.latitude,
      st.longitude,
      destination.latitude,
      destination.longitude,
    );
    if (distM <= MAX_DEST_STATION_RADIUS_M) {
      const egress = distM / WALK_SPEED_MPM;
      const existing = best.get(k);
      if (!existing || egress < existing.totalFromBoard) {
        best.set(k, {
          totalFromBoard: egress,
          transitMin: 0,
          egressWalkMin: egress,
          exitStation: st.name,
          transfers: 0,
        });
      }
    }
  }

  while (true) {
    let currentKey: string | null = null;
    let currentCost = Number.POSITIVE_INFINITY;
    for (const [k, st] of best.entries()) {
      if (!visited.has(k) && st.totalFromBoard < currentCost) {
        currentCost = st.totalFromBoard;
        currentKey = k;
      }
    }
    if (currentKey === null) break;
    visited.add(currentKey);
    const currentState = best.get(currentKey)!;
    const edges = adj.get(currentKey) ?? [];

    for (const edge of edges) {
      const nextCost = currentState.totalFromBoard + edge.weight;
      const prev = best.get(edge.to);
      if (!prev || nextCost < prev.totalFromBoard) {
        best.set(edge.to, {
          totalFromBoard: nextCost,
          transitMin: currentState.transitMin + edge.weight,
          egressWalkMin: currentState.egressWalkMin,
          exitStation: currentState.exitStation,
          transfers: currentState.transfers + (edge.isTransfer ? 1 : 0),
        });
      }
    }
  }

  const byHub = new Map<string, StationRouteToDest>();
  for (const [k, state] of best.entries()) {
    const meta = nodeMeta.get(k);
    if (!meta) continue;
    const hub = `${meta.network}|${meta.name}`;
    const candidate: StationRouteToDest = {
      transitPlusEgressMin: state.totalFromBoard,
      transitRideMin: state.transitMin,
      walkFromStationMin: state.egressWalkMin,
      boardLine: meta.line,
      exitStation: state.exitStation,
      transfers: state.transfers,
    };
    const existing = byHub.get(hub);
    if (!existing || candidate.transitPlusEgressMin < existing.transitPlusEgressMin) {
      byHub.set(hub, candidate);
    }
  }

  return { destination, byHub };
}

export function estimatePropertyCommute(
  property: Property,
  lookup: CommuteLookup | null,
): CommuteEstimate | null {
  if (!lookup) return null;
  const { destination, byHub } = lookup;

  const directDistM = haversineMeters(
    property.latitude,
    property.longitude,
    destination.latitude,
    destination.longitude,
  );
  const directWalkMin = directDistM / WALK_SPEED_MPM;

  let bestTransit: {
    total: number;
    walkTo: number;
    boardName: string;
    route: StationRouteToDest;
  } | null = null;

  const candidateStations =
    property.nearby_stations && property.nearby_stations.length > 0
      ? property.nearby_stations.map((ns) => ({
          name: ns.name,
          network: ns.network,
          walkMinutes: ns.walk_minutes,
        }))
      : [
          {
            name: property.station_name,
            network: property.station_network,
            walkMinutes: property.walk_minutes ?? 10,
          },
        ];

  for (const cand of candidateStations) {
    const route = byHub.get(`${cand.network}|${cand.name}`);
    if (!route) continue;
    const wait = route.transitRideMin > 0 ? INITIAL_BOARDING_WAIT_MIN : 0;
    const total = cand.walkMinutes + wait + route.transitPlusEgressMin;
    if (!bestTransit || total < bestTransit.total) {
      bestTransit = {
        total,
        walkTo: cand.walkMinutes,
        boardName: cand.name,
        route,
      };
    }
  }

  if (!bestTransit || directWalkMin <= bestTransit.total || directWalkMin <= 18) {
    if (directWalkMin <= (bestTransit?.total ?? 45)) {
      const mins = Math.max(1, Math.round(directWalkMin));
      return {
        totalMinutes: mins,
        mode: "walk",
        summary: `${mins} min walk directly to ${destination.label}`,
      };
    }
  }

  if (!bestTransit) return null;

  const totalRounded = Math.max(2, Math.round(bestTransit.total));
  const walkToRounded = Math.max(1, Math.round(bestTransit.walkTo));
  const rideRounded = Math.max(
    1,
    Math.round(bestTransit.route.transitRideMin + INITIAL_BOARDING_WAIT_MIN),
  );
  const egressRounded = Math.max(1, Math.round(bestTransit.route.walkFromStationMin));
  const lineStr =
    bestTransit.route.boardLine === "REM" ? "REM" : `${bestTransit.route.boardLine} line`;

  return {
    totalMinutes: totalRounded,
    mode: "transit",
    boardStation: bestTransit.boardName,
    boardLine: bestTransit.route.boardLine,
    exitStation: bestTransit.route.exitStation,
    walkToStationMin: walkToRounded,
    transitRideMin: rideRounded,
    walkFromStationMin: egressRounded,
    transfers: bestTransit.route.transfers,
    summary: `${walkToRounded}m walk to ${bestTransit.boardName} → ${rideRounded}m on ${lineStr}${
      bestTransit.route.transfers > 0 ? ` (${bestTransit.route.transfers} transfer)` : ""
    } → ${egressRounded}m walk from ${bestTransit.route.exitStation}`,
  };
}

