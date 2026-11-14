import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

try {
  if (!fs.existsSync(dist)) {
    fs.mkdirSync(dist, { recursive: true });
  }

  const publicSrc = path.join(root, "public");
  const publicDest = path.join(dist, "public");
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, publicDest, { recursive: true, force: true });
    console.log("[copy-assets] Copied public/ to dist/public/");
  }

  const screensSrc = path.join(root, "stitch_crisisgrid_emergency_command_platform");
  const screensDest = path.join(dist, "stitch_crisisgrid_emergency_command_platform");
  if (fs.existsSync(screensSrc)) {
    fs.cpSync(screensSrc, screensDest, { recursive: true, force: true });
    console.log("[copy-assets] Copied stitch_crisisgrid_emergency_command_platform/ to dist/");
  }
} catch (error) {
  console.error("[copy-assets] Warning while copying assets:", error);
}
