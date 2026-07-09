#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

echo "Making Atlas live-deploy ready..."

if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found. Run this inside your travel-planner folder."
  exit 1
fi

if [ ! -f "server/index.js" ]; then
  echo "ERROR: server/index.js not found."
  echo "This app needs the Express backend for Gemini/Tavily API keys."
  exit 1
fi

cp package.json package.json.backup
cp server/index.js server/index.js.backup

node <<'NODE'
const fs = require("fs");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

pkg.scripts = pkg.scripts || {};
pkg.scripts.dev = pkg.scripts.dev || 'concurrently -k -n SERVER,CLIENT -c green,cyan "npm run server" "npm run client"';
pkg.scripts.client = pkg.scripts.client || "vite";
pkg.scripts.server = pkg.scripts.server || "node server/index.js";
pkg.scripts.build = pkg.scripts.build || "vite build";
pkg.scripts.preview = pkg.scripts.preview || "vite preview";
pkg.scripts.start = "node server/index.js";

pkg.engines = pkg.engines || {};
pkg.engines.node = ">=20";

fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
NODE

node <<'NODE'
const fs = require("fs");

const file = "server/index.js";
let code = fs.readFileSync(file, "utf8");

if (code.includes("LIVE_DEPLOY_STATIC_BLOCK")) {
  console.log("server/index.js already has the live deploy block.");
  process.exit(0);
}

const staticBlock = `

// LIVE_DEPLOY_STATIC_BLOCK
// In production, Express serves the Vite build so the app works as one live website.
if (process.env.NODE_ENV === "production") {
  const distPath = new URL("../dist/", import.meta.url).pathname;
  const indexPath = new URL("../dist/index.html", import.meta.url).pathname;

  app.use(express.static(distPath));

  app.get("*", (req, res) => {
    res.sendFile(indexPath);
  });
}
`;

const listenRegex = /(?:const\s+PORT\s*=\s*process\.env\.PORT\s*\|\|\s*\d+\s*;[\s\S]*?)?app\.listen\s*\([^;]+?\)\s*;?/m;

if (!listenRegex.test(code)) {
  console.error("ERROR: Could not find app.listen(...) in server/index.js.");
  console.error("Open server/index.js and send it to ChatGPT so it can be patched manually.");
  process.exit(1);
}

code = code.replace(listenRegex, "");

code += staticBlock;

code += `

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
`;

fs.writeFileSync(file, code);
NODE

echo ""
echo "Done."
echo "Backups created:"
echo "  package.json.backup"
echo "  server/index.js.backup"
echo ""
echo "Now test production locally with:"
echo "  npm install"
echo "  npm run build"
echo "  NODE_ENV=production npm start"
echo ""
echo "Then open:"
echo "  http://localhost:3001"
