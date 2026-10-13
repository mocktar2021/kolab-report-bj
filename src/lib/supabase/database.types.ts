export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      deliverables: {
        Row: {
          created_at: string;
          file_name: string;
          id: string;
          mime_type: string;
          parse_error: string | null;
          parse_status: Database["public"]["Enums"]["parse_status"];
          parsed_at: string | null;
          parsed_content: string | null;
          section_id: string;
          size_bytes: number;
          storage_path: string;
          updated_at: string;
          uploaded_by: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          file_name: string;
          id?: string;
          mime_type: string;
          parse_error?: string | null;
          parse_status?: Database["public"]["Enums"]["parse_status"];
          parsed_at?: string | null;
          parsed_content?: string | null;
          section_id: string;
          size_bytes: number;
          storage_path: string;
          updated_at?: string;
          uploaded_by?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          id?: string;
          mime_type?: string;
          parse_error?: string | null;
          parse_status?: Database["public"]["Enums"]["parse_status"];
          parsed_at?: string | null;
          parsed_content?: string | null;
          section_id?: string;
          size_bytes?: number;
          storage_path?: string;
          updated_at?: string;
          uploaded_by?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deliverables_section_id_workspace_id_fkey";
            columns: ["section_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "report_sections";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "deliverables_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
          slug: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_id: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_id?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          job_title: string | null;
          locale: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          job_title?: string | null;
          locale?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          job_title?: string | null;
          locale?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      prompt_library: {
        Row: {
          category: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_active: boolean;
          template: string;
          title: string;
          updated_at: string;
          variables: NonNullable<Json>;
          version: number;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          category?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          template: string;
          title: string;
          updated_at?: string;
          variables?: NonNullable<Json>;
          version?: number;
          workspace_id?: string | null;
        };
        Update: {
          category?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          template?: string;
          title?: string;
          updated_at?: string;
          variables?: NonNullable<Json>;
          version?: number;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "prompt_library_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_library_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      report_sections: {
        Row: {
          ai_draft: Json | null;
          ai_generated_at: string | null;
          assigned_to: string | null;
          completed_at: string | null;
          content: string | null;
          created_at: string;
          id: string;
          instructions: string | null;
          parent_id: string | null;
          position: number;
          report_id: string;
          status: Database["public"]["Enums"]["section_status"];
          title: string;
          updated_at: string;
          weight: number;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          ai_draft?: Json | null;
          ai_generated_at?: string | null;
          assigned_to?: string | null;
          completed_at?: string | null;
          content?: string | null;
          created_at?: string;
          id?: string;
          instructions?: string | null;
          parent_id?: string | null;
          position?: number;
          report_id: string;
          status?: Database["public"]["Enums"]["section_status"];
          title: string;
          updated_at?: string;
          weight?: number;
          workspace_id: string;
        };
        Update: {
          ai_draft?: Json | null;
          ai_generated_at?: string | null;
          assigned_to?: string | null;
          completed_at?: string | null;
          content?: string | null;
          created_at?: string;
          id?: string;
          instructions?: string | null;
          parent_id?: string | null;
          position?: number;
          report_id?: string;
          status?: Database["public"]["Enums"]["section_status"];
          title?: string;
          updated_at?: string;
          weight?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_sections_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_sections_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "report_sections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_sections_report_id_workspace_id_fkey";
            columns: ["report_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "report_progress";
            referencedColumns: ["report_id", "workspace_id"];
          },
          {
            foreignKeyName: "report_sections_report_id_workspace_id_fkey";
            columns: ["report_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      reports: {
        Row: {
          created_at: string;
          created_by: string;
          description: string | null;
          due_date: string | null;
          id: string;
          status: Database["public"]["Enums"]["report_status"];
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          status?: Database["public"]["Enums"]["report_status"];
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          status?: Database["public"]["Enums"]["report_status"];
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          name: string;
          organization_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspaces_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      report_progress: {
        Row: {
          completed_sections: number | null;
          completion_percent: number | null;
          in_progress_sections: number | null;
          last_activity_at: string | null;
          not_started_sections: number | null;
          report_id: string | null;
          total_sections: number | null;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "reports_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      create_workspace_with_owner: {
        Args: { organization_name: string; report_title: string; workspace_name: string };
        Returns: {
          organization_id: string;
          report_id: string;
          workspace_id: string;
        }[];
      };
    };
    Enums: {
      parse_status: "pending" | "processing" | "parsed" | "failed";
      report_status: "draft" | "in_review" | "final";
      section_status: "not_started" | "in_progress" | "completed";
      workspace_role: "owner" | "admin" | "expert" | "viewer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      parse_status: ["pending", "processing", "parsed", "failed"],
      report_status: ["draft", "in_review", "final"],
      section_status: ["not_started", "in_progress", "completed"],
      workspace_role: ["owner", "admin", "expert", "viewer"],
    },
  },
} as const;
