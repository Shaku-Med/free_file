import geoip from "geoip-lite";
import db from "~/lib/Database/supabase";
import { RateLimiter } from "~/routes/Auth/fun/rateLimit";

export interface GeoInfo {
  ip: string;
  country: string | null; // ISO code, e.g. US
  countryName: string | null; // e.g. United States
  region: string | null; // e.g. NY
  city: string | null; // e.g. Staten Island
  timezone: string | null; // e.g. America/New_York
  lat: number | null;
  lon: number | null;
}

let regionNames: Intl.DisplayNames | null = null;
function isoToCountryName(code: string | null): string | null {
  if (!code) return null;
  try {
    if (!regionNames) regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? null;
  } catch {
    return null;
  }
}

/** Coarse geo from the client IP. Offline (geoip-lite), best-effort, never throws. */
export function resolveGeo(request: Request): GeoInfo {
  const ip = RateLimiter.getClientIP(request);
  const out: GeoInfo = {
    ip,
    country: null,
    countryName: null,
    region: null,
    city: null,
    timezone: null,
    lat: null,
    lon: null,
  };
  try {
    const clean = ip.replace(/^::ffff:/i, "").split("%")[0].trim();
    const g = clean ? geoip.lookup(clean) : null;
    if (g) {
      out.country = g.country || null;
      out.countryName = isoToCountryName(g.country || null);
      out.region = g.region || null;
      out.city = g.city || null;
      out.timezone = g.timezone || null;
      if (Array.isArray(g.ll) && g.ll.length === 2) {
        out.lat = typeof g.ll[0] === "number" ? g.ll[0] : null;
        out.lon = typeof g.ll[1] === "number" ? g.ll[1] : null;
      }
    }
  } catch {
    // geo is optional metadata; swallow and return what we have
  }
  return out;
}

// Only refresh a user's geo once per window, tracked in memory (the server is
// long-lived) so opening the app repeatedly never floods the users table.
const GEO_REFRESH_MS = 6 * 60 * 60 * 1000;
const lastUserGeoWrite = new Map<string, number>();

/**
 * Fire-and-forget from the root loader: refresh the signed-in user's stored geo
 * at most once per window. Covers signup/login implicitly (the page they land
 * on runs the root loader). Safe to call on every request.
 */
export async function maybeUpdateUserGeo(request: Request, userId: string): Promise<void> {
  if (!userId || !db) return;
  const now = Date.now();
  const prev = lastUserGeoWrite.get(userId);
  if (prev && now - prev < GEO_REFRESH_MS) return;
  // Claim the slot before awaiting so concurrent requests don't stampede.
  lastUserGeoWrite.set(userId, now);
  if (lastUserGeoWrite.size > 50000) {
    lastUserGeoWrite.clear();
    lastUserGeoWrite.set(userId, now);
  }

  const geo = resolveGeo(request);
  try {
    await db
      .from("users")
      .update({
        last_ip: geo.ip,
        geo_country: geo.country,
        geo_country_name: geo.countryName,
        geo_region: geo.region,
        geo_city: geo.city,
        geo_timezone: geo.timezone,
        geo_lat: geo.lat,
        geo_lon: geo.lon,
        geo_updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
  } catch {
    // Roll back the throttle so we retry on the next request.
    lastUserGeoWrite.delete(userId);
  }
}
