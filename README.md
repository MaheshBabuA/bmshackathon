# CRISISGRID simulation MVP

CRISISGRID is a human-reviewed **crisis simulation and decision-support MVP**. It does not connect to, control, or measure municipal power grids or emergency infrastructure.

The six Stitch-designed screens remain static HTML/CSS. A small TypeScript API serves the existing screen files and injects `public/crisisgrid.js` at request time; it does not rewrite the screen exports or change their layout. The browser reads the database-backed dashboard, refreshes it every 15 seconds, submits citizen reports, sends authority decisions to the API, and opens an incident selected from the Command Center on the Live Incidents screen.

## Backend architecture

- **API/server:** Express and strict TypeScript (`src/app.ts`, `src/server.ts`).
- **Persistence:** Supabase PostgreSQL. The server uses a server-only service-role key; it is never sent to the browser. Row-level security is enabled on all application tables.
- **Validation:** Zod validates report bodies, authority decisions, and allocation changes.
- **Incident analysis:** A deterministic, documented-in-code rules table (`src/domain/incidents.ts`) estimates demand changes from incident category and severity. It does not call an AI service or claim to be real telemetry.
- **Dynamic allocation:** `src/domain/dynamic-allocation.ts` recalculates from current sector allocations plus all active incident impacts. It constrains requested values to sector limits, reduces flexible/non-life-critical sectors first during shortages, considers priority and incident severity, and returns per-sector rationales, safety margins, decision factors, and warnings without using an LLM. `/api/allocation/simulate` runs a read-only calculation; `/api/allocation-plans/recommend` runs and persists that same calculation for human review. Application logic and PostgreSQL constraints prevent recommendations above **45 MW**.
- **Atomic decisions:** PostgreSQL functions save a report, its sector impacts, a recommendation, telemetry, and audit entries in one transaction. Authority decisions are also recorded transactionally. Approving or modifying a plan makes it the active **simulation** allocation; rejecting it leaves the previous active plan unchanged.
- **Screen updates:** The unchanged screens are served from `/stitch_crisisgrid_emergency_command_platform/<screen>/code.html`. The Command Center's capacity, incident stream, grid load, response units, sector cards, telemetry, and incident location are populated from `/api/dashboard`; screens refresh every 15 seconds. Inspect carries the selected incident to the Live Incidents screen. Reserve-transfer requests are handled transactionally and audited; each request asks for 1 MW, respects the city-grid headroom and strict 45 MW emergency-capacity ceiling, then recalculates a recommendation for authority review.
- **Incident decision support:** The Live Incidents screen reads incidents and sector impact reasons from PostgreSQL, supports severity/escalation/automated-triage filters, and calculates selected-incident reallocations with the deterministic engine. Sending for authority review writes a `pending_review` plan, all four plan items, and an audit log transactionally. A manual override requires the server-only `CRISISGRID_DEMO_AUTHORITY_TOKEN`; the engine applies the requested sector value, reallocates the remaining sectors, and rejects unsafe or over-capacity results before persisting the review plan and audit entry.

### Database tables

The migrations create `incidents`, `incident_impacts`, `infrastructure_sectors`, `allocation_plans`, `allocation_plan_items`, `authority_reviews`, `emergency_reports`, `audit_logs`, `telemetry_snapshots`, and `command_center_state`, including incident response-unit assignments, triage/escalation flags, perimeter/dispatch details, city-grid and telemetry summary measurements, sector operational metadata, before/after plan values, authority decision timestamps, report location/language, and audit event details. The incremental scenario migrations preserve existing API columns while adding the Bengaluru demo fields. Database constraints and transactional RPCs protect report submission, recommendations, reviews, incident status changes, and reserve-transfer attempts.

## Configure Supabase

Install the Supabase CLI if you do not already have it, then link this folder to your Supabase project:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

For a **hosted** Supabase project, apply all pending migrations (`npx supabase db push` after linking; latest is `202611140004_incident_decision_support.sql`) and run [`supabase/seed.sql`](./supabase/seed.sql) in the project's SQL Editor. The seed is idempotent and loads the four configured sectors, baseline allocation, active incident **INC-8092**, a 45 MW pending recommendation, audit/report entries, and simulated city/sector telemetry. The telemetry and grid summary values are scenario data, not live municipal measurements. At the seeded full-capacity state, a reserve transfer is correctly denied and audited because the emergency pool is already at its 45 MW ceiling.

Alternatively, for a **local** Supabase instance with Docker installed, run:

```powershell
npx supabase start
npx supabase db reset
npx supabase status
```

Local `db reset` applies the migrations and runs the configured seed. Copy `.env.example` to `.env`, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` using the URL and **service-role** key for the same project. Set `CRISISGRID_DEMO_AUTHORITY_TOKEN` to a private random value of at least 24 characters to enable manual overrides. Keep both values private and server-side; never add them to frontend code or commit them. The root `.gitignore` already excludes `.env`.

The server validates its environment on startup. If Supabase is not configured, the screens still load, but the live API returns an explicit `503`; no database-backed behavior is faked.

## Run locally

```powershell
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). It redirects to the existing Bengaluru command-center screen. On Windows, create the local environment file with `Copy-Item .env.example .env`, then edit the values before starting the server.

## Demo flow

1. Review active **INC-8092**, the seeded 3-alarm chemical and structural fire, on **Live Incidents & System Impact**.
2. Visit **City Command Center** to compare the 18/10/7/10 MW pre-incident allocation with the database-backed recommendation: Hospital Network 17 MW, Water Infrastructure 12 MW, Telecommunications 5 MW, and Emergency Operations 11 MW. The recommendation totals exactly 45 MW and respects all sector safety floors.
3. On **Citizen Emergency Home**, choose an emergency category, describe the incident, select its severity, and submit the report. The API validates the report, saves impact estimates, and creates a recommended plan in one database transaction.
4. Open **Authority Review**. Re-run the deterministic allocation model to recalculate and persist an explainable recommendation, adjust the available allocation sliders if desired, then approve, modify-and-approve, or reject the pending plan.
5. Approved changes become the active **simulation** plan. Rejected plans do not replace the active plan. Dashboard screens refresh from PostgreSQL automatically.

There is deliberately no sign-in, municipal integration, grid dispatch, autonomous approval, or production authentication in this hackathon demo. A real deployment must add authenticated and authorized authority identities before exposing review actions.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Report whether Supabase is reachable and configured. |
| `GET` | `/api/dashboard` | Read sector demand, incidents, active/recommended plans, and latest telemetry. |
| `GET` | `/api/sectors` | Read the four configured infrastructure sectors. |
| `GET` | `/api/incidents` | Read incidents and their rule-based sector impact estimates. |
| `GET` | `/api/incidents/:incidentId/analysis` | Read selected incident impacts and calculate its sector allocation recommendation. |
| `POST` | `/api/incidents` | Validate and transactionally submit an emergency report and recommendation. |
| `POST` | `/api/incidents/:incidentId/authority-review` | Persist an incident allocation plan, its items, and audit entry as `pending_review`. |
| `POST` | `/api/incidents/:incidentId/manual-override` | Validate and persist a one-sector override; requires `X-Crisisgrid-Authority-Token`. |
| `POST` | `/api/allocation/simulate` | Calculate the deterministic allocation and rationale without persisting a plan. |
| `POST` | `/api/reserve/transfer` | Request a simulated 1 MW reserve transfer, audit the result, and recalculate after an allowed transfer. |
| `PATCH` | `/api/incidents/:incidentId/status` | Mark an active incident contained or resolved and recalculate its recommendation. |
| `POST` | `/api/allocation-plans/recommend` | Recalculate and persist a pending recommendation. |
| `POST` | `/api/allocation-plans/:planId/review` | Approve, modify-and-approve, or reject a pending plan. |

Review request examples:

```json
{ "decision": "approve", "reviewer": "City Authority" }
```

```json
{
  "decision": "modify",
  "reviewer": "City Authority",
  "items": [
    { "sectorId": "hospital_network", "allocatedCapacityMw": 17 },
    { "sectorId": "water_infrastructure", "allocatedCapacityMw": 12 },
    { "sectorId": "telecommunications", "allocatedCapacityMw": 5 },
    { "sectorId": "emergency_operations", "allocatedCapacityMw": 11 }
  ]
}
```

## Checks

```powershell
npm test
npm run typecheck
npm run build
```
