// Sparar rafhlöðu: GPS-viðbótin mælir sjálfgefið á 1 sek fresti. Við mælum á 10 sek fresti (hraðast 5 sek).
const fs = require("fs"), path = require("path");
const f = path.resolve(__dirname, "..", "node_modules", "@capacitor-community", "background-geolocation",
  "android", "src", "main", "java", "com", "equimaps", "capacitor_background_geolocation", "BackgroundGeolocationService.java");
let s = fs.readFileSync(f, "utf8");
if (!s.includes("setFastestInterval(5000)")) {
  if (!s.includes("locationRequest.setInterval(1000);")) throw new Error("GPS-viðbót: fann ekki setInterval(1000)");
  s = s.replace("locationRequest.setInterval(1000);", "locationRequest.setInterval(10000);\n            locationRequest.setFastestInterval(5000);");
  fs.writeFileSync(f, s);
  console.log("GPS-viðbót: mælir á 10 sek fresti");
}
