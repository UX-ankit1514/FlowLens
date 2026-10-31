/**
 * FlowLens application types.
 *
 * These are FlowLens's own normalized structures. The TinyFish output schema
 * lives separately in lib/tinyfish/output-schema.ts and is transformed into
 * these types; the raw provider payload is always preserved on the session.
 */

export type ExecutionStatus =
  | "CREATED"
  | "STARTING"
  | "RUNNING"
  | "ANALYSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type TaskOutcome =
  | "COMPLETED"
  | "PARTIAL"
  | "BLOCKED"
  | "NOT_COMPLETED"
  | "INCONCLUSIVE";

export type Persona = {
  id: string;
  /** Exactly as supplied by the designer. Never rewritten or expanded. */
  description: string;
  constraints?: string[];
  devicePreference?: string;
};

export type FeatureContext = {
  name?: string;
  description?: string;
  intendedBenefit?: string;
  expectedOutcome?: string;
};

export type TestDefinition = {
  id: string;
  websiteUrl: string;
  sessionName?: string;
  persona: Persona;
  goal: string;
  successCriteria: string[];
  featureContext?: FeatureContext;
};

export type SessionEventType =
  | "SESSION_CREATED"
  | "PROVIDER_STARTED"
  | "LIVE_VIEW_AVAILABLE"
  | "AGENT_PROGRESS"
  | "CANCEL_REQUESTED"
  | "CONNECTION_INTERRUPTED"
  | "CONNECTION_RECOVERED"
  | "RUN_COMPLETED"
  | "RUN_FAILED"
  | "RUN_CANCELLED"
  | "ANALYSIS_STARTED"
  | "REPORT_READY";

export type SessionEvent = {
  id: string;
  sequence: number;
  timestamp: string;
  type: SessionEventType;
  description: string;
  /** "provider" = received from TinyFish; "flowlens" = FlowLens lifecycle. */
  source: "provider" | "flowlens";
  tone: "neutral" | "positive" | "notice" | "negative";
  pageUrl?: string;
  evidenceRef?: string;
};

export type FailureKind =
  | "CONFIGURATION"
  | "INVALID_API_KEY"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  | "NETWORK"
  | "TIMEOUT"
  | "AGENT_FAILURE"
  | "UNKNOWN";

export type SessionError = {
  kind: FailureKind;
  /** Plain-language explanation for the designer. */
  message: string;
  /** Provider message, kept for transparency (never contains secrets). */
  providerMessage?: string;
  providerCode?: string;
  retryAfterSeconds?: number | null;
  helpUrl?: string;
};

/** A step recorded by TinyFish for the run (fetched after completion). */
export type StepEvidence = {
  ref: string; // "S1", "S2", ...
  stepId: string;
  timestamp?: string;
  action: string;
  status?: string;
  duration?: string;
  hasScreenshot: boolean;
};

export type DesignerNote = {
  id: string;
  ref: string; // "N1", ...
  createdAt: string;
  text: string;
};

export type LiveViewStatus = "PENDING" | "AVAILABLE" | "ENDED";

export type TestSession = {
  id: string;
  definition: TestDefinition;
  providerRunId?: string;
  executionStatus: ExecutionStatus;
  taskOutcome?: TaskOutcome;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  events: SessionEvent[];
  /** Raw TinyFish COMPLETE payload, preserved untouched. */
  rawResult?: unknown;
  providerStatus?: string;
  error?: SessionError;
  streamingUrl?: string;
  liveViewStatus: LiveViewStatus;
  steps: StepEvidence[];
  notes: DesignerNote[];
  cancelRequested: boolean;
  report?: UsabilityReport;
};

export type FindingCategory =
  | "BROKEN_JOURNEY"
  | "MISSING_INFORMATION"
  | "CONFUSING_FLOW"
  | "POTENTIAL_FRICTION";

export type Severity = "HIGH" | "MEDIUM" | "LOW";
export type Confidence = "VERIFIED" | "INFERRED" | "UNCERTAIN";

export type UXFinding = {
  id: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  severityRationale: string;
  observation: string;
  hypothesis?: string;
  personaRelevance?: string;
  recommendation: string;
  evidenceRefs: string[];
  pageUrl?: string;
  confidence: Confidence;
  /** Where the finding came from. */
  origin: "AGENT_REPORTED" | "PATTERN" | "AI_INTERPRETATION";
};

export type CheckpointStatus = "PASSED" | "FAILED" | "BLOCKED" | "NOT_VERIFIED";

export type Checkpoint = {
  id: string; // "C1", ...
  description: string; // the designer's success criterion, verbatim
  status: CheckpointStatus;
  observation?: string; // agent-reported
  pageUrl?: string;
  evidenceRefs: string[];
};

export type TestBlocker = {
  id: string;
  kind: string;
  description: string;
  pageUrl?: string;
  evidenceRefs: string[];
};

export type Recommendation = {
  id: string;
  findingId?: string;
  observation: string;
  hypothesis?: string;
  recommendation: string;
};

export type EvidenceKind =
  | "TIMELINE_EVENT"
  | "STEP_SCREENSHOT"
  | "AGENT_CHECKPOINT"
  | "AGENT_ACTION"
  | "AGENT_OBSTACLE"
  | "DESIGNER_NOTE";

export type EvidenceItem = {
  ref: string;
  kind: EvidenceKind;
  label: string;
  detail?: string;
  pageUrl?: string;
  stepId?: string;
};

export type AnalysisMethod = "EVIDENCE_SUMMARY" | "AI_INTERPRETATION";

export type UsabilityReport = {
  sessionId: string;
  generatedAt: string;
  method: AnalysisMethod;
  methodNote: string;
  aiModel?: string;
  /** Set when AI interpretation was attempted but could not be used. */
  aiUnavailableReason?: string;
  taskOutcome: TaskOutcome;
  outcomeRationale: string;
  summary: string;
  agentSummary?: string;
  finalAnswer?: string;
  checkpoints: Checkpoint[];
  findings: UXFinding[];
  blockers: TestBlocker[];
  recommendations: Recommendation[];
  evidence: EvidenceItem[];
  urlsVisited: string[];
  limitations: string[];
  /** True when the provider returned a structured result we could validate. */
  structuredResultValid: boolean;
};

/** Public, client-safe view of a session (identical today; kept explicit). */
export type SessionView = TestSession;

export type AppConfigView = {
  tinyfishConfigured: boolean;
  aiInterpretationEnabled: boolean;
  aiModel?: string;
};
