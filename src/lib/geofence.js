/**
 * geofence.js
 * Utility untuk validasi geofencing lokasi presensi dinamis.
 * Lokasi dan radius dikontrol langsung dari web dashboard dosen secara real-time.
 */

// Radius bumi dalam meter
const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Menghitung jarak garis lurus (great-circle distance) antara dua titik koordinat.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} jarak dalam satuan meter
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10; // Bulatkan ke 1 desimal
}

// In-memory store untuk sesi geofence aktif yang dikontrol dari web dosen
const activeGeofences = new Map();

// Default: Geofence harus diaktifkan dari web dosen (default radius 100m)
const defaultSession = {
  isActive: true, // Default aktif saat server berjalan, namun dapat diaktifkan/dinonaktifkan oleh dosen
  latitude: parseFloat(process.env.CAMPUS_LATITUDE || "-6.89042"),
  longitude: parseFloat(process.env.CAMPUS_LONGITUDE || "107.61031"),
  radius: 100, // Default 100 meter
  ruangan: "Ruang 207",
  kelasId: "global",
  updatedAt: new Date().toISOString(),
};
activeGeofences.set("global", { ...defaultSession });

/**
 * Mengambil status geofence aktif untuk kelas atau global.
 */
function getActiveGeofence(kelasId) {
  if (kelasId && activeGeofences.has(kelasId)) {
    return activeGeofences.get(kelasId);
  }
  return activeGeofences.get("global") || { ...defaultSession };
}

/**
 * Mengatur status aktif/nonaktif dan radius geofence dari web dosen.
 */
function setActiveGeofence({ kelasId = "global", isActive, latitude, longitude, radius, ruangan }) {
  const existing = getActiveGeofence(kelasId);
  const updated = {
    ...existing,
    ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    ...(latitude !== undefined && !isNaN(parseFloat(latitude)) && { latitude: parseFloat(latitude) }),
    ...(longitude !== undefined && !isNaN(parseFloat(longitude)) && { longitude: parseFloat(longitude) }),
    ...(radius !== undefined && !isNaN(parseFloat(radius)) && { radius: parseFloat(radius) }),
    ...(ruangan !== undefined && { ruangan: String(ruangan) }),
    kelasId: kelasId || "global",
    updatedAt: new Date().toISOString(),
  };

  const targetKey = kelasId || "global";
  activeGeofences.set(targetKey, updated);
  activeGeofences.set("global", updated); // sync global fallback

  return updated;
}

/**
 * Memvalidasi apakah koordinat mahasiswa berada di dalam radius geofence yang aktif dari web dosen.
 * @param {number} lat - Latitude mahasiswa
 * @param {number} lon - Longitude mahasiswa
 * @param {string} [kelasId] - ID kelas terkait
 */
function validateLocation(lat, lon, kelasId = "global") {
  const session = getActiveGeofence(kelasId);

  // Jika geofence dinonaktifkan oleh dosen -> Mode Bebas Lokasi (mahasiswa diizinkan absen dari mana saja)
  if (!session.isActive) {
    const distance = calculateDistance(lat, lon, session.latitude, session.longitude);
    return {
      isSessionActive: true,
      isGeofenceActive: false,
      isValid: true,
      distance,
      centerLat: session.latitude,
      centerLon: session.longitude,
      maxRadius: session.radius,
      ruangan: session.ruangan,
      reason: "Bebas Lokasi: Area geofence dinonaktifkan oleh dosen. Presensi dapat dilakukan dari mana saja.",
    };
  }

  const distance = calculateDistance(lat, lon, session.latitude, session.longitude);
  const isValid = distance <= session.radius;

  return {
    isSessionActive: true,
    isGeofenceActive: true,
    isValid,
    distance,
    centerLat: session.latitude,
    centerLon: session.longitude,
    maxRadius: session.radius,
    ruangan: session.ruangan,
    reason: isValid
      ? `Valid (dalam radius ${session.radius}m dari ${session.ruangan})`
      : `Di luar radius geofence (${distance}m dari ${session.ruangan}, batas toleransi dosen ${session.radius}m)`,
  };
}

module.exports = {
  calculateDistance,
  getActiveGeofence,
  setActiveGeofence,
  validateLocation,
};
