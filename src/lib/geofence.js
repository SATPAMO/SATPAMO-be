/**
 * geofence.js
 * Utility untuk validasi geofencing lokasi presensi menggunakan rumus Haversine.
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

/**
 * Memvalidasi apakah koordinat mahasiswa berada di dalam radius kampus.
 * @param {number} lat - Latitude mahasiswa
 * @param {number} lon - Longitude mahasiswa
 * @returns {{ distance: number, isValid: boolean, campusLat: number, campusLon: number, maxRadius: number }}
 */
function validateLocation(lat, lon) {
  const campusLat = parseFloat(process.env.CAMPUS_LATITUDE || "-7.968792");
  const campusLon = parseFloat(process.env.CAMPUS_LONGITUDE || "112.592575");
  const maxRadius = parseFloat(process.env.CAMPUS_MAX_RADIUS_METERS || "200");

  const distance = calculateDistance(lat, lon, campusLat, campusLon);
  const isValid = distance <= maxRadius;

  return {
    distance,
    isValid,
    campusLat,
    campusLon,
    maxRadius,
  };
}

module.exports = {
  calculateDistance,
  validateLocation,
};
