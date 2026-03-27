import { logger } from './logger.js';

export interface NearbyBusiness {
  name: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  website?: string;
}

/**
 * Find the nearest location of a business by name using the user's GPS coordinates.
 * Uses OpenStreetMap Nominatim for free, no-API-key lookups.
 */
export async function findNearestBusiness(
  businessName: string,
  lat: number,
  lng: number,
): Promise<NearbyBusiness | null> {
  // Strategy 1: Nominatim search bounded to nearby area
  const result = await searchNominatim(businessName, lat, lng);
  if (result) return result;

  // Strategy 2: Overpass API for OSM POI search
  const overpassResult = await searchOverpass(businessName, lat, lng);
  if (overpassResult) return overpassResult;

  return null;
}

async function searchNominatim(
  query: string,
  lat: number,
  lng: number,
): Promise<NearbyBusiness | null> {
  try {
    // Search within ~10km bounding box
    const delta = 0.1; // ~10km
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '5',
      viewbox: `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`,
      bounded: '1',
    });

    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ClawForce/0.1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const results = await response.json() as Array<{
      display_name: string;
      lat: string;
      lon: string;
      address?: {
        house_number?: string;
        road?: string;
        city?: string;
        town?: string;
        state?: string;
        postcode?: string;
      };
    }>;

    if (results.length === 0) return null;

    // Pick the closest result
    let best = results[0];
    let bestDist = haversine(lat, lng, parseFloat(best.lat), parseFloat(best.lon));

    for (const r of results.slice(1)) {
      const d = haversine(lat, lng, parseFloat(r.lat), parseFloat(r.lon));
      if (d < bestDist) {
        best = r;
        bestDist = d;
      }
    }

    const addr = best.address || {};
    const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
    const city = addr.city || addr.town || '';
    const state = addr.state || '';
    const zip = addr.postcode || '';
    const address = [street, city, `${state} ${zip}`].filter(Boolean).join(', ').trim();

    logger.info({ name: query, address, distanceMeters: Math.round(bestDist) }, 'Found nearest business via Nominatim');

    return {
      name: query,
      address: address || best.display_name,
      phone: '',
      latitude: parseFloat(best.lat),
      longitude: parseFloat(best.lon),
      distanceMeters: Math.round(bestDist),
    };
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'Nominatim business search failed');
    return null;
  }
}

async function searchOverpass(
  query: string,
  lat: number,
  lng: number,
): Promise<NearbyBusiness | null> {
  try {
    // Search OSM for nodes/ways with matching name within 10km
    const overpassQuery = `
      [out:json][timeout:5];
      (
        node["name"~"${escapeOverpass(query)}",i](around:10000,${lat},${lng});
        way["name"~"${escapeOverpass(query)}",i](around:10000,${lat},${lng});
      );
      out center body 5;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(overpassQuery)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      elements: Array<{
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };

    if (!data.elements || data.elements.length === 0) return null;

    // Pick closest
    let best: typeof data.elements[0] | null = null;
    let bestDist = Infinity;

    for (const el of data.elements) {
      const eLat = el.lat ?? el.center?.lat;
      const eLon = el.lon ?? el.center?.lon;
      if (eLat == null || eLon == null) continue;

      const d = haversine(lat, lng, eLat, eLon);
      if (d < bestDist) {
        best = el;
        bestDist = d;
      }
    }

    if (!best) return null;

    const bLat = best.lat ?? best.center?.lat ?? 0;
    const bLon = best.lon ?? best.center?.lon ?? 0;
    const tags = best.tags || {};

    // Build address from OSM tags
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    const city = tags['addr:city'] || '';
    const state = tags['addr:state'] || '';
    const zip = tags['addr:postcode'] || '';
    const address = [street, city, `${state} ${zip}`].filter(Boolean).join(', ').trim();

    logger.info({
      name: tags.name || query,
      address,
      distanceMeters: Math.round(bestDist),
    }, 'Found nearest business via Overpass');

    return {
      name: tags.name || query,
      address: address || `${bLat},${bLon}`,
      phone: tags.phone || tags['contact:phone'] || '',
      latitude: bLat,
      longitude: bLon,
      distanceMeters: Math.round(bestDist),
      website: tags.website || tags['contact:website'] || undefined,
    };
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'Overpass business search failed');
    return null;
  }
}

function escapeOverpass(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Haversine distance in meters between two GPS coordinates.
 */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
