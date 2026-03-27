import { execSync } from 'child_process';
import { logger } from './logger.js';

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  source: 'corelocation' | 'ip_geolocation';
}

/**
 * Dynamically resolve the current device location.
 *
 * Strategy:
 * 1. Try CoreLocationCLI (precise GPS from macOS Location Services)
 * 2. Fall back to IP geolocation (city-level accuracy)
 *
 * Then reverse geocode coordinates to a street address.
 */
export async function resolveCurrentLocation(): Promise<ResolvedLocation> {
  // Strategy 1: CoreLocationCLI (precise)
  const gps = tryCoreLcoation();
  if (gps) {
    const address = await reverseGeocode(gps.lat, gps.lng);
    return {
      latitude: gps.lat,
      longitude: gps.lng,
      ...address,
      source: 'corelocation',
    };
  }

  // Strategy 2: IP geolocation (approximate)
  logger.info('CoreLocationCLI unavailable, falling back to IP geolocation');
  const ipLoc = await ipGeolocation();
  if (ipLoc) {
    const address = await reverseGeocode(ipLoc.lat, ipLoc.lng);
    return {
      latitude: ipLoc.lat,
      longitude: ipLoc.lng,
      ...address,
      source: 'ip_geolocation',
    };
  }

  throw new Error(
    'Could not determine current location. ' +
    'Install CoreLocationCLI (brew install corelocationcli) and enable Location Services, ' +
    'or ensure internet access for IP geolocation.'
  );
}

/**
 * Try to get precise GPS coordinates via CoreLocationCLI.
 */
function tryCoreLcoation(): { lat: number; lng: number } | null {
  try {
    const output = execSync('CoreLocationCLI -once -format "%latitude,%longitude" -timeout 5', {
      timeout: 10_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const parts = output.split(',');
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        logger.info({ lat, lng }, 'Got precise location from CoreLocationCLI');
        return { lat, lng };
      }
    }
  } catch {
    // CoreLocationCLI not installed or permission denied
  }
  return null;
}

/**
 * Fall back to IP-based geolocation.
 */
async function ipGeolocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;

    const data = await response.json() as { loc?: string };
    if (!data.loc) return null;

    const [lat, lng] = data.loc.split(',').map(Number);
    if (!isNaN(lat) && !isNaN(lng)) {
      logger.info({ lat, lng, source: 'ip' }, 'Got approximate location from IP geolocation');
      return { lat, lng };
    }
  } catch {
    // No internet or service unavailable
  }
  return null;
}

/**
 * Reverse geocode coordinates to a street address using Apple's geocoder
 * via a lightweight Swift script, falling back to a free API.
 */
async function reverseGeocode(lat: number, lng: number): Promise<{
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}> {
  // Try Apple's CLGeocoder via Swift
  const appleResult = tryAppleReverseGeocode(lat, lng);
  if (appleResult) return appleResult;

  // Fallback: nominatim (OpenStreetMap) — free, no API key
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ClawForce/0.1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json() as {
        display_name?: string;
        address?: {
          house_number?: string;
          road?: string;
          city?: string;
          town?: string;
          state?: string;
          postcode?: string;
          country_code?: string;
        };
      };

      const addr = data.address || {};
      const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
      const city = addr.city || addr.town || '';
      const state = addr.state || '';
      const zip = addr.postcode || '';

      return {
        address: street ? `${street}, ${city}, ${state} ${zip}` : data.display_name || `${lat},${lng}`,
        city,
        state,
        zip,
        country: (addr.country_code || 'US').toUpperCase(),
      };
    }
  } catch {
    // Nominatim unavailable
  }

  return {
    address: `${lat},${lng}`,
    city: '',
    state: '',
    zip: '',
    country: 'US',
  };
}

/**
 * Use Apple's CLGeocoder via a Swift one-liner to reverse geocode.
 */
function tryAppleReverseGeocode(lat: number, lng: number): {
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
} | null {
  try {
    const swift = `
import CoreLocation
import Foundation
let g = CLGeocoder()
let l = CLLocation(latitude: ${lat}, longitude: ${lng})
let s = DispatchSemaphore(value: 0)
g.reverseGeocodeLocation(l) { p, _ in
  if let p = p?.first {
    let parts = [p.subThoroughfare, p.thoroughfare].compactMap{$0}.joined(separator: " ")
    print([parts, p.locality ?? "", p.administrativeArea ?? "", p.postalCode ?? "", p.isoCountryCode ?? "US"].joined(separator: "|"))
  }
  s.signal()
}
_ = s.wait(timeout: .now() + 5)
`;
    const output = execSync(`/usr/bin/swift -e '${swift.replace(/'/g, "'\\''")}'`, {
      timeout: 10_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (output && output.includes('|')) {
      const [street, city, state, zip, country] = output.split('|');
      if (street) {
        return {
          address: `${street}, ${city}, ${state} ${zip}`.trim(),
          city,
          state,
          zip,
          country: country || 'US',
        };
      }
    }
  } catch {
    // Swift not available or geocoding failed
  }
  return null;
}
