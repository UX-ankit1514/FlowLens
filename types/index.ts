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

/**
 * Task outcome, judged against the designer's success criteria. A provider
 * run marked "completed" never establishes task success on its own:
 * REPORTED_COMPLETE means the agent claimed every criterion but FlowLens could
 * not confirm them independently; VERIFIED_COMPLETE requires confirmation.
 */
export type TaskOutcome =
  | "VERIFIED_COMPLETE"
  | "REPORTED_COMPLETE"
  | "PARTIAL"
  | "NOT_COMPLETED"
  | "BLOCKED"
  | "NOT_VERIFIED";

/** Outcome values written by reports before version 2 (still found in saved sessions). */
export type LegacyTaskOutcome = "COMPLETED" | "INCONCLUSIVE";

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
  | "RUN_QUEUED"
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
  /** Designer-recorded comparison with real research participants, per finding. */
  validations?: HumanValidation[];
  /** One-way fingerprint of the TinyFish key that ran this test (never the key). */
  ownerId?: string;
};

/* ------------------------------------------------------------------------ */
/* Result verification                                                       */
/* ------------------------------------------------------------------------ */

/** What the agent reported for a success criterion. */
export type CheckpointStatus = "PASSED" | "FAILED" | "BLOCKED" | "NOT_VERIFIED";

/**
 * How far an agent-reported "passed" is backed by recorded evidence.
 * CONFIRMED needs a step screenshot that shows it; CONSISTENT means the
 * recorded steps agree but nothing showed it directly; AGENT_REPORTED means
 * only the agent's own account supports it.
 */
export type CheckpointVerification =
  | "CONFIRMED"
  | "CONSISTENT"
  | "AGENT_REPORTED"
  | "LIMITED"
  | "CONTRADICTED"
  | "NOT_APPLICABLE";

export type Checkpoint = {
  id: string; // "C1", ...
  description: string; // the designer's success criterion, verbatim
  status: CheckpointStatus; // as reported by the agent
  observation?: string; // agent-reported
  pageUrl?: string;
  evidenceRefs: string[];
  verification: CheckpointVerification;
  verificationNote?: string;
  verificationRefs: string[];
};

/* ------------------------------------------------------------------------ */
/* Journey trace                                                             */
/* ------------------------------------------------------------------------ */

/** Inferred from the wording of the agent's stated purpose, never observed directly. */
export type ActionType =
  | "NAVIGATE"
  | "CLICK"
  | "TYPE"
  | "SELECT"
  | "SEARCH"
  | "READ"
  | "SCROLL"
  | "WAIT"
  | "DISMISS"
  | "SUBMIT"
  | "GO_BACK"
  | "RELOAD"
  | "FOCUS"
  | "OTHER";

export type StepFlagKind =
  | "REPEAT"
  | "RETRY"
  | "BACKTRACK"
  | "ERROR"
  | "TECHNICAL"
  | "INTERRUPTION"
  | "DIRECT_URL"
  | "WAIT";

export type StepFlag = { kind: StepFlagKind; note: string; relatedRefs: string[] };

/** TinyFish doesn't record a per-step result; this says where one came from. */
export type StepResult = { text: string; source: "AGENT_REPORT" | "NEXT_STEP" | "RUN_RECORD" };

export type JourneyStep = {
  /** "S#" for TinyFish step records, "E#" when only live progress events exist. */
  ref: string;
  number: number;
  stepId?: string;
  timestamp?: string;
  elapsedMs?: number;
  /** TinyFish's own duration for the step, e.g. "1.2s". */
  duration?: string;
  /** The agent's stated purpose, verbatim as TinyFish recorded it. */
  statedPurpose: string;
  /** Used only when no purpose was recorded, and always labelled as inferred. */
  inferredPurpose?: string;
  actionType: ActionType;
  terminal?: "COMPLETED" | "FAILED" | "CANCELLED";
  hasScreenshot: boolean;
  eventRef?: string;
  /** The agent's end-of-run account of this action, matched by wording. */
  agentAction?: { ref: string; description: string; purpose?: string; pageUrl?: string; result: string };
  result?: StepResult;
  flags: StepFlag[];
};

export type TraceCompleteness = "STEP_LEVEL" | "PROGRESS_ONLY" | "NONE";

export type JourneyPatternKind =
  | "REPEATED_ACTION"
  | "BACKTRACKING"
  | "ROUTE_CHANGE"
  | "DEAD_END"
  | "INFORMATION_NOT_FOUND"
  | "CONFUSING_NAVIGATION"
  | "UNNECESSARY_STEPS"
  | "INCOMPLETE_TASK";

export type JourneyPattern = {
  id: string; // "P1", ...
  kind: JourneyPatternKind;
  title: string;
  description: string;
  stepRefs: string[];
  evidenceRefs: string[];
  origin: "RULES" | "AI";
};

export type JourneyTrace = {
  completeness: TraceCompleteness;
  completenessNote: string;
  endedEarly: boolean;
  startedAt?: string;
  durationMs?: number;
  steps: JourneyStep[];
  patterns: JourneyPattern[];
};

/* ------------------------------------------------------------------------ */
/* Findings, technical blockers, human validation                            */
/* ------------------------------------------------------------------------ */

export type FindingKind = "FUNCTIONAL_FAILURE" | "USABILITY_HYPOTHESIS";

export type UXFinding = {
  id: string; // "F1", ...
  kind: FindingKind;
  title: string;
  /** What happened, as observed. */
  whatHappened: string;
  /** Where in the journey it happened. */
  stepRefs: string[];
  pageUrl?: string;
  /** Why it might matter for the supplied persona or goal. */
  personaImpact?: string;
  /** What a designer should investigate or change. */
  designerAction: string;
  /** A known reason the observation may not reflect a real visitor. */
  caveat?: string;
  evidenceRefs: string[];
  affectsCriteria: string[];
  origin: "RULES" | "AI";
};

export type TechnicalBlockerKind =
  | "BOT_PROTECTION"
  | "PROXY_OR_NETWORK"
  | "AGENT_ENVIRONMENT"
  | "SITE_UNREACHABLE"
  | "LOGIN_REQUIRED"
  | "REAL_WORLD_ACTION";

/** Something about the test environment, never a usability verdict. */
export type TechnicalBlocker = {
  id: string; // "T1", ...
  kind: TechnicalBlockerKind;
  title: string;
  description: string;
  effect: string;
  stoppedRun: boolean;
  stepRefs: string[];
  evidenceRefs: string[];
  affectsCriteria: string[];
  pageUrl?: string;
};

export type HumanValidationStatus = "NOT_TESTED" | "OBSERVED" | "NOT_OBSERVED";

export type HumanValidation = {
  findingId: string;
  status: HumanValidationStatus;
  /** The designer's own note, e.g. "3 of 5 participants missed the fare". */
  note?: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------------ */
/* Evidence and report                                                       */
/* ------------------------------------------------------------------------ */

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
  /** Report format version; older saved reports are rebuilt from their evidence. */
  version: number;
  sessionId: string;
  generatedAt: string;
  method: AnalysisMethod;
  methodNote: string;
  aiModel?: string;
  /** Set when AI interpretation was attempted but could not be used. */
  aiUnavailableReason?: string;
  taskOutcome: TaskOutcome;
  outcomeRationale: string;
  /** Two or three sentences. */
  summary: string;
  /** The single most important thing to do next. */
  nextAction: string;
  agentSummary?: string;
  finalAnswer?: string;
  checkpoints: Checkpoint[];
  journey: JourneyTrace;
  findings: UXFinding[];
  technicalBlockers: TechnicalBlocker[];
  evidence: EvidenceItem[];
  urlsVisited: string[];
  limitations: string[];
  /** True when the provider returned a structured result we could validate. */
  structuredResultValid: boolean;
};

/** Public, client-safe view of a session (identical today; kept explicit). */
export type SessionView = TestSession;

/** Compact persisted-session view used by the local Recents screen. */
export type RecentSessionSummary = {
  id: string;
  title: string;
  websiteUrl: string;
  goal: string;
  executionStatus: ExecutionStatus;
  taskOutcome?: TaskOutcome;
  createdAt: string;
  finishedAt?: string;
  hasReport: boolean;
  eventCount: number;
  stepCount: number;
};

/** Where a connected key comes from: this browser, an MCP client header, or the server. */
export type KeySourceView = "browser" | "header" | "server";

export type ConnectionView = {
  connected: boolean;
  source?: KeySourceView;
  /** Last four characters, so the designer can recognise which key is in use. */
  hint?: string;
};

export type AppConfigView = {
  tinyfishConfigured: boolean;
  aiInterpretationEnabled: boolean;
  aiModel?: string;
  tinyfish: ConnectionView;
  claude: ConnectionView;
  /** True on a shared, hosted deployment (each designer brings their own key). */
  hosted: boolean;
};
