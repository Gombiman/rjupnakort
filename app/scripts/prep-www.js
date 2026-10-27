// Byggir www/ fyrir appið úr rjupnakort.html í rót repoins.
// - Leaflet er sett inn staðbundið svo appið opnist án nets
// - app.js (brú við Android) er hlaðið á undan kóða kortsins
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..", "..");
const www = path.resolve(__dirname, "..", "www");
fs.mkdirSync(path.join(www, "lib"), {recursive: true});
let html = fs.readFileSync(path.join(root, "rjupnakort.html"), "utf8");
const lf = path.resolve(__dirname, "..", "node_modules", "leaflet", "dist");
fs.copyFileSync(path.join(lf, "leaflet.js"), path.join(www, "lib", "leaflet.js"));
fs.copyFileSync(path.join(lf, "leaflet.css"), path.join(www, "lib", "leaflet.css"));
// Capacitor kjarni (registerPlugin o.fl.) — innbyggða brúin skilgreinir hann ekki ein og sér
fs.copyFileSync(path.resolve(__dirname, "..", "node_modules", "@capacitor", "core", "dist", "capacitor.js"), path.join(www, "lib", "capacitor.js"));
const rep = (a, b) => { if (!html.includes(a)) throw new Error("Fann ekki: " + a); html = html.split(a).join(b); };
rep("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "lib/leaflet.css");
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>',
    '<script src="lib/capacitor.js"></script>\n<script src="app.js"></script>\n<script src="lib/leaflet.js"></script>');
const ver = "0.1." + (process.env.RK_VERSION_CODE || "0");
// Hvað er nýtt: fyrsti kafli CHANGES.md
let changes = null;
try {
  const lines = fs.readFileSync(path.join(root, "CHANGES.md"), "utf8").split(/\r?\n/);
  const i = lines.findIndex(l => /^##\s/.test(l));
  if (i >= 0) {
    const items = [];
    for (let j = i + 1; j < lines.length && !/^##\s/.test(lines[j]); j++) { const m = lines[j].match(/^\s*[-*]\s+(.*)/); if (m) items.push(m[1].trim()); }
    changes = { title: lines[i].replace(/^##\s*/, "").trim(), items };
  }
} catch (e) {}
html = html.replace("<head>", `<head>\n<script>window.RK_VERSION = "${ver}"; window.RK_CHANGES = ${JSON.stringify(changes).replace(/</g, "\\u003c")};</script>`);
fs.writeFileSync(path.join(www, "index.html"), html);
fs.copyFileSync(path.join(root, "sw.js"), path.join(www, "sw.js"));
fs.cpSync(path.join(root, "img"), path.join(www, "img"), {recursive: true});
fs.copyFileSync(path.join(root, "manifest.webmanifest"), path.join(www, "manifest.webmanifest"));
fs.copyFileSync(path.resolve(__dirname, "..", "src", "app.js"), path.join(www, "app.js"));
console.log("www tilbúið");
