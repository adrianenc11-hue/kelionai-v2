import { useState, useEffect } from "react";

export interface UserLocation {
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  source: "gps" | "ip";
}

export function useLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);

  useEffect(() => {
    const cached = sessionStorage.getItem("kelion_location");
    if (cached) {
      try { setLocation(JSON.parse(cached)); return; } catch {}
    }

    // Try GPS first
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: UserLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source: "gps",
        };
        // Reverse geocode via nominatim (free)
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lon}&format=json`)
          .then((r) => r.json())
          .then((data) => {
            loc.city = data.address?.city || data.address?.town || data.address?.village || "";
            loc.country = data.address?.country || "";
            setLocation(loc);
            sessionStorage.setItem("kelion_location", JSON.stringify(loc));
          })
          .catch(() => {
            setLocation(loc);
            sessionStorage.setItem("kelion_location", JSON.stringify(loc));
          });
      },
      () => {
        // GPS failed — IP fallback
        fetch("https://ipapi.co/json/")
          .then((r) => r.json())
          .then((data) => {
            const loc: UserLocation = {
              lat: data.latitude || 0,
              lon: data.longitude || 0,
              city: data.city || "",
              country: data.country_name || "",
              source: "ip",
            };
            setLocation(loc);
            sessionStorage.setItem("kelion_location", JSON.stringify(loc));
          })
          .catch(() => {});
      },
      { timeout: 8000 }
    );
  }, []);

  return location;
}
