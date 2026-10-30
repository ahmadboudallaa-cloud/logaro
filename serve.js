// =============================================================
// Petit serveur statique sans dépendance : node serve.js  (ou npm start)
// Les modules ES (type="module") ne fonctionnent pas en file:// :
// il faut servir les fichiers en HTTP. Le serveur affiche aussi
// l'adresse réseau local pour ouvrir l'application depuis un téléphone.
// =============================================================
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = normalize(join(ROOT, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("Accès refusé"); return; } // pas de « ../ »
  try {
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Fichier introuvable");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Thiercelieux disponible sur http://localhost:${PORT}`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) console.log(`  Réseau local : http://${address.address}:${PORT}`);
    }
  }
});
