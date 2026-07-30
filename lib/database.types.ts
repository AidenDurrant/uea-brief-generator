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
          assessment_type: string;
          content: Json;
          created_at: string;
          group_work_permitted: boolean;
          id: string;
          module_code: string;
          owner_id: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          academic_year: string;
          ai_policy: string;
          assessment_type: string;
          content?: Json;
          created_at?: string;
          group_work_permitted?: boolean;
          id?: string;
          module_code: string;
          owner_id: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          academic_year?: string;
          ai_policy?: string;
          assessment_type?: string;
          content?: Json;
          created_at?: string;
          group_work_permitted?: boolean;
          id?: string;
          module_code?: string;
          owner_id?: string;
          status?: string;
          title?: string;
          updated_at?: string;
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
