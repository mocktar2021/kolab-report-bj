export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      ai_cost_alerts: {
        Row: {
          created_at: string;
          day: string;
          threshold_usd: number;
          total_usd: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          day: string;
          threshold_usd: number;
          total_usd: number;
        };
        Update: {
          created_at?: string;
          day?: string;
          threshold_usd?: number;
          total_usd?: number;
        };
        Relationships: [];
      };
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
          rollout_id: string | null;
          schema_version: number;
          section_id: string | null;
          status: Database["public"]["Enums"]["ai_generation_status"];
          total_tokens: number | null;
          trace_id: string | null;
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
          rollout_id?: string | null;
          schema_version: number;
          section_id?: string | null;
          status?: Database["public"]["Enums"]["ai_generation_status"];
          total_tokens?: never;
          trace_id?: string | null;
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
          rollout_id?: string | null;
          schema_version?: number;
          section_id?: string | null;
          status?: Database["public"]["Enums"]["ai_generation_status"];
          total_tokens?: never;
          trace_id?: string | null;
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
            foreignKeyName: "ai_generations_rollout_id_fkey";
            columns: ["rollout_id"];
            isOneToOne: false;
            referencedRelation: "prompt_rollouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_generations_section_id_workspace_id_fkey";
            columns: ["section_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "report_sections";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "ai_generations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_ai_packs: {
        Row: {
          created_at: string;
          drafts: number;
          expires_at: string;
          id: string;
          organization_id: string;
          purchase_id: string | null;
          revoked_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          drafts: number;
          expires_at: string;
          id?: string;
          organization_id: string;
          purchase_id?: string | null;
          revoked_at?: string | null;
        };
        Update: {
          created_at?: string;
          drafts?: number;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          purchase_id?: string | null;
          revoked_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_ai_packs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_ai_packs_purchase_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "billing_purchases";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_draft_usage: {
        Row: {
          created_at: string;
          entitlement_id: string | null;
          generation_id: string;
          organization_id: string;
          pack_id: string | null;
          pool: string;
          settled_at: string | null;
          status: string;
          usage_month: string;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          entitlement_id?: string | null;
          generation_id: string;
          organization_id: string;
          pack_id?: string | null;
          pool: string;
          settled_at?: string | null;
          status?: string;
          usage_month: string;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string;
          entitlement_id?: string | null;
          generation_id?: string;
          organization_id?: string;
          pack_id?: string | null;
          pool?: string;
          settled_at?: string | null;
          status?: string;
          usage_month?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_draft_usage_entitlement_id_fkey";
            columns: ["entitlement_id"];
            isOneToOne: false;
            referencedRelation: "billing_entitlements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_draft_usage_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_draft_usage_pack_id_fkey";
            columns: ["pack_id"];
            isOneToOne: false;
            referencedRelation: "billing_ai_packs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_draft_usage_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_entitlements: {
        Row: {
          amount_ht_xof: number;
          created_at: string;
          custom_templates: boolean;
          drafts_per_month: number | null;
          drafts_total: number | null;
          ends_at: string;
          grace_days: number;
          id: string;
          max_members: number | null;
          max_reports: number | null;
          note: string | null;
          organization_id: string;
          plan: string;
          purchase_id: string | null;
          revoked_at: string | null;
          revoked_reason: string | null;
          scope: string;
          source: string;
          starts_at: string;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount_ht_xof?: number;
          created_at?: string;
          custom_templates?: boolean;
          drafts_per_month?: number | null;
          drafts_total?: number | null;
          ends_at: string;
          grace_days?: number;
          id?: string;
          max_members?: number | null;
          max_reports?: number | null;
          note?: string | null;
          organization_id: string;
          plan: string;
          purchase_id?: string | null;
          revoked_at?: string | null;
          revoked_reason?: string | null;
          scope: string;
          source: string;
          starts_at: string;
          workspace_id?: string | null;
        };
        Update: {
          amount_ht_xof?: number;
          created_at?: string;
          custom_templates?: boolean;
          drafts_per_month?: number | null;
          drafts_total?: number | null;
          ends_at?: string;
          grace_days?: number;
          id?: string;
          max_members?: number | null;
          max_reports?: number | null;
          note?: string | null;
          organization_id?: string;
          plan?: string;
          purchase_id?: string | null;
          revoked_at?: string | null;
          revoked_reason?: string | null;
          scope?: string;
          source?: string;
          starts_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_entitlements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_entitlements_purchase_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "billing_purchases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_entitlements_workspace_fkey";
            columns: ["workspace_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      billing_purchases: {
        Row: {
          amount_ht_xof: number;
          amount_xof: number;
          catalog_version: number;
          confirmation_sent_at: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          environment: string;
          fedapay_fees_xof: number | null;
          fedapay_mode: string | null;
          fedapay_reference: string | null;
          fedapay_status: string | null;
          fedapay_transaction_id: number | null;
          granted_at: string | null;
          id: string;
          last_checked_at: string | null;
          merchant_reference: string;
          method: string;
          offer: string;
          offer_label: string;
          organization_id: string | null;
          paid_at: string | null;
          quantity: number;
          review_reason: string | null;
          status: string;
          tax_xof: number;
          terms: NonNullable<Json>;
          updated_at: string;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount_ht_xof: number;
          amount_xof: number;
          catalog_version: number;
          confirmation_sent_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          environment: string;
          fedapay_fees_xof?: number | null;
          fedapay_mode?: string | null;
          fedapay_reference?: string | null;
          fedapay_status?: string | null;
          fedapay_transaction_id?: number | null;
          granted_at?: string | null;
          id?: string;
          last_checked_at?: string | null;
          merchant_reference: string;
          method?: string;
          offer: string;
          offer_label: string;
          organization_id?: string | null;
          paid_at?: string | null;
          quantity?: number;
          review_reason?: string | null;
          status?: string;
          tax_xof?: number;
          terms: NonNullable<Json>;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          amount_ht_xof?: number;
          amount_xof?: number;
          catalog_version?: number;
          confirmation_sent_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          environment?: string;
          fedapay_fees_xof?: number | null;
          fedapay_mode?: string | null;
          fedapay_reference?: string | null;
          fedapay_status?: string | null;
          fedapay_transaction_id?: number | null;
          granted_at?: string | null;
          id?: string;
          last_checked_at?: string | null;
          merchant_reference?: string;
          method?: string;
          offer?: string;
          offer_label?: string;
          organization_id?: string | null;
          paid_at?: string | null;
          quantity?: number;
          review_reason?: string | null;
          status?: string;
          tax_xof?: number;
          terms?: NonNullable<Json>;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_purchases_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_purchases_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_purchases_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_receipt_lines: {
        Row: {
          amount_ht_xof: number;
          label: string;
          period_end: string | null;
          period_start: string | null;
          position: number;
          quantity: number;
          receipt_id: string;
          tax_code: string | null;
          tax_rate: number | null;
          tax_xof: number;
          unit_price_ht_xof: number;
        };
        ComputedFields: never;
        Insert: {
          amount_ht_xof: number;
          label: string;
          period_end?: string | null;
          period_start?: string | null;
          position: number;
          quantity: number;
          receipt_id: string;
          tax_code?: string | null;
          tax_rate?: number | null;
          tax_xof?: number;
          unit_price_ht_xof: number;
        };
        Update: {
          amount_ht_xof?: number;
          label?: string;
          period_end?: string | null;
          period_start?: string | null;
          position?: number;
          quantity?: number;
          receipt_id?: string;
          tax_code?: string | null;
          tax_rate?: number | null;
          tax_xof?: number;
          unit_price_ht_xof?: number;
        };
        Relationships: [
          {
            foreignKeyName: "billing_receipt_lines_receipt_id_fkey";
            columns: ["receipt_id"];
            isOneToOne: false;
            referencedRelation: "billing_receipts";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_receipts: {
        Row: {
          buyer: NonNullable<Json>;
          currency: string;
          environment: string;
          external_invoice_data: Json | null;
          external_invoice_number: string | null;
          id: string;
          issued_at: string;
          kind: string;
          number: string;
          organization_id: string | null;
          payment: NonNullable<Json>;
          purchase_id: string;
          seller: NonNullable<Json>;
          total_ht_xof: number;
          total_tax_xof: number;
          total_xof: number;
        };
        ComputedFields: never;
        Insert: {
          buyer: NonNullable<Json>;
          currency?: string;
          environment: string;
          external_invoice_data?: Json | null;
          external_invoice_number?: string | null;
          id?: string;
          issued_at?: string;
          kind?: string;
          number: string;
          organization_id?: string | null;
          payment: NonNullable<Json>;
          purchase_id: string;
          seller: NonNullable<Json>;
          total_ht_xof: number;
          total_tax_xof?: number;
          total_xof: number;
        };
        Update: {
          buyer?: NonNullable<Json>;
          currency?: string;
          environment?: string;
          external_invoice_data?: Json | null;
          external_invoice_number?: string | null;
          id?: string;
          issued_at?: string;
          kind?: string;
          number?: string;
          organization_id?: string | null;
          payment?: NonNullable<Json>;
          purchase_id?: string;
          seller?: NonNullable<Json>;
          total_ht_xof?: number;
          total_tax_xof?: number;
          total_xof?: number;
        };
        Relationships: [
          {
            foreignKeyName: "billing_receipts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_receipts_purchase_id_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "billing_purchases";
            referencedColumns: ["id"];
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
      notifications: {
        Row: {
          created_at: string;
          event_id: string;
          id: string;
          read_at: string | null;
          user_id: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          event_id: string;
          id?: string;
          read_at?: string | null;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          id?: string;
          read_at?: string | null;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_event_id_workspace_id_fkey";
            columns: ["event_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "report_status_events";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_billing: {
        Row: {
          address: string | null;
          billing_email: string | null;
          created_at: string;
          legal_name: string | null;
          organization_id: string;
          tax_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          billing_email?: string | null;
          created_at?: string;
          legal_name?: string | null;
          organization_id: string;
          tax_id?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          billing_email?: string | null;
          created_at?: string;
          legal_name?: string | null;
          organization_id?: string;
          tax_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_billing_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
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
          published_at: string | null;
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
          published_at?: string | null;
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
          published_at?: string | null;
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
      prompt_rollouts: {
        Row: {
          base_id: string | null;
          candidate_id: string;
          created_at: string;
          created_by: string | null;
          ended_at: string | null;
          id: string;
          percent: number;
          status: string;
          target_workspace_id: string | null;
          template_key: string;
          updated_at: string;
          workspace_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          base_id?: string | null;
          candidate_id: string;
          created_at?: string;
          created_by?: string | null;
          ended_at?: string | null;
          id?: string;
          percent: number;
          status?: string;
          target_workspace_id?: string | null;
          template_key: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          base_id?: string | null;
          candidate_id?: string;
          created_at?: string;
          created_by?: string | null;
          ended_at?: string | null;
          id?: string;
          percent?: number;
          status?: string;
          target_workspace_id?: string | null;
          template_key?: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "prompt_rollouts_base_id_fkey";
            columns: ["base_id"];
            isOneToOne: false;
            referencedRelation: "prompt_library";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_rollouts_base_id_fkey";
            columns: ["base_id"];
            isOneToOne: false;
            referencedRelation: "prompt_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_rollouts_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "prompt_library";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_rollouts_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "prompt_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_rollouts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_rollouts_target_workspace_id_fkey";
            columns: ["target_workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prompt_rollouts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      report_exports: {
        Row: {
          created_at: string;
          created_by: string | null;
          file_name: string;
          finished_at: string | null;
          format: string;
          id: string;
          kind: string;
          report_id: string;
          section_count: number | null;
          size_bytes: number | null;
          status: string;
          status_event_id: string | null;
          storage_path: string | null;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          file_name: string;
          finished_at?: string | null;
          format: string;
          id?: string;
          kind?: string;
          report_id: string;
          section_count?: number | null;
          size_bytes?: number | null;
          status?: string;
          status_event_id?: string | null;
          storage_path?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          file_name?: string;
          finished_at?: string | null;
          format?: string;
          id?: string;
          kind?: string;
          report_id?: string;
          section_count?: number | null;
          size_bytes?: number | null;
          status?: string;
          status_event_id?: string | null;
          storage_path?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_exports_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_exports_report_id_workspace_id_fkey";
            columns: ["report_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "report_progress";
            referencedColumns: ["report_id", "workspace_id"];
          },
          {
            foreignKeyName: "report_exports_report_id_workspace_id_fkey";
            columns: ["report_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "report_exports_status_event_id_fkey";
            columns: ["status_event_id"];
            isOneToOne: false;
            referencedRelation: "report_status_events";
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
          content_updated_at: string;
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
          content_updated_at?: string;
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
          content_updated_at?: string;
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
      report_status_events: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          from_status: Database["public"]["Enums"]["report_status"];
          id: string;
          report_id: string;
          to_status: Database["public"]["Enums"]["report_status"];
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          from_status: Database["public"]["Enums"]["report_status"];
          id?: string;
          report_id: string;
          to_status: Database["public"]["Enums"]["report_status"];
          workspace_id: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          from_status?: Database["public"]["Enums"]["report_status"];
          id?: string;
          report_id?: string;
          to_status?: Database["public"]["Enums"]["report_status"];
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_status_events_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_status_events_report_id_workspace_id_fkey";
            columns: ["report_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "report_progress";
            referencedColumns: ["report_id", "workspace_id"];
          },
          {
            foreignKeyName: "report_status_events_report_id_workspace_id_fkey";
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
          billing_mode: string;
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
          billing_mode?: string;
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
          billing_mode?: string;
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
          {
            foreignKeyName: "ai_generations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
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
      ai_prompt_metrics: {
        Args: { p_since: string; p_workspace_id: string };
        Returns: {
          acceptance_rate: number;
          accepted: number;
          cost: number;
          discarded: number;
          failed: number;
          failure_rate: number;
          from_rollout: number;
          generations: number;
          input_tokens: number;
          last_generation: string;
          mean_edit_ratio: number;
          mean_rating: number;
          model: string;
          output_tokens: number;
          p50_latency_ms: number;
          p95_latency_ms: number;
          prompt_scope: string;
          prompt_version_id: string;
          rated: number;
          succeeded: number;
          template_key: string;
          title: string;
          total_tokens: number;
          version: number;
        }[];
      };
      billing_apply_transaction: {
        Args: {
          p_amount_xof: number;
          p_approved_at?: string;
          p_currency?: string;
          p_environment: string;
          p_event_id?: string;
          p_event_name?: string;
          p_fees_xof?: number;
          p_merchant_reference?: string;
          p_mode?: string;
          p_purchase_id: string;
          p_reference?: string;
          p_source: string;
          p_status: string;
          p_transaction_id: number;
        };
        Returns: {
          ends_at: string;
          entitlement_id: string;
          notice: string;
          outcome: string;
          pack_id: string;
          receipt_number: string;
        }[];
      };
      billing_check_pending: { Args: { p_purchase_id: string }; Returns: string };
      billing_claim_notice: { Args: { p_kind: string; p_purchase_id: string }; Returns: boolean };
      billing_confirmation_details: {
        Args: { p_purchase_id: string };
        Returns: {
          amount_xof: number;
          billing_email: string;
          buyer_email: string;
          drafts: number;
          ends_at: string;
          offer: string;
          offer_label: string;
          organization_id: string;
          organization_name: string;
          plan: string;
          quantity: number;
          receipt_number: string;
        }[];
      };
      billing_create_purchase: {
        Args: {
          p_amount_ht_xof: number;
          p_catalog_version: number;
          p_created_by: string;
          p_environment: string;
          p_offer: string;
          p_offer_label: string;
          p_organization_id: string;
          p_quantity: number;
          p_reuse?: boolean;
          p_tax_xof: number;
          p_terms: Json;
          p_workspace_id?: string;
        };
        Returns: {
          fedapay_transaction_id: number;
          merchant_reference: string;
          purchase_id: string;
          refusal: string;
          reused: boolean;
        }[];
      };
      billing_find_purchase: {
        Args: {
          p_environment: string;
          p_event_id?: string;
          p_merchant_reference?: string;
          p_transaction_id: number;
        };
        Returns: {
          event_seen: boolean;
          organization_id: string;
          purchase_id: string;
          status: string;
        }[];
      };
      billing_overview: { Args: { p_organization_id: string }; Returns: Json };
      billing_pending_purchases: {
        Args: {
          p_environment: string;
          p_limit: number;
          p_organization_id?: string;
          p_recheck_after?: string;
        };
        Returns: {
          created_at: string;
          fedapay_transaction_id: number;
          merchant_reference: string;
          organization_id: string;
          purchase_id: string;
        }[];
      };
      billing_set_transaction: {
        Args: { p_purchase_id: string; p_status?: string; p_transaction_id: number };
        Returns: undefined;
      };
      claim_ai_cost_alert: { Args: { p_threshold: number }; Returns: number };
      claim_report_export: {
        Args: {
          p_file_name: string;
          p_format: string;
          p_hourly_limit: number;
          p_report_id: string;
          p_user_id: string;
        };
        Returns: {
          export_id: string;
          refusal: string;
        }[];
      };
      claim_storage_cleanup: {
        Args: { p_limit: number };
        Returns: {
          bucket: string;
          id: number;
          path: string;
        }[];
      };
      create_workspace_in_organization: {
        Args: { p_organization_id: string; p_report_title: string; p_workspace_name: string };
        Returns: {
          organization_id: string;
          report_id: string;
          workspace_id: string;
        }[];
      };
      create_workspace_with_owner: {
        Args: { organization_name: string; report_title: string; workspace_name: string };
        Returns: {
          organization_id: string;
          report_id: string;
          workspace_id: string;
        }[];
      };
      delete_organization: { Args: { p_confirmation: string; p_organization_id: string }; Returns: Json };
      delete_report: { Args: { p_confirmation?: string; p_report_id: string }; Returns: Json };
      delete_workspace: { Args: { p_confirmation: string; p_workspace_id: string }; Returns: Json };
      discard_ai_generation: { Args: { p_generation_id: string }; Returns: undefined };
      end_prompt_rollout: { Args: { p_promote: boolean; p_rollout_id: string }; Returns: undefined };
      expire_report_exports: { Args: { p_days: number }; Returns: number };
      finish_storage_cleanup: { Args: { p_error?: string; p_ids: number[] }; Returns: number };
      health_check: { Args: Record<PropertyKey, never>; Returns: boolean };
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
      my_manageable_organizations: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          name: string;
        }[];
      };
      organization_deletion_preview: { Args: { p_organization_id: string }; Returns: Json };
      release_ai_cost_alert: { Args: Record<PropertyKey, never>; Returns: undefined };
      reorder_report_sections: { Args: { p_report_id: string; p_section_ids: string[] }; Returns: undefined };
      report_deletion_preview: { Args: { p_report_id: string }; Returns: Json };
      rollback_prompt_publish: { Args: { p_version_id: string }; Returns: string };
      save_section_content: {
        Args: { p_content: string; p_expected_version: string; p_section_id: string };
        Returns: string;
      };
      set_prompt_rollout_percent: { Args: { p_percent: number; p_rollout_id: string }; Returns: undefined };
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
          p_rollout_id?: string;
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
      start_prompt_rollout: { Args: { p_candidate_id: string; p_percent: number }; Returns: string };
      transition_report_status: {
        Args: {
          p_from: Database["public"]["Enums"]["report_status"];
          p_report_id: string;
          p_to: Database["public"]["Enums"]["report_status"];
        };
        Returns: {
          event_id: string;
          recipients: string[];
        }[];
      };
      workspace_billing_state: {
        Args: { p_workspace_id: string };
        Returns: {
          billing_mode: string;
          can_manage_billing: boolean;
          can_read_billing: boolean;
          custom_templates: boolean;
          drafts_per_month: number;
          drafts_total: number;
          ends_at: string;
          grace_ends_at: string;
          max_members: number;
          max_reports: number;
          organization_id: string;
          plan: string;
          source: string;
          state: string;
        }[];
      };
      workspace_deletion_preview: { Args: { p_workspace_id: string }; Returns: Json };
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
