import { createServer } from "node:http";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(join(fileURLToPath(new URL("..", import.meta.url))));
const port = Number(process.env.PORT ?? 5177);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".stl", "model/stl"],
  [".wasm", "application/wasm"],
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (url.pathname === "/api/samples") {
    try {
      const samplesDir = join(root, "cradlemaker-web", "samples");
      const samples = readdirSync(samplesDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".stl"))
        .map((entry) => ({
          name: entry.name,
          url: `/cradlemaker-web/samples/${encodeURIComponent(entry.name)}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ samples }));
    } catch {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ samples: [] }));
    }
    return;
  }

  const decodedPath = decodeURIComponent(url.pathname);
  let path = normalize(join(root, decodedPath));

  if (!path.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const stats = statSync(path);
    if (stats.isDirectory()) path = join(path, "index.html");
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    response.writeHead(200, {
      "Content-Type": types.get(extname(path).toLowerCase()) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(500);
    response.end("Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Cradlemaker web prototype: http://127.0.0.1:${port}/cradlemaker-web/`);
});
