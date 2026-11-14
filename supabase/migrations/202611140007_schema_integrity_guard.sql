begin;

-- Schema Integrity Guard: Ensures all tables and columns from all migrations exist idempotently

-- 1. Ensure incidents table has all columns
alter table public.incidents
  add column if not exists incident_code text,
  add column if not exists address text,
  add column if not exists response_units integer not null default 0,
  add column if not exists is_escalated boolean not null default false,
  add column if not exists automated_triage boolean not null default true,
  add column if not exists dispatch_details text not null default 'No response units assigned.',
  add column if not exists evacuation_radius_m integer not null default 0,
  add column if not exists residents_alerted integer not null default 0,
  add column if not exists perimeter_details text not null default 'No evacuation perimeter issued.';

alter table public.incidents
  drop constraint if exists incidents_incident_type_check;

alter table public.incidents
  add constraint incidents_incident_type_check check (
    incident_type in (
      'medical',
      'fire',
      'fire_hazmat',
      'flood',
      'infrastructure',
      'telecommunications',
      'other'
    )
  );

create unique index if not exists incidents_incident_code_uidx
  on public.incidents (incident_code);

-- 2. Ensure incident_impacts has all columns
alter table public.incident_impacts
  add column if not exists impact_level text not null default 'moderate',
  add column if not exists reason text not null default '';

-- 3. Ensure allocation_plans has all columns
alter table public.allocation_plans
  add column if not exists incident_id uuid references public.incidents(id) on delete set null,
  add column if not exists total_available_capacity_mw numeric(8, 3) not null default 45,
  add column if not exists created_by text not null default 'system',
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists dispatch_status text not null default 'pending',
  add column if not exists signatures jsonb not null default '[]'::jsonb,
  add column if not exists required_signatures integer not null default 2;

alter table public.allocation_plans
  drop constraint if exists allocation_plans_status_check;

alter table public.allocation_plans
  add constraint allocation_plans_status_check check (
    status in ('recommended', 'pending_review', 'approved', 'rejected', 'superseded')
  );

-- 4. Ensure allocation_plan_items has all columns
alter table public.allocation_plan_items
  add column if not exists previous_allocation_mw numeric(8, 3) not null default 0,
  add column if not exists recommended_allocation_mw numeric(8, 3) not null default 0,
  add column if not exists delta_mw numeric(8, 3) not null default 0,
  add column if not exists safety_status text not null default 'safe';

-- 5. Ensure emergency_reports has all columns
alter table public.emergency_reports
  add column if not exists category text,
  add column if not exists urgency text,
  add column if not exists address text,
  add column if not exists confirmation_status text not null default 'report_received',
  add column if not exists location_source text not null default 'demo_fallback',
  add column if not exists input_mode text not null default 'text',
  add column if not exists evidence_paths jsonb not null default '[]'::jsonb,
  add column if not exists location_accuracy_m numeric(8, 2),
  add column if not exists triage_summary text not null default '';

-- 6. Ensure command_center_state exists with all columns
create table if not exists public.command_center_state (
  id text primary key check (id = 'bengaluru'),
  active_incident_id uuid references public.incidents(id) on delete set null,
  active_plan_id uuid references public.allocation_plans(id) on delete set null,
  grid_status text not null default 'normal'
    check (grid_status in ('normal', 'stabilizing', 'critical_shortage', 'containment_priority')),
  emergency_capacity_mw numeric(8, 3) not null default 45,
  emergency_capacity_limit_mw numeric(8, 3) not null default 45,
  city_grid_capacity_mw numeric(8, 3) not null default 360,
  city_grid_base_load_mw numeric(8, 3) not null default 267,
  telemetry_nodes_active integer not null default 1420,
  telemetry_online_percentage numeric(5, 2) not null default 99.2,
  grid_stability_index numeric(5, 2) not null default 94.8,
  ambient_temperature_c numeric(4, 1) not null default 31.2,
  dispatch_status text not null default 'standby'
    check (dispatch_status in ('standby', 'active', 'contained')),
  last_dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.command_center_state enable row level security;

-- 7. Ensure telemetry_snapshots has all columns
alter table public.telemetry_snapshots
  add column if not exists sector_id text references public.infrastructure_sectors(id),
  add column if not exists load_mw numeric(8, 3),
  add column if not exists capacity_mw numeric(8, 3),
  add column if not exists utilization_percentage numeric(5, 2),
  add column if not exists status text;

-- 8. Ensure authority_reviews has all columns
alter table public.authority_reviews
  add column if not exists signature_hash text,
  add column if not exists user_role text not null default 'AUTHORITY';

commit;
