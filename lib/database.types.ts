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
        Insert: {
          academic_year: string;
          ai_policy: string;
          approved_at?: string | null;
          assessment_type: string;
          content?: Json;
          created_at?: string;
          group_work_permitted?: boolean;
          id?: string;
          module_code: string;
          module_level?: number | null;
          owner_id: string;
          programme?: string | null;
          status?: string;
          submitted_at?: string | null;
          title: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          academic_year?: string;
          ai_policy?: string;
          approved_at?: string | null;
          assessment_type?: string;
          content?: Json;
          created_at?: string;
          group_work_permitted?: boolean;
          id?: string;
          module_code?: string;
          module_level?: number | null;
          owner_id?: string;
          programme?: string | null;
          status?: string;
          submitted_at?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      assessment_review_assignments: {
        Row: {
          assigned_at: string;
          assigned_by: string | null;
          assessment_id: string;
          category: string;
          comment: string | null;
          reviewed_at: string | null;
          reviewed_version: number | null;
          reviewer_id: string | null;
          state: string;
          updated_at: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by?: string | null;
          assessment_id: string;
          category: string;
          comment?: string | null;
          reviewed_at?: string | null;
          reviewed_version?: number | null;
          reviewer_id?: string | null;
          state?: string;
          updated_at?: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by?: string | null;
          assessment_id?: string;
          category?: string;
          comment?: string | null;
          reviewed_at?: string | null;
          reviewed_version?: number | null;
          reviewer_id?: string | null;
          state?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cluster_lead_scopes: {
        Row: {
          assigned_by: string;
          created_at: string;
          module_level: number;
          programme: string;
          user_id: string;
        };
        Insert: {
          assigned_by: string;
          created_at?: string;
          module_level: number;
          programme: string;
          user_id: string;
        };
        Update: {
          assigned_by?: string;
          created_at?: string;
          module_level?: number;
          programme?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      assessment_review_events: {
        Row: {
          action: string;
          actor_id: string | null;
          assessment_id: string;
          assessment_version: number;
          category: string | null;
          comment: string | null;
          created_at: string;
          id: number;
          reviewer_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          assessment_id: string;
          assessment_version: number;
          category?: string | null;
          comment?: string | null;
          created_at?: string;
          id?: number;
          reviewer_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          assessment_id?: string;
          assessment_version?: number;
          category?: string | null;
          comment?: string | null;
          created_at?: string;
          id?: number;
          reviewer_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      admin_users: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      reviewer_roles: {
        Row: {
          assigned_by: string;
          created_at: string;
          role: string;
          user_id: string;
        };
        Insert: {
          assigned_by: string;
          created_at?: string;
          role: string;
          user_id: string;
        };
        Update: {
          assigned_by?: string;
          created_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      admin_assessment_statistics: {
        Args: Record<PropertyKey, never>;
        Returns: {
          assessments_by_academic_year: Json;
          assessments_by_status: Json;
          assessments_by_type: Json;
          group_work_assessments: number;
          total_assessments: number;
          unique_owners: number;
        }[];
      };

      admin_demote_user: {
        Args: { target_user_id: string };
        Returns: undefined;
      };
      admin_list_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          display_name: string;
          is_admin: boolean;
          user_id: string;
        }[];
      };
      admin_promote_user: {
        Args: { target_user_id: string };
        Returns: undefined;
      };
      admin_cluster_lead_scopes: {
        Args: Record<PropertyKey, never>;
        Returns: {
          assigned_by: string;
          created_at: string;
          module_level: number;
          programme: string;
          user_id: string;
        }[];
      };
      admin_review_assignments: {
        Args: Record<PropertyKey, never>;
        Returns: {
          assessment_id: string;
          category: string;
          comment: string | null;
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
          ai_reviewer: boolean;
          cluster_lead: boolean;
          display_name: string;
          employability_reviewer: boolean;
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
        Returns: undefined;
      };
      admin_set_workflow_role: {
        Args: {
          enabled: boolean;
          target_role: string;
          target_user_id: string;
        };
        Returns: undefined;
      };
      assessment_can_export_final: {
        Args: { target_assessment_id: string };
        Returns: boolean;
      };
      assessment_review_status: {
        Args: { target_assessment_id: string };
        Returns: {
          category: string;
          comment: string | null;
          reviewed_at: string | null;
          reviewed_version: number | null;
          reviewer_id: string | null;
          reviewer_name: string | null;
          state: string;
        }[];
      };
      record_assessment_review: {
        Args: {
          decision: string;
          review_comment?: string | null;
          target_assessment_id: string;
          target_category: string;
        };
        Returns: undefined;
      };
      review_queue: {
        Args: Record<PropertyKey, never>;
        Returns: {
          assessment_id: string;
          assessment_version: number;
          can_review: boolean;
          category: string;
          comment: string | null;
          content: Json;
          module_code: string;
          owner_id: string;
          owner_name: string | null;
          reviewed_version: number | null;
          reviewer_id: string | null;
          state: string;
          status: string;
          submitted_at: string | null;
          title: string;
          updated_at: string;
        }[];
      };
      submit_assessment_for_review: {
        Args: { target_assessment_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Assessment = Database["public"]["Tables"]["assessments"]["Row"];
export type AssessmentInsert =
  Database["public"]["Tables"]["assessments"]["Insert"];
export type AssessmentUpdate =
  Database["public"]["Tables"]["assessments"]["Update"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type AdminUser = Database["public"]["Tables"]["admin_users"]["Row"];
