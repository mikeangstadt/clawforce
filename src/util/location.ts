import { execSync } from 'child_process';
import { userInfo } from 'os';
import { logger } from './logger.js';

/**
 * Get the device owner's real name from the OS.
 * macOS: reads from Directory Services (the name shown in System Settings).
 * Falls back to OS username.
 */
export function getDeviceOwnerName(): string {
  try {
    const output = execSync(
      `dscl . -read /Users/${userInfo().username} RealName`,
      { timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    // Output is "RealName:\n First Last" — grab the last line
    const lines = output.split('\n');
    const name = lines[lines.length - 1].trim();
    if (name && name !== 'RealName:') return name;
  } catch {
    // Not macOS or dscl unavailable
  }
  return userInfo().username;
}

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  source: 'corelocation';
}

/**
 * Resolve the current device location via GPS (CoreLocationCLI).
 * No fallbacks — GPS or fail. We don't guess with IP geolocation.
 */
export async function resolveCurrentLocation(): Promise<ResolvedLocation> {
  const gps = getCoreLocation();

  if (!gps) {
    throw new Error(
      'Could not get GPS location. Ensure CoreLocationCLI is installed ' +
      '(brew install corelocationcli) and Location Services are enabled ' +
      'for CoreLocationCLI in System Settings > Privacy & Security > Location Services.'
    );
  }

  const address = await reverseGeocode(gps.lat, gps.lng);
  return {
    latitude: gps.lat,
    longitude: gps.lng,
    ...address,
    source: 'corelocation',
  };
}

/**
 * Get precise GPS coordinates via CoreLocationCLI.
 */
function getCoreLocation(): { lat: number; lng: number } | null {
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
        logger.info({ lat, lng }, 'Got GPS location from CoreLocationCLI');
        return { lat, lng };
      }
    }
  } catch {
    // CoreLocationCLI not installed or permission denied
  }
  return null;
}

/**
 * Reverse geocode coordinates to a street address using Apple's geocoder
 * via a lightweight Swift script, falling back to Nominatim.
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
