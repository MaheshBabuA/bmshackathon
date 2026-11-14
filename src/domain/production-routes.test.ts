import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../app.js";

test("CRISISGRID Production Routes — Static Asset and Access Mode Verification", async () => {
  const root = process.cwd();

  // 1. Verify source files exist
  const accessSrc = path.join(root, "public", "access.html");
  assert.ok(fs.existsSync(accessSrc), "public/access.html must exist");
  const accessHtml = fs.readFileSync(accessSrc, "utf8");
  assert.match(accessHtml, /Select Access Mode/i);
  assert.match(accessHtml, /CRISISGRID/i);
  assert.match(accessHtml, /GOVERNMENT COMMAND/i);
  assert.match(accessHtml, /PUBLIC INFORMATION/i);

  const loginSrc = path.join(root, "public", "login.html");
  assert.ok(fs.existsSync(loginSrc), "public/login.html must exist");
  const loginHtml = fs.readFileSync(loginSrc, "utf8");
  assert.match(loginHtml, /Secure Emergency Operations Access/i);
  assert.match(loginHtml, /Authorized Personnel Only/i);

  const publicInfoSrc = path.join(root, "public", "public_information.html");
  assert.ok(fs.existsSync(publicInfoSrc), "public/public_information.html must exist");

  const logoSrc = path.join(root, "public", "crisisgrid_logo.png");
  assert.ok(fs.existsSync(logoSrc), "public/crisisgrid_logo.png must exist");

  const jsSrc = path.join(root, "public", "crisisgrid.js");
  assert.ok(fs.existsSync(jsSrc), "public/crisisgrid.js must exist");

  // 2. Verify dist assets exist (built output)
  const distAccess = path.join(root, "dist", "public", "access.html");
  assert.ok(fs.existsSync(distAccess), "dist/public/access.html must exist after build");

  const distScreen = path.join(
    root,
    "dist",
    "stitch_crisisgrid_emergency_command_platform",
    "city_command_center",
    "code.html",
  );
  assert.ok(
    fs.existsSync(distScreen),
    "dist/stitch_crisisgrid_emergency_command_platform/city_command_center/code.html must exist after build",
  );

  // 3. Verify Express route configurations
  const app = createApp();

  function testRoute(routePath: string, expectedStatus: number, expectedLocationOrFile?: string | RegExp): Promise<void> {
    return new Promise((resolve, reject) => {
      const req: any = {
        method: "GET",
        url: routePath,
        headers: { host: "localhost", accept: "text/html" },
        connection: { remoteAddress: "127.0.0.1" },
        accepts: (t: string) => t === "html",
      };

      const res: any = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        headersSent: false,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        setHeader(k: string, v: string) {
          this.headers[k.toLowerCase()] = v;
        },
        getHeader(k: string) {
          return this.headers[k.toLowerCase()];
        },
        redirect(loc: string) {
          this.statusCode = 302;
          this.setHeader("location", loc);
          try {
            assert.equal(this.statusCode, expectedStatus);
            if (expectedLocationOrFile instanceof RegExp) {
              assert.match(loc, expectedLocationOrFile);
            } else if (expectedLocationOrFile) {
              assert.equal(loc, expectedLocationOrFile);
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        sendFile(file: string, cb?: (err?: any) => void) {
          this.statusCode = 200;
          try {
            assert.equal(this.statusCode, expectedStatus);
            if (expectedLocationOrFile instanceof RegExp) {
              assert.match(file, expectedLocationOrFile);
            } else if (expectedLocationOrFile) {
              assert.ok(file.includes(expectedLocationOrFile), `Expected file path to include ${expectedLocationOrFile}, got ${file}`);
            }
            if (cb) cb();
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        type() {
          return this;
        },
        send(content: string) {
          try {
            assert.equal(this.statusCode, expectedStatus);
            if (expectedLocationOrFile instanceof RegExp) {
              assert.match(content, expectedLocationOrFile);
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        end() {
          resolve();
        },
      };

      (app as any).handle(req, res, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Root redirects to /access
  await testRoute("/", 302, "/access");

  // /access serves access.html
  await testRoute("/access", 200, "access.html");

  // /login serves login.html
  await testRoute("/login", 200, "login.html");

  // /public serves public_information.html
  await testRoute("/public", 200, "public_information.html");

  // /command redirects to command center
  await testRoute("/command", 302, /city_command_center/);

  // /command-center alias redirects to /command
  await testRoute("/command-center", 302, "/command");

  // /dashboard redirects to /command
  await testRoute("/dashboard", 302, "/command");

  // /incidents redirects to live incidents
  await testRoute("/incidents", 302, /live_incidents_system_impact/);

  // /authority-review alias redirects to /authority
  await testRoute("/authority-review", 302, "/authority");

  // /authority redirects to authority review screen
  await testRoute("/authority", 302, /authority_review_authorization/);

  // Screen code.html route injects crisisgrid.js and returns HTML
  await testRoute(
    "/stitch_crisisgrid_emergency_command_platform/city_command_center/code.html",
    200,
    /crisisgrid\.js/,
  );
});
