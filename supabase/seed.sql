begin;

insert into public.infrastructure_sectors (
  id, name, icon, baseline_demand_mw, current_allocation_mw,
  minimum_safe_capacity_mw, maximum_capacity_mw, priority_weight,
  operational_flexibility, life_critical, operational_status, metadata
) values
  (
    'hospital_network', 'Hospital Network', 'local_hospital',
    18, 18, 15.5, 22, 1.0, 0.15, true, 'operational',
    '{"critical_services":["trauma","ICU"],"operational_note":"ICU, trauma, and emergency surgical loads protected; non-critical HVAC is flexible.","city":"Bengaluru Metropolitan Region"}'
  ),
  (
    'water_infrastructure', 'Water Infrastructure', 'water_drop',
    10, 10, 8, 18, 0.9, 0.2, true, 'operational',
    '{"operational_note":"Hydrant pressure and emergency pumping demand elevated for the active fire response.","city":"Bengaluru Metropolitan Region"}'
  ),
  (
    'telecommunications', 'Telecommunications', 'cell_tower',
    7, 7, 4.5, 10, 0.6, 0.95, false, 'operational',
    '{"operational_note":"Non-essential civilian bandwidth can be throttled while preserving the 4.5 MW safety floor.","city":"Bengaluru Metropolitan Region"}'
  ),
  (
    'emergency_operations', 'Emergency Operations', 'emergency',
    10, 10, 8, 15, 1.0, 0.3, true, 'operational',
    '{"operational_note":"Fire engines, mobile command, and rescue operations are prioritized.","city":"Bengaluru Metropolitan Region"}'
  )
on conflict (id) do update set
  name = excluded.name,
  icon = excluded.icon,
  baseline_demand_mw = excluded.baseline_demand_mw,
  current_allocation_mw = excluded.current_allocation_mw,
  minimum_safe_capacity_mw = excluded.minimum_safe_capacity_mw,
  maximum_capacity_mw = excluded.maximum_capacity_mw,
  priority_weight = excluded.priority_weight,
  operational_flexibility = excluded.operational_flexibility,
  life_critical = excluded.life_critical,
  operational_status = excluded.operational_status,
  metadata = excluded.metadata,
  updated_at = now();

delete from public.incidents
  where id in (
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103'
  )
    or (incident_code = 'INC-8092'
      and id <> '00000000-0000-4000-8000-000000000101');

insert into public.incidents (
  id, incident_code, title, description, incident_type, severity, status,
  location, address, latitude, longitude, response_units, is_escalated,
  automated_triage, dispatch_details, evacuation_radius_m,
  residents_alerted, perimeter_details
) values (
  '00000000-0000-4000-8000-000000000101',
  'INC-8092',
  '3-Alarm Chemical & Structural Fire',
  'Critical fire and hazardous-material incident at the Indiranagar Industrial Complex. Emergency operations require additional capacity; hospital trauma and ICU services remain protected while non-critical load is reduced.',
  'fire_hazmat',
  'critical',
  'active',
  'Indiranagar Industrial Complex / Indiranagar 100ft Road / Sector 4',
  'Indiranagar Industrial Complex / Indiranagar 100ft Road / Sector 4',
  12.9719,
  77.6412,
  15,
  true,
  true,
  '8 Fire Engines · 3 HAZMAT · 4 ALS',
  450,
  1420,
  '450 m perimeter around Indiranagar Industrial Complex; residents alerted for hazardous-material response.'
)
on conflict (id) do update set
  incident_code = excluded.incident_code,
  title = excluded.title,
  description = excluded.description,
  incident_type = excluded.incident_type,
  severity = excluded.severity,
  status = excluded.status,
  location = excluded.location,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  response_units = excluded.response_units,
  is_escalated = excluded.is_escalated,
  automated_triage = excluded.automated_triage,
  dispatch_details = excluded.dispatch_details,
  evacuation_radius_m = excluded.evacuation_radius_m,
  residents_alerted = excluded.residents_alerted,
  perimeter_details = excluded.perimeter_details,
  updated_at = now();

insert into public.incident_impacts (
  incident_id, sector_id, demand_delta_mw, impact_score, rationale,
  impact_level, reason
) values
  (
    '00000000-0000-4000-8000-000000000101',
    'hospital_network', -1, 0.8, 'Temporarily reduce non-critical load while protecting trauma and ICU services.',
    'high', 'Reduce non-critical hospital load by 1 MW; trauma and ICU capacity remain protected.'
  ),
  (
    '00000000-0000-4000-8000-000000000101',
    'water_infrastructure', 2, 1.0, 'Fire suppression and hazardous-material response increase water demand by 2 MW.',
    'high', 'Increase water infrastructure capacity by 2 MW for fire suppression.'
  ),
  (
    '00000000-0000-4000-8000-000000000101',
    'telecommunications', -2, 0.8, 'Telecommunications can safely reduce allocation by 2 MW without crossing its 4.5 MW floor.',
    'high', 'Reduce telecommunications allocation by 2 MW; resulting 5 MW remains above its safety floor.'
  ),
  (
    '00000000-0000-4000-8000-000000000101',
    'emergency_operations', 1, 1.0, 'Emergency response operations require an additional 1 MW.',
    'high', 'Increase emergency operations capacity by 1 MW for incident response.'
  )
on conflict (incident_id, sector_id) do update set
  demand_delta_mw = excluded.demand_delta_mw,
  impact_score = excluded.impact_score,
  rationale = excluded.rationale,
  impact_level = excluded.impact_level,
  reason = excluded.reason;

delete from public.incident_impacts
  where incident_id = '00000000-0000-4000-8000-000000000101'
    and sector_id not in (
      'hospital_network',
      'water_infrastructure',
      'telecommunications',
      'emergency_operations'
    );

insert into public.emergency_reports (
  id, incident_id, reporter_alias, description, location, severity,
  is_anonymous, category, urgency, latitude, longitude, address,
  language, status
) values (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000101',
  'Scenario seed',
  '3-alarm chemical and structural fire; hazardous-material response requested.',
  'Indiranagar Industrial Complex / Indiranagar 100ft Road / Sector 4',
  'critical',
  true,
  'fire_hazmat',
  'critical',
  12.9719,
  77.6412,
  'Indiranagar Industrial Complex / Indiranagar 100ft Road / Sector 4',
  'en',
  'accepted'
)
on conflict (id) do update set
  incident_id = excluded.incident_id,
  description = excluded.description,
  location = excluded.location,
  severity = excluded.severity,
  category = excluded.category,
  urgency = excluded.urgency,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  address = excluded.address,
  language = excluded.language,
  status = excluded.status;

insert into public.allocation_plans (
  id, incident_id, title, status, total_capacity_mw,
  total_available_capacity_mw, rationale, created_by, approved_at, rejected_at
) values (
  '00000000-0000-4000-8000-000000000201',
  null,
  'Bengaluru pre-incident baseline allocation',
  'approved',
  45,
  45,
  '{"city":"Bengaluru Metropolitan Region","model_version":"crisisgrid-rules-v2","simulation_only":true}'::jsonb,
  'scenario-seed',
  now(),
  null
)
on conflict (id) do update set
  incident_id = excluded.incident_id,
  title = excluded.title,
  status = excluded.status,
  total_capacity_mw = excluded.total_capacity_mw,
  total_available_capacity_mw = excluded.total_available_capacity_mw,
  rationale = excluded.rationale,
  created_by = excluded.created_by,
  approved_at = excluded.approved_at,
  rejected_at = null,
  updated_at = now();

insert into public.allocation_plan_items (
  id, allocation_plan_id, sector_id, allocated_capacity_mw,
  previous_allocation_mw, recommended_allocation_mw, delta_mw,
  rationale, safety_status
) values
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000201', 'hospital_network', 18, 18, 18, 0, 'Pre-incident baseline allocation.', 'safe'),
  ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000201', 'water_infrastructure', 10, 10, 10, 0, 'Pre-incident baseline allocation.', 'safe'),
  ('00000000-0000-4000-8000-000000000213', '00000000-0000-4000-8000-000000000201', 'telecommunications', 7, 7, 7, 0, 'Pre-incident baseline allocation.', 'safe'),
  ('00000000-0000-4000-8000-000000000214', '00000000-0000-4000-8000-000000000201', 'emergency_operations', 10, 10, 10, 0, 'Pre-incident baseline allocation.', 'safe')
on conflict (allocation_plan_id, sector_id) do update set
  allocated_capacity_mw = excluded.allocated_capacity_mw,
  previous_allocation_mw = excluded.previous_allocation_mw,
  recommended_allocation_mw = excluded.recommended_allocation_mw,
  delta_mw = excluded.delta_mw,
  rationale = excluded.rationale,
  safety_status = excluded.safety_status;

insert into public.allocation_plans (
  id, incident_id, title, status, total_capacity_mw,
  total_available_capacity_mw, rationale, created_by
) values (
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000101',
  'INC-8092 — Fire and hazardous-material response recommendation',
  'recommended',
  45,
  45,
  '{"city":"Bengaluru Metropolitan Region","scenario":"INC-8092","model_version":"crisisgrid-rules-v2","simulation_only":true,"sector_demand_mw":{"hospital_network":17,"water_infrastructure":12,"telecommunications":5,"emergency_operations":11}}'::jsonb,
  'scenario-seed'
)
on conflict (id) do update set
  incident_id = excluded.incident_id,
  title = excluded.title,
  status = excluded.status,
  total_capacity_mw = excluded.total_capacity_mw,
  total_available_capacity_mw = excluded.total_available_capacity_mw,
  rationale = excluded.rationale,
  created_by = excluded.created_by,
  rejected_at = null,
  updated_at = now();

insert into public.allocation_plan_items (
  id, allocation_plan_id, sector_id, allocated_capacity_mw,
  previous_allocation_mw, recommended_allocation_mw, delta_mw,
  rationale, safety_status
) values
  ('00000000-0000-4000-8000-000000000221', '00000000-0000-4000-8000-000000000202', 'hospital_network', 17, 18, 17, -1, 'Reduce non-critical load by 1 MW; preserve trauma and ICU services.', 'safe'),
  ('00000000-0000-4000-8000-000000000222', '00000000-0000-4000-8000-000000000202', 'water_infrastructure', 12, 10, 12, 2, 'Add 2 MW to support fire suppression and hazardous-material response.', 'safe'),
  ('00000000-0000-4000-8000-000000000223', '00000000-0000-4000-8000-000000000202', 'telecommunications', 5, 7, 5, -2, 'Reduce by 2 MW while remaining above the 4.5 MW safe floor.', 'safe'),
  ('00000000-0000-4000-8000-000000000224', '00000000-0000-4000-8000-000000000202', 'emergency_operations', 11, 10, 11, 1, 'Add 1 MW for emergency field response and coordination.', 'safe')
on conflict (allocation_plan_id, sector_id) do update set
  allocated_capacity_mw = excluded.allocated_capacity_mw,
  previous_allocation_mw = excluded.previous_allocation_mw,
  recommended_allocation_mw = excluded.recommended_allocation_mw,
  delta_mw = excluded.delta_mw,
  rationale = excluded.rationale,
  safety_status = excluded.safety_status;

insert into public.audit_logs (
  id, actor, action, entity_type, entity_id, details,
  event_type, description, metadata
) values (
  '00000000-0000-4000-8000-000000000401',
  'scenario-seed',
  'allocation_plan.recommended',
  'allocation_plan',
  '00000000-0000-4000-8000-000000000202',
  '{"incident_code":"INC-8092","total_capacity_mw":45}'::jsonb,
  'allocation_plan.recommended',
  'Seeded the 45 MW authority-review recommendation for INC-8092.',
  '{"incident_code":"INC-8092","simulation_only":true}'::jsonb
)
on conflict (id) do update set
  actor = excluded.actor,
  action = excluded.action,
  details = excluded.details,
  event_type = excluded.event_type,
  description = excluded.description,
  metadata = excluded.metadata;

insert into public.telemetry_snapshots (
  id, available_capacity_mw, allocated_capacity_mw, sector_demand_mw,
  captured_at
) values (
  '00000000-0000-4000-8000-000000000501',
  45,
  45,
  '{"hospital_network":17,"water_infrastructure":12,"telecommunications":5,"emergency_operations":11}'::jsonb,
  now()
)
on conflict (id) do update set
  available_capacity_mw = excluded.available_capacity_mw,
  allocated_capacity_mw = excluded.allocated_capacity_mw,
  sector_demand_mw = excluded.sector_demand_mw,
  captured_at = excluded.captured_at;

insert into public.command_center_state (
  id, emergency_capacity_mw, emergency_capacity_limit_mw,
  city_grid_capacity_mw, city_grid_base_load_mw,
  telemetry_nodes_active, telemetry_online_percentage,
  grid_stability_index, ambient_temperature_c
) values (
  'bengaluru', 45, 45, 360, 267, 1420, 99.2, 94.8, 31.2
)
on conflict (id) do update set
  emergency_capacity_mw = excluded.emergency_capacity_mw,
  emergency_capacity_limit_mw = excluded.emergency_capacity_limit_mw,
  city_grid_capacity_mw = excluded.city_grid_capacity_mw,
  city_grid_base_load_mw = excluded.city_grid_base_load_mw,
  telemetry_nodes_active = excluded.telemetry_nodes_active,
  telemetry_online_percentage = excluded.telemetry_online_percentage,
  grid_stability_index = excluded.grid_stability_index,
  ambient_temperature_c = excluded.ambient_temperature_c,
  updated_at = now();

insert into public.telemetry_snapshots (
  id, sector_id, load_mw, capacity_mw, utilization_percentage, status,
  available_capacity_mw, allocated_capacity_mw, sector_demand_mw,
  captured_at
) values
  ('00000000-0000-4000-8000-000000000511', 'hospital_network', 17, 22, 77.27, 'operational', 45, 45, '{"hospital_network":17}'::jsonb, now() + interval '1 millisecond'),
  ('00000000-0000-4000-8000-000000000512', 'water_infrastructure', 12, 18, 66.67, 'elevated', 45, 45, '{"water_infrastructure":12}'::jsonb, now() + interval '2 milliseconds'),
  ('00000000-0000-4000-8000-000000000513', 'telecommunications', 5, 10, 50.00, 'operational', 45, 45, '{"telecommunications":5}'::jsonb, now() + interval '3 milliseconds'),
  ('00000000-0000-4000-8000-000000000514', 'emergency_operations', 11, 15, 73.33, 'surge', 45, 45, '{"emergency_operations":11}'::jsonb, now() + interval '4 milliseconds')
on conflict (id) do update set
  sector_id = excluded.sector_id,
  load_mw = excluded.load_mw,
  capacity_mw = excluded.capacity_mw,
  utilization_percentage = excluded.utilization_percentage,
  status = excluded.status,
  available_capacity_mw = excluded.available_capacity_mw,
  allocated_capacity_mw = excluded.allocated_capacity_mw,
  sector_demand_mw = excluded.sector_demand_mw,
  captured_at = excluded.captured_at;

commit;
