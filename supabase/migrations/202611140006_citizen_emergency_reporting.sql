begin;

-- Ensure incidents table has prerequisite decision-support columns
alter table public.incidents
  add column if not exists is_escalated boolean not null default false,
  add column if not exists automated_triage boolean not null default true,
  add column if not exists dispatch_details text not null default 'No response units assigned.',
  add column if not exists evacuation_radius_m integer not null default 0
    check (evacuation_radius_m between 0 and 100000),
  add column if not exists residents_alerted integer not null default 0
    check (residents_alerted between 0 and 10000000),
  add column if not exists perimeter_details text not null default 'No evacuation perimeter issued.';

alter table public.emergency_reports
  add column if not exists confirmation_status text not null default 'report_received',
  add column if not exists location_source text not null default 'demo_fallback',
  add column if not exists input_mode text not null default 'text',
  add column if not exists evidence_paths jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_paths) = 'array'),
  add column if not exists location_accuracy_m numeric(8, 2),
  add column if not exists triage_summary text not null default '';

alter table public.emergency_reports
  drop constraint if exists emergency_reports_confirmation_status_check,
  drop constraint if exists emergency_reports_location_source_check,
  drop constraint if exists emergency_reports_input_mode_check,
  drop constraint if exists emergency_reports_status_check;

alter table public.emergency_reports
  add constraint emergency_reports_confirmation_status_check
    check (confirmation_status in (
      'report_received',
      'triaged',
      'dispatch_requested',
      'authority_review',
      'response_active'
    )),
  add constraint emergency_reports_location_source_check
    check (location_source in ('geolocation', 'manual_fallback', 'demo_fallback')),
  add constraint emergency_reports_input_mode_check
    check (input_mode in ('text', 'speech', 'text_and_speech')),
  add constraint emergency_reports_status_check
    check (status in (
      'received',
      'accepted',
      'triaged',
      'closed',
      'report_received',
      'dispatch_requested',
      'authority_review',
      'response_active'
    ));

create table if not exists public.emergency_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.emergency_reports(id) on delete cascade,
  status text not null check (status in (
    'report_received',
    'triaged',
    'dispatch_requested',
    'authority_review',
    'response_active'
  )),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists emergency_report_events_report_id_idx
  on public.emergency_report_events (report_id, created_at);

alter table public.emergency_report_events enable row level security;

create or replace function public.sync_emergency_report_details()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_incident public.incidents%rowtype;
begin
  select * into v_incident
    from public.incidents
    where id = new.incident_id;
  if found then
    if new.category is null or new.category = '' or new.category = 'other' then
      new.category := v_incident.incident_type;
    end if;
    if new.address = '' then
      new.address := coalesce(v_incident.address, new.location);
    end if;
    if new.latitude is null then
      new.latitude := v_incident.latitude;
    end if;
    if new.longitude is null then
      new.longitude := v_incident.longitude;
    end if;
  elsif new.address = '' then
    new.address := new.location;
  end if;
  if new.urgency is null or new.urgency = '' then
    new.urgency := new.severity;
  end if;
  if new.status = 'received' then
    new.status := 'report_received';
  end if;
  return new;
end;
$$;

create or replace function public.submit_emergency_report(
  p_incident jsonb,
  p_report jsonb,
  p_impacts jsonb,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_incident_id uuid;
  v_report_id uuid;
  v_plan_id uuid;
  v_impact jsonb;
  v_event jsonb;
  v_confirmation text;
  v_legacy_status text;
begin
  if jsonb_typeof(p_impacts) is distinct from 'array'
    or jsonb_array_length(p_impacts) <>
      (select count(*) from public.infrastructure_sectors) then
    raise exception 'Incident impacts must include every infrastructure sector.';
  end if;

  v_incident_id := coalesce(
    nullif(p_incident->>'id', '')::uuid,
    gen_random_uuid()
  );
  v_report_id := coalesce(
    nullif(p_report->>'id', '')::uuid,
    gen_random_uuid()
  );
  v_confirmation := coalesce(
    nullif(p_report->>'confirmation_status', ''),
    case
      when p_plan is not null and p_plan <> 'null'::jsonb then 'authority_review'
      else 'dispatch_requested'
    end
  );
  v_legacy_status := case
    when v_confirmation in ('authority_review', 'response_active', 'dispatch_requested')
      then 'accepted'
    when v_confirmation = 'triaged' then 'triaged'
    else 'received'
  end;

  insert into public.incidents (
    id, incident_code, title, description, incident_type, severity, status,
    location, address, latitude, longitude, response_units, is_escalated,
    automated_triage, dispatch_details, evacuation_radius_m, residents_alerted,
    perimeter_details
  ) values (
    v_incident_id,
    coalesce(nullif(p_incident->>'incident_code', ''), 'INC-' || upper(substr(replace(v_incident_id::text, '-', ''), 1, 4))),
    p_incident->>'title',
    p_incident->>'description',
    p_incident->>'incident_type',
    p_incident->>'severity',
    'active',
    p_incident->>'location',
    coalesce(nullif(p_incident->>'address', ''), p_incident->>'location'),
    nullif(p_incident->>'latitude', '')::double precision,
    nullif(p_incident->>'longitude', '')::double precision,
    coalesce(nullif(p_incident->>'response_units', '')::integer, 1),
    coalesce((p_incident->>'is_escalated')::boolean, false),
    coalesce((p_incident->>'automated_triage')::boolean, true),
    coalesce(
      nullif(p_incident->>'dispatch_details', ''),
      'Simulated in-app dispatch request only. Not connected to police, ambulance, fire, 112, or government dispatch.'
    ),
    coalesce(nullif(p_incident->>'evacuation_radius_m', '')::integer, 0),
    coalesce(nullif(p_incident->>'residents_alerted', '')::integer, 0),
    coalesce(nullif(p_incident->>'perimeter_details', ''), 'No evacuation perimeter issued.')
  );

  insert into public.emergency_reports (
    id, incident_id, reporter_alias, description, location, severity,
    is_anonymous, category, urgency, latitude, longitude, address,
    language, status, confirmation_status, location_source, input_mode,
    evidence_paths, triage_summary
  ) values (
    v_report_id,
    v_incident_id,
    coalesce(nullif(p_report->>'reporter_alias', ''), 'Anonymous'),
    p_report->>'description',
    p_report->>'location',
    p_report->>'severity',
    coalesce((p_report->>'is_anonymous')::boolean, true),
    coalesce(nullif(p_report->>'category', ''), p_incident->>'incident_type', 'other'),
    coalesce(nullif(p_report->>'urgency', ''), p_report->>'severity'),
    coalesce(
      nullif(p_report->>'latitude', '')::double precision,
      nullif(p_incident->>'latitude', '')::double precision
    ),
    coalesce(
      nullif(p_report->>'longitude', '')::double precision,
      nullif(p_incident->>'longitude', '')::double precision
    ),
    coalesce(nullif(p_report->>'address', ''), p_report->>'location'),
    coalesce(nullif(p_report->>'language', ''), 'en'),
    v_legacy_status,
    v_confirmation,
    coalesce(nullif(p_report->>'location_source', ''), 'demo_fallback'),
    coalesce(nullif(p_report->>'input_mode', ''), 'text'),
    coalesce(p_report->'evidence_paths', '[]'::jsonb),
    coalesce(nullif(p_report->>'triage_summary', ''), '')
  );

  for v_impact in select value from jsonb_array_elements(p_impacts)
  loop
    insert into public.incident_impacts (
      incident_id, sector_id, demand_delta_mw, impact_score, rationale
    ) values (
      v_incident_id,
      v_impact->>'sector_id',
      (v_impact->>'demand_delta_mw')::numeric,
      (v_impact->>'impact_score')::numeric,
      v_impact->>'rationale'
    );
  end loop;

  if p_plan is not null and p_plan <> 'null'::jsonb then
    v_plan_id := public.submit_allocation_plan_for_review(
      p_plan,
      'crisisgrid-simulation',
      null
    );
  end if;

  update public.command_center_state
    set updated_at = now(),
        dispatch_status = case
          when dispatch_status = 'standby' then 'standby'
          else dispatch_status
        end
    where id = 'bengaluru';

  if jsonb_typeof(p_report->'timeline') = 'array' then
    for v_event in select value from jsonb_array_elements(p_report->'timeline')
    loop
      insert into public.emergency_report_events (report_id, status, note)
      values (
        v_report_id,
        v_event->>'status',
        coalesce(v_event->>'note', '')
      );
    end loop;
  else
    insert into public.emergency_report_events (report_id, status, note)
    values
      (v_report_id, 'report_received', 'Citizen emergency report accepted by the CRISISGRID simulation.'),
      (v_report_id, 'triaged', 'Deterministic triage assigned severity and affected sectors.'),
      (
        v_report_id,
        'dispatch_requested',
        'Simulated in-app dispatch request only. Not connected to police, ambulance, fire, 112, or government dispatch.'
      );
    if v_plan_id is not null then
      insert into public.emergency_report_events (report_id, status, note)
      values (
        v_report_id,
        'authority_review',
        'A pending allocation recommendation was created for human authority review.'
      );
    end if;
  end if;

  insert into public.audit_logs (
    actor, action, entity_type, entity_id, details,
    event_type, description, metadata
  ) values (
    'citizen-report',
    'emergency_report.submitted',
    'incident',
    v_incident_id::text,
    jsonb_build_object(
      'report_id', v_report_id,
      'allocation_plan_id', v_plan_id,
      'confirmation_status', v_confirmation,
      'simulation_only', true
    ),
    'emergency_report.submitted',
    'A citizen emergency report created a live incident in the simulation Command Center.',
    jsonb_build_object(
      'report_id', v_report_id,
      'allocation_plan_id', v_plan_id,
      'simulation_only', true
    )
  );

  return jsonb_build_object(
    'incident_id', v_incident_id,
    'report_id', v_report_id,
    'allocation_plan_id', v_plan_id,
    'confirmation_status', v_confirmation
  );
end;
$$;

grant execute on function public.submit_emergency_report(jsonb, jsonb, jsonb, jsonb) to service_role;

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'emergency-evidence',
    'emergency-evidence',
    false,
    5242880,
    array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  )
  on conflict (id) do nothing;
exception
  when undefined_table then
    raise notice 'Supabase Storage is not available in this database.';
  when undefined_object then
    raise notice 'Supabase Storage schema is not available.';
  when others then
    raise notice 'Could not create emergency-evidence storage bucket: %', sqlerrm;
end $$;

commit;
