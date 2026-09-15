/**
 * gps.js - Quản lý định vị GPS tự động cho hiện trường
 */

let watchId = null;
let latestPosition = null;

export function startGPSWatch(onSuccess, onError) {
  if (!("geolocation" in navigator)) {
    if (onError) onError(new Error("Thiết bị không hỗ trợ Geolocation"));
    return;
  }

  const options = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 1000
  };

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      latestPosition = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
        altitude: pos.coords.altitude !== null ? Math.round(pos.coords.altitude) : null,
        timestamp: pos.timestamp || Date.now()
      };
      if (onSuccess) onSuccess(latestPosition);
    },
    (err) => {
      console.warn("GPS watch error:", err.message);
      if (onError) onError(err);
    },
    options
  );
}

export function stopGPSWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

export function getLatestGPS() {
  return latestPosition;
}

export function getCurrentGPSOnce() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          altitude: pos.coords.altitude !== null ? Math.round(pos.coords.altitude) : null,
          timestamp: pos.timestamp || Date.now()
        };
        latestPosition = p;
        resolve(p);
      },
      () => resolve(latestPosition),
      { enableHighAccuracy: true, timeout: 6000 }
    );
  });
}

export function formatCoords(pos) {
  if (!pos || pos.lat === undefined) return "Chưa có GPS";
  return `${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)} (±${pos.accuracy}m)`;
}
