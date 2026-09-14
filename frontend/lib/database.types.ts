/**
 * The shapes returned by the Django brief-generator API (/api/v1/briefs/).
 *
 * This began life as Supabase's generated types and is now hand-maintained
 * against briefs/services.py. The `Tables` entries no longer describe tables the
 * client can query directly -- they describe the row shapes the endpoints return.
 *
 * Identifiers that name a person are stringified `web.Supervisor` primary keys.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      assessments: {
        Row: {
          academic_year: string;
          ai_policy: string;
          approved_at: string | null;
          assessment_type: string;
          checker_id: string | null;
          content: Json;
          created_at: string;
          group_work_permitted: boolean;
          id: string;
          module_code: string;
          module_level: number | null;
          owner_id: string;
          programme: string | null;
          status: string;
          submitted_at: string | null;
          title: string;
          updated_at: string;
          version: number;
        };
        // The fields a save may set. `version`, `status`, `submitted_at` and
        // `approved_at` are owned by the workflow services and are deliberately
        // absent -- the server ignores them if sent.
        Insert: {
          academic_year: string;
          ai_policy: string;
          assessment_type: string;
          checker_id?: string | null;
          content?: Json;
          group_work_permitted?: boolean;
          module_code: string;
          module_level?: number | null;
          programme?: string | null;
          title: string;
        };
        Relationships: [];
      };
      assessment_review_assignments: {
        Row: {
          assigned_at: string;
          assigned_by: string | null;
          assessment_id: string;
          stage: string;
          comment: string | null;
          reviewed_at: string | null;
          reviewed_version: number | null;
          overridden_by: string | null;
          reviewer_id: string | null;
          state: string;
          updated_at: string;
        };
        Relationships: [];
      };
      assessment_review_events: {
        Row: {
          action: string;
          actor_id: string | null;
          assessment_id: string;
          assessment_version: number;
          stage: string | null;
          comment: string | null;
          created_at: string;
          id: number;
          reviewer_id: string | null;
        };
        Relationships: [];
      };
      cluster_lead_scopes: {
        Row: {
          assigned_by: string | null;
          created_at: string;
          display_name: string;
          module_level: number;
          programme: string;
          user_id: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      admin_demote_user: {
        Args: { target_user_id: string };
        Returns: null;
      };
      admin_list_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          display_name: string;
          is_admin: boolean;
          user_id: string;
        }[];
      };
      admin_override_assessment_approval: {
        Args: { override_reason: string; target_assessment_id: string };
        Returns: null;
      };
      admin_promote_user: {
        Args: { target_user_id: string };
        Returns: null;
      };
      admin_cluster_lead_scopes: {
        Args: Record<PropertyKey, never>;
        Returns: {
          assigned_by: string | null;
          created_at: string;
          display_name: string;
          module_level: number;
          programme: string;
          user_id: string;
        }[];
      };
      admin_review_assignments: {
        Args: Record<PropertyKey, never>;
        Returns: {
          assessment_id: string;
          stage: string;
          comment: string | null;
          overridden_by: string | null;
          overridden_by_name: string | null;
          reviewed_at: string | null;
          reviewed_version: number | null;
          reviewer_id: string | null;
          reviewer_name: string | null;
          state: string;
        }[];
      };
      admin_review_workflow_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          cluster_lead: boolean;
          display_name: string;
          teaching_director: boolean;
          user_id: string;
        }[];
      };
      admin_set_cluster_lead_scope: {
        Args: {
          enabled: boolean;
          target_module_level: number;
          target_programme: string;
          target_user_id: string;
        };
        Returns: null;
      };
      admin_set_workflow_role: {
        Args: {
          enabled: boolean;
          target_role: string;
          target_user_id: string;
        };
        Returns: null;
      };
      assessment_can_export_final: {
        Args: { target_assessment_id: string };
        Returns: boolean;
      };
      assessment_review_status: {
        Args: { target_assessment_id: string };
        Returns: {
          awaiting_previous_stage: boolean;
          comment: string | null;
          overridden_by: string | null;
          overridden_by_name: string | null;
          reviewed_at: string | null;
          reviewed_version: number | null;
          reviewer_id: string | null;
          reviewer_name: string | null;
          stage: string;
          state: string;
        }[];
      };
      record_assessment_review: {
        Args: {
          decision: string;
          review_comment?: string | null;
          target_assessment_id: string;
          target_stage: string;
        };
        Returns: null;
      };
      review_queue: {
        Args: Record<PropertyKey, never>;
        Returns: {
          assessment_id: string;
          assessment_version: number;
          awaiting_previous_stage: boolean;
          can_review: boolean;
          checker_id: string | null;
          checker_name: string | null;
          comment: string | null;
          content: Json;
          module_code: string;
          owner_id: string;
          owner_name: string | null;
          reviewed_version: number | null;
          reviewer_id: string | null;
          stage: string;
          state: string;
          status: string;
          submitted_at: string | null;
          title: string;
          updated_at: string;
        }[];
      };
      submit_assessment_for_review: {
        Args: { target_assessment_id: string };
        Returns: null;
      };

      // Endpoints that replaced the direct table queries.
      all_assessments: {
        Args: Record<PropertyKey, never>;
        Returns: Database['public']['Tables']['assessments']['Row'][];
      };
      checker_candidates: {
        Args: Record<PropertyKey, never>;
        Returns: { display_name: string; user_id: string }[];
      };
      delete_assessment: {
        Args: { id: string };
        Returns: null;
      };
      my_assessments: {
        Args: Record<PropertyKey, never>;
        Returns: Database['public']['Tables']['assessments']['Row'][];
      };
      my_review_assignments: {
        Args: Record<PropertyKey, never>;
        Returns: Database['public']['Tables']['assessment_review_assignments']['Row'][];
      };
      my_roles: {
        Args: Record<PropertyKey, never>;
        Returns: {
          has_oversight: boolean;
          is_admin: boolean;
          roles: { role: string }[];
        };
      };
      review_events: {
        Args: Record<PropertyKey, never>;
        Returns: Database['public']['Tables']['assessment_review_events']['Row'][];
      };
      save_assessment: {
        Args: {
          id: string | null;
          record: Database['public']['Tables']['assessments']['Insert'];
        };
        Returns: Database['public']['Tables']['assessments']['Row'];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Assessment = Database['public']['Tables']['assessments']['Row'];
export type AssessmentInsert =
  Database['public']['Tables']['assessments']['Insert'];
export type CheckerCandidate =
  Database['public']['Functions']['checker_candidates']['Returns'][number];
export type BriefRoles =
  Database['public']['Functions']['my_roles']['Returns'];
export type ClusterLeadScope =
  Database['public']['Functions']['admin_cluster_lead_scopes']['Returns'][number];
