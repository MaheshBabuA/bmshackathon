export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type SectorRow = {
  id: string;
  name: string;
  icon: string;
  baseline_demand_mw: number;
  current_allocation_mw: number;
  minimum_safe_capacity_mw: number;
  maximum_capacity_mw: number;
  priority_weight: number;
  operational_flexibility: number;
  life_critical: boolean;
  operational_status: string;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type IncidentRow = {
  id: string;
  incident_code: string;
  title: string;
  description: string;
  incident_type: string;
  severity: string;
  status: string;
  location: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  response_units: number;
  is_escalated: boolean;
  automated_triage: boolean;
  dispatch_details: string;
  evacuation_radius_m: number;
  residents_alerted: number;
  perimeter_details: string;
  created_at: string;
  updated_at: string;
};

export type IncidentImpactRow = {
  id: string;
  incident_id: string;
  sector_id: string;
  demand_delta_mw: number;
  impact_score: number;
  rationale: string;
  impact_level: string;
  reason: string;
  created_at: string;
};

export type AllocationPlanRow = {
  id: string;
  incident_id: string | null;
  title: string;
  status: string;
  total_capacity_mw: number;
  total_available_capacity_mw: number;
  rationale: Json;
  approved_at: string | null;
  rejected_at: string | null;
  created_by: string;
  dispatch_status?: string;
  signatures?: Json;
  required_signatures?: number;
  created_at: string;
  updated_at: string;
};

export type AllocationPlanItemRow = {
  id: string;
  allocation_plan_id: string;
  sector_id: string;
  allocated_capacity_mw: number;
  previous_allocation_mw: number;
  recommended_allocation_mw: number;
  delta_mw: number;
  rationale: string;
  safety_status: string;
  created_at: string;
};

export type EmergencyReportRow = {
  id: string;
  incident_id: string;
  reporter_alias: string;
  description: string;
  location: string;
  severity: string;
  is_anonymous: boolean;
  category: string;
  urgency: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  language: string;
  status: string;
  confirmation_status: string;
  location_source: string;
  input_mode: string;
  evidence_paths: Json;
  location_accuracy_m: number | null;
  triage_summary: string;
  created_at: string;
};

export type EmergencyReportEventRow = {
  id: string;
  report_id: string;
  status: string;
  note: string;
  created_at: string;
};

export type AuthorityReviewRow = {
  id: string;
  allocation_plan_id: string;
  decision: string;
  reviewer: string;
  notes: string;
  authority_name: string;
  authority_role: string;
  user_role?: string;
  signature_hash?: string | null;
  comments: string;
  decided_at: string;
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Json;
  event_type: string;
  description: string;
  metadata: Json;
  created_at: string;
};

export type TelemetrySnapshotRow = {
  id: string;
  available_capacity_mw: number;
  allocated_capacity_mw: number;
  sector_demand_mw: Json;
  sector_id: string | null;
  load_mw: number | null;
  capacity_mw: number | null;
  utilization_percentage: number | null;
  status: string | null;
  captured_at: string;
};

export type CommandCenterStateRow = {
  id: string;
  emergency_capacity_mw: number;
  emergency_capacity_limit_mw: number;
  city_grid_capacity_mw: number;
  city_grid_base_load_mw: number;
  telemetry_nodes_active: number;
  telemetry_online_percentage: number;
  grid_stability_index: number;
  ambient_temperature_c: number;
  dispatch_status?: string;
  last_dispatched_at?: string | null;
  updated_at: string;
};

export interface Database {
  public: {
    Tables: {
      infrastructure_sectors: Table<SectorRow>;
      incidents: Table<IncidentRow>;
      incident_impacts: Table<IncidentImpactRow>;
      allocation_plans: Table<AllocationPlanRow>;
      allocation_plan_items: Table<AllocationPlanItemRow>;
      emergency_reports: Table<EmergencyReportRow>;
      emergency_report_events: Table<EmergencyReportEventRow>;
      authority_reviews: Table<AuthorityReviewRow>;
      audit_logs: Table<AuditLogRow>;
      telemetry_snapshots: Table<TelemetrySnapshotRow>;
      command_center_state: Table<CommandCenterStateRow>;
    };
    Views: Record<string, never>;
    Functions: {
      submit_emergency_report: {
        Args: {
          p_incident: Json;
          p_report: Json;
          p_impacts: Json;
          p_plan: Json;
        };
        Returns: Json;
      };
      create_allocation_plan: {
        Args: { p_plan: Json; p_actor: string };
        Returns: string;
      };
      review_allocation_plan: {
        Args: {
          p_plan_id: string;
          p_decision: string;
          p_reviewer: string;
          p_notes: string;
          p_items: Json;
        };
        Returns: string;
      };
      update_incident_status: {
        Args: {
          p_incident_id: string;
          p_status: string;
          p_plan: Json;
        };
        Returns: Json;
      };
      transfer_emergency_reserve: {
        Args: { p_amount_mw: number };
        Returns: Json;
      };
      submit_allocation_plan_for_review: {
        Args: {
          p_plan: Json;
          p_actor: string;
          p_manual_override?: Json;
        };
        Returns: string;
      };
      review_allocation_plan_from_queue: {
        Args: {
          p_plan_id: string;
          p_decision: string;
          p_reviewer: string;
          p_notes: string;
          p_items: Json;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
