"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  Assessment,
  BriefRoles,
  Database,
  Json,
} from "@/lib/database.types";
import { backend, isBackendConfigured, type User } from "@/lib/backend";
import { AppHeader } from "@/app/components/app-header";

type AuthState = "loading" | "signed-out" | "authenticated";
type QueueRow =
  Database["public"]["Functions"]["review_queue"]["Returns"][number];
type ReviewerRole = BriefRoles["roles"][number];
type ReviewAssignment =
  Database["public"]["Tables"]["assessment_review_assignments"]["Row"];
type JsonRecord = { [key: string]: Json | undefined };
type ReviewStage = "checker" | "cluster_lead";
type Deadline = { date: Date; description: string };

// Approval runs setter -> checker -> cluster lead, in that order.
const STAGES: ReviewStage[] = ["checker", "cluster_lead"];
const STAGE_LABELS: Record<ReviewStage, string> = {
  checker: "Checker",
  cluster_lead: "Cluster lead",
};
const UNASSIGNED_STAGES: Record<ReviewStage, string> = {
  checker: "unassigned",
  cluster_lead: "unassigned",
};
const ROLE_LABELS: Record<string, string> = {
  cluster_lead: "Cluster Lead",
  teaching_director: "Teaching Director",
};
const STATUS_STYLES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-700",
  in_review: "border-blue-200 bg-blue-50 text-blue-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
};
const REVIEW_STYLES: Record<string, string> = {
  unassigned: "bg-slate-300",
  pending: "bg-amber-400",
  approved: "bg-emerald-500",
  overridden: "bg-emerald-500 ring-2 ring-amber-400",
  changes_requested: "bg-rose-500",
};

function isRecord(value: Json | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: Json | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function sentenceCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string | Date | null | undefined, withTime = false) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

function deadlinesFor(assessment: Assessment): Deadline[] {
  if (!isRecord(assessment.content)) return [];
  const formData = assessment.content.formData;
  if (!isRecord(formData)) return [];

  const firstLegacySubmission = Array.isArray(formData.submissionDates)
    ? formData.submissionDates[0]
    : undefined;
  const legacySubmission = isRecord(firstLegacySubmission)
    ? firstLegacySubmission
    : undefined;
  const submissionDate = text(formData.submissionDate);
  const rawDate = submissionDate || text(legacySubmission?.date);
  if (!rawDate) return [];

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return [];
  return [
    {
      date,
      description: submissionDate ? "" : text(legacySubmission?.description),
    },
  ];
}

function nextDeadline(assessment: Assessment) {
  const now = Date.now();
  return deadlinesFor(assessment).find(
    (deadline) => deadline.date.getTime() >= now,
  );
}

function StatePage({
  title,
  body,
  children,
  error,
}: {
  title: string;
  body: string;
  children?: ReactNode;
  error?: string | null;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-5 py-12 text-slate-950">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-slate-950 text-xs font-black tracking-wider text-white">
          UEA
        </div>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-600">
          Assessment briefs
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
        {children && <div className="mt-6 flex justify-center">{children}</div>}
        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {error}
          </p>
        )}
        <a
          href="./builder"
          className="mt-6 inline-flex text-sm font-semibold text-slate-500 hover:text-slate-950"
        >
          Open brief builder
        </a>
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${
        STATUS_STYLES[status] ?? "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {sentenceCase(status)}
    </span>
  );
}

function ApprovalIndicators({
  states,
}: {
  states: Record<ReviewStage, string>;
}) {
  return (
    <div
      className="flex flex-wrap gap-x-3 gap-y-1.5"
      aria-label="Approval states"
    >
      {STAGES.map((stage) => {
        const state = states[stage];
        return (
          <span
            key={stage}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600"
            title={`${STAGE_LABELS[stage]}: ${sentenceCase(state)}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${REVIEW_STYLES[state] ?? REVIEW_STYLES.unassigned}`}
            />
            {STAGE_LABELS[stage]}
            <span className="sr-only">: {sentenceCase(state)}</span>
          </span>
        );
      })}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm shadow-slate-200/30">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <strong className="text-2xl font-semibold tracking-tight text-slate-950">
          {value}
        </strong>
        <span className="pb-0.5 text-right text-[11px] text-slate-500">
          {detail}
        </span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [authState, setAuthState] = useState<AuthState>(
    isBackendConfigured ? "loading" : "signed-out",
  );
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [roles, setRoles] = useState<ReviewerRole[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [assignments, setAssignments] = useState<ReviewAssignment[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadDashboard = useCallback(async (currentUser: User) => {
    setDataLoading(true);
    setError(null);

    const [assessmentsResult, rolesResult, queueResult, assignmentsResult] =
      await Promise.all([
        backend.rpc<Assessment[]>("my_assessments"),
        backend.rpc<BriefRoles>("my_roles"),
        backend.rpc<QueueRow[]>("review_queue"),
        backend.rpc<ReviewAssignment[]>("my_review_assignments"),
      ]);

    const failures = [
      assessmentsResult.error &&
        `Could not load briefs: ${assessmentsResult.error.message}`,
      rolesResult.error && `Could not load roles: ${rolesResult.error.message}`,
      queueResult.error &&
        `Could not load review queue: ${queueResult.error.message}`,
      assignmentsResult.error &&
        `Could not load approval summaries: ${assignmentsResult.error.message}`,
    ].filter((message): message is string => Boolean(message));

    setDisplayName(
      (typeof currentUser.user_metadata.full_name === "string" &&
        currentUser.user_metadata.full_name) ||
        currentUser.email ||
        "Signed-in user",
    );
    setAssessments(assessmentsResult.data ?? []);
    setRoles(rolesResult.data?.roles ?? []);
    setIsAdmin(Boolean(rolesResult.data?.is_admin));
    setQueue(queueResult.data ?? []);
    // Already scoped to the caller's own briefs by the server.
    setAssignments(assignmentsResult.data ?? []);
    setError(failures.length ? failures.join(" ") : null);
    setDataLoading(false);
  }, []);

  useEffect(() => {
    let active = true;

    const loadForUser = async (nextUser: User | null) => {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) {
        setAuthState("signed-out");
        setDisplayName("");
        setAssessments([]);
        setRoles([]);
        setIsAdmin(false);
        setQueue([]);
        setAssignments([]);
        setDataLoading(false);
        return;
      }
      setAuthState("authenticated");
      await loadDashboard(nextUser);
    };

    void backend.auth
      .getSession()
      .then(({ data }) => loadForUser(data.session?.user ?? null));

    return () => {
      active = false;
    };
  }, [loadDashboard]);

  const assignmentStates = useMemo(() => {
    const byAssessment = new Map<string, Record<ReviewStage, string>>();
    for (const assessment of assessments) {
      byAssessment.set(assessment.id, { ...UNASSIGNED_STAGES });
    }
    for (const assignment of assignments) {
      if (!STAGES.includes(assignment.stage as ReviewStage)) continue;
      const states = byAssessment.get(assignment.assessment_id);
      if (states)
        states[assignment.stage as ReviewStage] = assignment.overridden_by
          ? "overridden"
          : assignment.state;
    }
    return byAssessment;
  }, [assessments, assignments]);

  const changesCount = assessments.filter((assessment) => {
    const states = assignmentStates.get(assessment.id);
    return (
      assessment.status === "draft" ||
      STAGES.some((stage) => states?.[stage] === "changes_requested")
    );
  }).length;
  const inReviewCount = assessments.filter(
    (assessment) => assessment.status === "in_review",
  ).length;
  const approvedCount = assessments.filter(
    (assessment) => assessment.status === "approved",
  ).length;

  const nearestDeadline = useMemo(
    () =>
      assessments
        .flatMap((assessment) =>
          deadlinesFor(assessment)
            .filter((deadline) => deadline.date.getTime() >= Date.now())
            .map((deadline) => ({ ...deadline, assessment })),
        )
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0],
    [assessments],
  );

  const filteredAssessments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return assessments.filter((assessment) => {
      const matchesStatus =
        statusFilter === "all" || assessment.status === statusFilter;
      const matchesSearch =
        !query ||
        assessment.module_code.toLocaleLowerCase().includes(query) ||
        assessment.title.toLocaleLowerCase().includes(query) ||
        assessment.academic_year.toLocaleLowerCase().includes(query) ||
        assessment.assessment_type.toLocaleLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [assessments, search, statusFilter]);

  const personalQueue = useMemo(
    () =>
      queue.filter(
        (row) =>
          row.can_review &&
          ["in_review", "approved"].includes(row.status) &&
          row.state !== "approved",
      ),
    [queue],
  );
  const completedReviewCount = queue.filter(
    (row) => row.can_review && row.state === "approved",
  ).length;
  const hasOversight =
    isAdmin || roles.some((role) => role.role === "teaching_director");
  const oversightCount = hasOversight
    ? queue.filter(
        (row) =>
          !row.can_review &&
          ["in_review", "approved"].includes(row.status) &&
          row.state !== "approved",
      ).length
    : 0;
  const hasWorkflowAccess = isAdmin || roles.length > 0;

  const briefStatusText = (assessment: Assessment) => {
    const states = assignmentStates.get(assessment.id);
    if (
      STAGES.some((stage) => states?.[stage] === "changes_requested")
    )
      return "Changes requested";
    if (assessment.status === "approved") {
      return STAGES.some((stage) => states?.[stage] === "overridden")
        ? "Ready to export (overridden)"
        : "Ready to export";
    }
    if (assessment.status === "in_review") {
      const approved = STAGES.filter(
        (stage) => states?.[stage] === "approved",
      ).length;
      return `${approved} of ${STAGES.length} approvals`;
    }
    return "Continue editing";
  };

  const signIn = async () => {
    setError(null);
    const { error: signInError } = await backend.auth.signInWithOAuth();
    if (signInError) setError(signInError.message);
  };

  const signOut = async () => {
    setError(null);
    const { error: signOutError } = await backend.auth.signOut();
    if (signOutError) setError(signOutError.message);
  };

  if (!isBackendConfigured) {
    return (
      <StatePage
        title="Dashboard unavailable"
        body="The assessment service could not be reached. Reload the page to try again."
      />
    );
  }

  if (authState === "loading") {
    return (
      <StatePage
        title="Checking your session"
        body="Loading your assessment workspace…"
      />
    );
  }

  if (authState === "signed-out" || !user) {
    return (
      <StatePage
        title="Sign in to your dashboard"
        body="Sign in to the marking site to manage briefs, approvals, and review tasks."
        error={error}
      >
        <button type="button" onClick={signIn} className="button-primary gap-2">
          Sign in
        </button>
      </StatePage>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <AppHeader
        eyebrow="Assessment brief management"
        title="Dashboard"
        subtitle={displayName || "Signed-in user"}
        actionsLabel="Dashboard actions"
        actions={
          <>
            <a href="./builder" className="button-primary min-h-9! px-3.5!">
              New brief
            </a>
            <a href="./builder" className="button-secondary min-h-9! px-3.5!">
              Builder
            </a>
            <button
              type="button"
              onClick={signOut}
              className="button-secondary min-h-9! px-3.5!"
            >
              Sign out
            </button>
          </>
        }
      />

      <div className="mx-auto max-w-360 space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        {error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadDashboard(user)}
              className="shrink-0 font-bold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}

        {nearestDeadline && (
          <section className="flex justify-end">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm sm:max-w-sm">
              <span className="text-xs font-semibold text-slate-500">
                Next deadline ·{" "}
              </span>
              <strong>{formatDate(nearestDeadline.date, true)}</strong>
              <span className="ml-1 text-slate-600">
                for {nearestDeadline.assessment.module_code}
              </span>
            </div>
          </section>
        )}

        <section
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          aria-label="Brief summary"
        >
          <SummaryCard
            label="My briefs"
            value={assessments.length}
            detail="Total owned"
          />
          <SummaryCard
            label="Drafts / changes"
            value={changesCount}
            detail="Need attention"
          />
          <SummaryCard
            label="In review"
            value={inReviewCount}
            detail="With reviewers"
          />
          <SummaryCard
            label="Approved"
            value={approvedCount}
            detail="Ready to use"
          />
        </section>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  My assessment briefs
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {dataLoading
                    ? "Loading briefs…"
                    : `${filteredAssessments.length} of ${assessments.length} shown`}
                </p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <label className="relative min-w-0 flex-1 sm:w-64">
                  <span className="sr-only">Search briefs</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-4-4" />
                  </svg>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search briefs"
                    className="h-9 w-full rounded-xl border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-100"
                  />
                </label>
                <label>
                  <span className="sr-only">Filter by status</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="h-9 rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-medium outline-none focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-100"
                  >
                    <option value="all">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="in_review">In review</option>
                    <option value="approved">Approved</option>
                  </select>
                </label>
              </div>
            </div>

            {dataLoading && assessments.length === 0 ? (
              <div className="space-y-3 p-5" aria-label="Loading briefs">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-20 animate-pulse rounded-xl bg-slate-100"
                  />
                ))}
              </div>
            ) : filteredAssessments.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-xl text-slate-500">
                  +
                </div>
                <h3 className="mt-3 text-sm font-semibold">
                  {assessments.length
                    ? "No briefs match your filters"
                    : "Create your first assessment brief"}
                </h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                  {assessments.length
                    ? "Try a different search or status."
                    : "Start in the builder, then save your brief to track it here."}
                </p>
                {!assessments.length && (
                  <a href="./builder" className="button-primary mt-4">
                    Create brief
                  </a>
                )}
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-225 border-collapse text-left">
                    <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-5 py-2.5">Brief</th>
                        <th className="px-3 py-2.5">Details</th>
                        <th className="px-3 py-2.5">Next deadline</th>
                        <th className="px-3 py-2.5">Workflow</th>
                        <th className="px-3 py-2.5">Approvals</th>
                        <th className="px-5 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAssessments.map((assessment) => {
                        const deadline = nextDeadline(assessment);
                        const states =
                          assignmentStates.get(assessment.id) ??
                          UNASSIGNED_STAGES;
                        return (
                          <tr
                            key={assessment.id}
                            className="hover:bg-slate-50/70"
                          >
                            <td className="max-w-72 px-5 py-3.5">
                              <p className="text-xs font-bold uppercase tracking-[0.08em] text-indigo-600">
                                {assessment.module_code}
                              </p>
                              <p
                                className="mt-0.5 truncate text-sm font-semibold"
                                title={assessment.title}
                              >
                                {assessment.title}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Updated {formatDate(assessment.updated_at)}
                              </p>
                            </td>
                            <td className="px-3 py-3.5 text-xs text-slate-600">
                              <p className="font-medium text-slate-800">
                                {assessment.academic_year}
                              </p>
                              <p className="mt-1">
                                {assessment.assessment_type} · v
                                {assessment.version}
                              </p>
                            </td>
                            <td className="px-3 py-3.5 text-xs">
                              {deadline ? (
                                <>
                                  <p className="font-semibold">
                                    {formatDate(deadline.date, true)}
                                  </p>
                                  <p className="mt-1 max-w-40 truncate text-slate-500">
                                    {deadline.description || "Submission"}
                                  </p>
                                </>
                              ) : (
                                <span className="text-slate-400">
                                  None upcoming
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3.5">
                              <StatusBadge status={assessment.status} />
                              <p className="mt-1.5 text-[11px] text-slate-500">
                                {briefStatusText(assessment)}
                              </p>
                            </td>
                            <td className="px-3 py-3.5">
                              <ApprovalIndicators states={states} />
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <a
                                href={`./builder?brief=${encodeURIComponent(assessment.id)}`}
                                className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                              >
                                Open / edit
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-slate-100 md:hidden">
                  {filteredAssessments.map((assessment) => {
                    const deadline = nextDeadline(assessment);
                    const states =
                      assignmentStates.get(assessment.id) ?? UNASSIGNED_STAGES;
                    return (
                      <article key={assessment.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">
                              {assessment.module_code}
                            </p>
                            <h3 className="mt-0.5 truncate text-sm font-semibold">
                              {assessment.title}
                            </h3>
                          </div>
                          <StatusBadge status={assessment.status} />
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          {assessment.academic_year} ·{" "}
                          {assessment.assessment_type} · v{assessment.version} ·
                          Updated {formatDate(assessment.updated_at)}
                        </p>
                        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <span className="font-semibold text-slate-700">
                            Next deadline:{" "}
                          </span>
                          <span className="text-slate-600">
                            {deadline
                              ? `${formatDate(deadline.date, true)}${deadline.description ? ` · ${deadline.description}` : ""}`
                              : "None upcoming"}
                          </span>
                        </div>
                        <div className="mt-3">
                          <ApprovalIndicators states={states} />
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-xs font-medium text-slate-500">
                            {briefStatusText(assessment)}
                          </span>
                          <a
                            href={`./builder?brief=${encodeURIComponent(assessment.id)}`}
                            className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white"
                          >
                            Open / edit
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <aside className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">
                    My review tasks
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {completedReviewCount} approved in your role pool
                    {completedReviewCount === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                  {personalQueue.length} open
                </span>
              </div>
              {dataLoading && queue.length === 0 ? (
                <div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100" />
              ) : personalQueue.length ? (
                <div className="mt-4 space-y-2.5">
                  {personalQueue.map((row) => (
                    <article
                      key={`${row.assessment_id}-${row.stage}`}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">
                            {row.module_code}
                          </p>
                          <h3 className="mt-0.5 truncate text-sm font-semibold">
                            {row.title}
                          </h3>
                        </div>
                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${REVIEW_STYLES[row.state] ?? REVIEW_STYLES.unassigned}`}
                          title={sentenceCase(row.state)}
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Owner: {row.owner_name} · v{row.assessment_version}
                      </p>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-slate-700">
                          {STAGE_LABELS[row.stage as ReviewStage] ??
                            sentenceCase(row.stage)}{" "}
                          · {sentenceCase(row.state)}
                        </span>
                        <a
                          href={`./review?assessment=${encodeURIComponent(row.assessment_id)}&stage=${encodeURIComponent(row.stage)}`}
                          className="text-xs font-bold text-indigo-700 hover:text-indigo-900"
                        >
                          Review →
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
                  <p className="text-sm font-semibold">You’re all caught up</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    No reviews available to your roles currently need action.
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="text-base font-semibold tracking-tight">
                My roles
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {roles.map((role) => (
                  <span
                    key={role.role}
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800"
                  >
                    {ROLE_LABELS[role.role] ?? sentenceCase(role.role)}
                  </span>
                ))}
                {isAdmin && (
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800">
                    Administrator
                  </span>
                )}
                {!roles.length && !isAdmin && (
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Standard user
                  </span>
                )}
              </div>
              {hasOversight && (
                <div className="mt-4 rounded-xl bg-slate-950 px-3.5 py-3 text-white">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Workflow oversight
                  </p>
                  <p className="mt-1 text-sm">
                    <strong>{oversightCount}</strong> review categor
                    {oversightCount === 1 ? "y" : "ies"} awaiting approval
                    outside your personal queue.
                  </p>
                </div>
              )}
              {(hasWorkflowAccess || isAdmin) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {hasWorkflowAccess && (
                    <a
                      href="./reviews"
                      className="button-secondary min-h-9! px-3.5!"
                    >
                      Review workspace
                    </a>
                  )}
                  {isAdmin && (
                    <a href="./admin" className="button-dark min-h-9! px-3.5!">
                      Administration
                    </a>
                  )}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
