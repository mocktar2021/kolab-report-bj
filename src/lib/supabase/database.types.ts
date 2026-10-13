export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      ai_generations: {
        Row: {
          accepted: boolean | null;
          completed_at: string | null;
          context_meta: NonNullable<Json>;
          cost_estimate: number | null;
          created_at: string;
          decided_at: string | null;
          draft_words: number | null;
          edit_distance: number | null;
          error_code: string | null;
          estimated_tokens: number;
          feedback_comment: string | null;
          id: string;
          input_hash: string | null;
          input_hashes: NonNullable<Json>;
          input_tokens: number | null;
          latency_ms: number | null;
          model: string;
          output: Json | null;
          output_schema: string;
          output_tokens: number | null;
          params: NonNullable<Json>;
          prompt_version_id: string | null;
          provider: string;
          raw_output: string | null;
          repaired: boolean;
          requested_by: string | null;
          schema_version: number;
          section_id: string;
          status: Database["public"]["Enums"]["ai_generation_status"];
          total_tokens: number | null;
          truncated: boolean;
          updated_at: string;
          user_rating: number | null;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          accepted?: boolean | null;
          completed_at?: string | null;
          context_meta?: NonNullable<Json>;
          cost_estimate?: number | null;
          created_at?: string;
          decided_at?: string | null;
          draft_words?: number | null;
          edit_distance?: number | null;
          error_code?: string | null;
          estimated_tokens: number;
          feedback_comment?: string | null;
          id?: string;
          input_hash?: string | null;
          input_hashes?: NonNullable<Json>;
          input_tokens?: number | null;
          latency_ms?: number | null;
          model: string;
          output?: Json | null;
          output_schema: string;
          output_tokens?: number | null;
          params?: NonNullable<Json>;
          prompt_version_id?: string | null;
          provider: string;
          raw_output?: string | null;
          repaired?: boolean;
          requested_by?: string | null;
          schema_version: number;
          section_id: string;
          status?: Database["public"]["Enums"]["ai_generation_status"];
          total_tokens?: never;
          truncated?: boolean;
          updated_at?: string;
          user_rating?: number | null;
          workspace_id: string;
        };
        Update: {
          accepted?: boolean | null;
          completed_at?: string | null;
          context_meta?: NonNullable<Json>;
          cost_estimate?: number | null;
          created_at?: string;
          decided_at?: string | null;
          draft_words?: number | null;
          edit_distance?: number | null;
          error_code?: string | null;
          estimated_tokens?: number;
          feedback_comment?: string | null;
          id?: string;
          input_hash?: string | null;
          input_hashes?: NonNullable<Json>;
          input_tokens?: number | null;
          latency_ms?: number | null;
          model?: string;
          output?: Json | null;
          output_schema?: string;
          output_tokens?: number | null;
          params?: NonNullable<Json>;
          prompt_version_id?: string | null;
          provider?: string;
          raw_output?: string | null;
          repaired?: boolean;
          requested_by?: string | null;
          schema_version?: number;
          section_id?: string;
          status?: Database["public"]["Enums"]["ai_generation_status"];
          total_tokens?: never;
          truncated?: boolean;
          updated_at?: string;
          user_rating?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_generations_prompt_version_id_fkey";
            columns: ["prompt_version_id"];
            isOneToOne: false;
            referencedRelation: "prompt_library";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_generations_prompt_version_id_fkey";
            columns: ["prompt_version_id"];
            isOneToOne: false;
            referencedRelation: "prompt_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_generations_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_generations_section_id_workspace_id_fkey";
            columns: ["section_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "report_sections";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      deliverables: {
        Row: {
          created_at: string;
          file_name: string;
          id: string;
          mime_type: string;
          parse_error: string | null;
          parse_meta: Json | null;
          parse_status: Database["public"]["Enums"]["parse_status"];
          parsed_at: string | null;
          parsed_content: string | null;
          section_id: string;
          size_bytes: number;
          storage_path: string;
          updated_at: string;
          uploaded_at: string | null;
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
          parse_meta?: Json | null;
          parse_status?: Database["public"]["Enums"]["parse_status"];
          parsed_at?: string | null;
          parsed_content?: string | null;
          section_id: string;
          size_bytes: number;
          storage_path: string;
          updated_at?: string;
          uploaded_at?: string | null;
          uploaded_by?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          id?: string;
          mime_type?: string;
          parse_error?: string | null;
          parse_meta?: Json | null;
          parse_status?: Database["public"]["Enums"]["parse_status"];
          parsed_at?: string | null;
          parsed_content?: string | null;
          section_id?: string;
          size_bytes?: number;
          storage_path?: string;
          updated_at?: string;
          uploaded_at?: string | null;
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
          changelog: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          max_output_tokens: number | null;
          model_tier: string;
          output_schema: string;
          status: Database["public"]["Enums"]["prompt_status"];
          temperature: number | null;
          template: string;
          template_key: string;
          title: string;
          updated_at: string;
          variables: NonNullable<Json>;
          version: number;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          changelog?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          max_output_tokens?: number | null;
          model_tier?: string;
          output_schema?: string;
          status?: Database["public"]["Enums"]["prompt_status"];
          temperature?: number | null;
          template: string;
          template_key: string;
          title: string;
          updated_at?: string;
          variables?: NonNullable<Json>;
          version: number;
          workspace_id?: string | null;
        };
        Update: {
          changelog?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          max_output_tokens?: number | null;
          model_tier?: string;
          output_schema?: string;
          status?: Database["public"]["Enums"]["prompt_status"];
          temperature?: number | null;
          template?: string;
          template_key?: string;
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
      workspace_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          revoked_at: string | null;
          role: Database["public"]["Enums"]["workspace_role"];
          token_hash: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          revoked_at?: string | null;
          role?: Database["public"]["Enums"]["workspace_role"];
          token_hash: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          revoked_at?: string | null;
          role?: Database["public"]["Enums"]["workspace_role"];
          token_hash?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_accepted_by_fkey";
            columns: ["accepted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey";
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
      ai_generation_metrics: {
        Row: {
          accepted: number | null;
          discarded: number | null;
          failed: number | null;
          generations: number | null;
          mean_edit_ratio: number | null;
          mean_latency_ms: number | null;
          model: string | null;
          prompt_version_id: string | null;
          repaired: number | null;
          succeeded: number | null;
          thumbs_down: number | null;
          thumbs_up: number | null;
          total_cost: number | null;
          total_tokens: number | null;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "ai_generations_prompt_version_id_fkey";
            columns: ["prompt_version_id"];
            isOneToOne: false;
            referencedRelation: "prompt_library";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_generations_prompt_version_id_fkey";
            columns: ["prompt_version_id"];
            isOneToOne: false;
            referencedRelation: "prompt_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      prompt_templates: {
        Row: {
          description: string | null;
          id: string | null;
          latest_version: number | null;
          output_schema: string | null;
          state: Database["public"]["Enums"]["prompt_status"] | null;
          status: Database["public"]["Enums"]["prompt_status"] | null;
          template_key: string | null;
          title: string | null;
          version: number | null;
          version_count: number | null;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "prompt_library_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
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
      accept_ai_generation: {
        Args: {
          p_content: string;
          p_edit_distance: number;
          p_generation_id: string;
          p_section_updated_at: string;
        };
        Returns: string;
      };
      accept_my_pending_invitations: { Args: Record<PropertyKey, never>; Returns: number };
      accept_workspace_invitation: { Args: { token: string }; Returns: string };
      create_workspace_with_owner: {
        Args: { organization_name: string; report_title: string; workspace_name: string };
        Returns: {
          organization_id: string;
          report_id: string;
          workspace_id: string;
        }[];
      };
      discard_ai_generation: { Args: { p_generation_id: string }; Returns: undefined };
      invitation_preview: {
        Args: { token: string };
        Returns: {
          email: string;
          expires_at: string;
          invited_by_name: string;
          organization_name: string;
          role: Database["public"]["Enums"]["workspace_role"];
          status: string;
          workspace_name: string;
        }[];
      };
      start_ai_generation: {
        Args: {
          p_estimated_tokens: number;
          p_model: string;
          p_monthly_budget: number;
          p_output_schema: string;
          p_params: Json;
          p_prompt_version_id: string;
          p_provider: string;
          p_rate_limit: number;
          p_schema_version: number;
          p_section_id: string;
          p_user_id: string;
          p_workspace_id: string;
        };
        Returns: {
          generation_id: string;
          refusal: string;
          retry_after: number;
        }[];
      };
    };
    Enums: {
      ai_generation_status: "running" | "succeeded" | "failed";
      parse_status: "pending" | "processing" | "parsed" | "failed" | "skipped";
      prompt_status: "draft" | "published" | "archived";
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
      ai_generation_status: ["running", "succeeded", "failed"],
      parse_status: ["pending", "processing", "parsed", "failed", "skipped"],
      prompt_status: ["draft", "published", "archived"],
      report_status: ["draft", "in_review", "final"],
      section_status: ["not_started", "in_progress", "completed"],
      workspace_role: ["owner", "admin", "expert", "viewer"],
    },
  },
} as const;
