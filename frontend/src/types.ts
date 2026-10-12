/**
 * 数据契约类型定义 · 对应 docs/feed-contract.md，兼容示例 0.1 / 本机 0.2、0.3
 */

export type FeedMode = 'demo' | 'live';

export type SourceKind = 'aggregator' | 'original' | 'community' | 'repository';

export type SourceStatus = 'not_connected' | 'ok' | 'partial' | 'failed';

export type SourceGroup = 'tech' | 'community' | 'creators' | 'hot' | 'finance';
export type LinkKind = 'article' | 'search' | 'topic' | 'discussion' | 'repository' | 'video' | 'post';

export type ContentStatus = 'headline_only' | 'excerpt_only' | 'body_read' | 'media_unread' | 'demo' | 'metadata_only' | 'collector_summary';

export type VerificationStatus = 'not_tested' | 'tested_with_evidence' | 'not_verified';

export type FollowupStatus = 'draft' | 'submitted' | 'running' | 'needs_input' | 'requesting' | 'reading' | 'analyzing' | 'done' | 'failed';

export interface UserProfile {
  interests: string;
  exclude: string;
  language: string;
}

export interface SourceDefinition {
  id: string;
  name: string;
  home_url: string;
  kind: SourceKind;
  status: SourceStatus;
  last_success_at: string | null;
  last_attempt_at?: string | null;
  next_allowed_at?: string | null;
  feed_url?: string;
  format?: 'rss' | 'atom' | 'json' | 'public-json' | 'public-html';
  group?: SourceGroup;
  ranked?: boolean;
  read_summary?: boolean;
  disabled?: boolean;
  enabled?: boolean;
  availability_message?: string;
  reading_note?: string;
  link_kind?: LinkKind;
  message: string;
}

export interface FeedItem {
  id: string;
  title: string;
  author_name?: string;
  author_handle?: string;
  // Derived presentation only; not written back into source snapshots.
  display_title?: string;
  matched_interests?: string[];
  excluded_interests?: string[];
  matches_profile?: boolean;
  selection_reason?: string;
  summary: string;
  summary_label?: string;
  recommendation_kind?: 'rule' | 'ai' | 'editor';
  repository_name?: string;
  repository_created_at?: string | null;
  updated_at?: string | null;
  stars?: number;
  category?: string;
  evidence_ref?: string;
  canonical_url?: string;
  alias_ids?: string[];
  evidence_refs?: string[];
  source_updated_at?: string | null;
  source_item_time?: string | null;
  source_links?: Array<{source_id: string; url: string; evidence_ref: string; captured_at: string; source_updated_at: string | null; source_rank?: number | null; heat_label?: string | null}>;
  source_rank?: number | null;
  heat_label?: string | null;
  link_kind?: LinkKind;
  recommendation_reason: string;
  source_refs: string[];
  original_url: string | null;
  published_at: string | null;
  captured_at: string | null;
  content_status: ContentStatus;
  verification_status: VerificationStatus;
  unknowns: string[];
  suggested_question: string;
}

export interface FeedSections {
  daily: string[];
  discover: string[];
}

export interface ResearchReport {
  summary: string;
  can_do: string[];
  who_for: string;
  first_steps: string[];
  cost_and_limits: string;
  unknowns: string[];
  next_step: string;
}

export interface ResearchJob {
  id: string;
  item_id: string;
  repository: string;
  question: string;
  status: 'reading' | 'analyzing' | 'done' | 'failed';
  created_at: string;
  updated_at: string;
  engine: 'Codex';
  model: string | null;
  source: { repository: string; url: string; api_url: string; path: string; sha: string; captured_at: string; original_characters: number; truncated: boolean } | null;
  report: ResearchReport | null;
  error: string | null;
}

export interface TrialPlan {
  version: 1;
  origin: 'local-template';
  research_id: string;
  source: ResearchJob['source'];
  goal: string;
  steps: string;
  shots: string;
  outcome: 'not_started' | 'in_progress' | 'worked' | 'blocked' | 'skipped';
  notes: string;
  evidence_notes: string;
  edited_fields: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface FollowupTask {
  writing_brief?: {version: 1; research_id: string; format: 'post' | 'thread' | 'tutorial'; audience: string; angle: string; created_at: string | null; updated_at: string | null};
  imported_backup?: { exported_at: string; restored_at: string; original_status: FollowupStatus };
  trial_plan?: TrialPlan;
  research_request_id?: string;
  research?: ResearchJob;
  error_message?: string | null;
  id: string;
  item_id: string;
  question: string;
  status: FollowupStatus;
  created_at: string;
  updated_at: string;
  target_agent: string | null;
  delivery_receipt: string | null;
  result: {
    conclusion: string;
    sources_used: string[];
    unresolved: string[];
    suggested_next_step: string;
  } | null;
}

export interface FeedData {
  schema_version: string;
  mode: FeedMode;
  generated_at: string | null;
  publication?: {kind: string; version: string; published_at: string | null; automatic_update?: boolean; schedule_label?: string};
  profile: UserProfile;
  sources: SourceDefinition[];
  items: FeedItem[];
  sections: FeedSections;
  followups: FollowupTask[];
  source_buckets?: Record<string, FeedItem[]>;
  seen_links?: string[];
  refresh?: {
    status: 'idle' | 'ok' | 'partial' | 'failed';
    last_attempt_at: string | null;
    next_allowed_at: string | null;
    new_count: number;
    new_item_ids?: string[];
    duplicate_count?: number;
    message: string;
  };
  update_notice?: string;
}

export interface LocalStorageState {
  topics?: TopicWorkspace[];
  saved_item_ids: string[];
  hidden_item_ids: string[];
  followups: FollowupTask[];
  profile_override: UserProfile | null;
  item_snapshots?: Record<string, FeedItem>;
}

export interface TopicWorkspace {
  id: string;
  title: string;
  goal: string;
  thoughts: string;
  gaps: string;
  next_step: string;
  result: string;
  status: 'collecting' | 'working' | 'done';
  created_at: string;
  updated_at: string;
  materials: Array<{item: FeedItem; note: string; added_at: string}>;
  imported_backup?: {exported_at: string; restored_at: string};
}


export interface PersonalFeedBackup {
  format: 'personal-feed-backup';
  version: 1;
  mode: FeedMode;
  exported_at: string;
  state: LocalStorageState;
}
