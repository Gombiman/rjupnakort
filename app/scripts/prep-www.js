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
const rep = (a, b) => { if (!html.includes(a)) throw new Error("Fann ekki: " + a); html = html.split(a).join(b); };
rep("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "lib/leaflet.css");
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>',
    '<script src="app.js"></script>\n<script src="lib/leaflet.js"></script>');
fs.writeFileSync(path.join(www, "index.html"), html);
fs.copyFileSync(path.join(root, "sw.js"), path.join(www, "sw.js"));
fs.copyFileSync(path.resolve(__dirname, "..", "src", "app.js"), path.join(www, "app.js"));
console.log("www tilbúið");
