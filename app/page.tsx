"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import type { Assessment, Database, Json } from "@/lib/database.types";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppHeader } from "@/app/components/app-header";

type AuthState = "loading" | "signed-out" | "authenticated";
type QueueRow =
  Database["public"]["Functions"]["review_queue"]["Returns"][number];
type ReviewerRole = Database["public"]["Tables"]["reviewer_roles"]["Row"];
type ReviewAssignment =
  Database["public"]["Tables"]["assessment_review_assignments"]["Row"];
type JsonRecord = { [key: string]: Json | undefined };
type ReviewCategory = "academic" | "ai" | "employability";
type Deadline = { date: Date; description: string };

const CATEGORIES: ReviewCategory[] = ["academic", "ai", "employability"];
const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  academic: "Academic",
  ai: "AI",
  employability: "Employability",
};
const ROLE_LABELS: Record<string, string> = {
  cluster_lead: "Cluster Lead",
  ai_reviewer: "AI Suitability Reviewer",
  employability_reviewer: "Employability Skills Reviewer",
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
  if (!isRecord(formData) || !Array.isArray(formData.submissionDates))
    return [];

  return formData.submissionDates
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const rawDate = text(entry.date);
      if (!rawDate) return [];
      const date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) return [];
      return [{ date, description: text(entry.description) }];
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function nextDeadline(assessment: Assessment) {
  const now = Date.now();
  return deadlinesFor(assessment).find(
    (deadline) => deadline.date.getTime() >= now,
  );
}

function GitHubMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.39.97.1-.75.4-1.27.74-1.56-2.58-.29-5.29-1.29-5.29-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.72 5.38-5.31 5.67.42.36.79 1.07.79 2.16v3.2c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
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
  states: Record<ReviewCategory, string>;
}) {
  return (
    <div
      className="flex flex-wrap gap-x-3 gap-y-1.5"
      aria-label="Approval states"
    >
      {CATEGORIES.map((category) => {
        const state = states[category];
        return (
          <span
            key={category}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600"
            title={`${CATEGORY_LABELS[category]}: ${sentenceCase(state)}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${REVIEW_STYLES[state] ?? REVIEW_STYLES.unassigned}`}
            />
            {CATEGORY_LABELS[category]}
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
    isSupabaseConfigured ? "loading" : "signed-out",
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
    const client = supabase;
    if (!client) return;
    setDataLoading(true);
    setError(null);

    const [
      profileResult,
      assessmentsResult,
      rolesResult,
      adminResult,
      queueResult,
      assignmentsResult,
    ] = await Promise.all([
      client
        .from("profiles")
        .select("display_name")
        .eq("user_id", currentUser.id)
        .maybeSingle(),
      client
        .from("assessments")
        .select("*")
        .eq("owner_id", currentUser.id)
        .order("updated_at", { ascending: false }),
      client.from("reviewer_roles").select("*").eq("user_id", currentUser.id),
      client
        .from("admin_users")
        .select("user_id")
        .eq("user_id", currentUser.id)
        .maybeSingle(),
      client.rpc("review_queue"),
      client.from("assessment_review_assignments").select("*"),
    ]);

    const failures = [
      profileResult.error &&
        `Could not load profile: ${profileResult.error.message}`,
      assessmentsResult.error &&
        `Could not load briefs: ${assessmentsResult.error.message}`,
      rolesResult.error && `Could not load roles: ${rolesResult.error.message}`,
      adminResult.error &&
        `Could not load administrator access: ${adminResult.error.message}`,
      queueResult.error &&
        `Could not load review queue: ${queueResult.error.message}`,
      assignmentsResult.error &&
        `Could not load approval summaries: ${assignmentsResult.error.message}`,
    ].filter((message): message is string => Boolean(message));

    const fallbackName =
      (typeof currentUser.user_metadata.full_name === "string" &&
        currentUser.user_metadata.full_name) ||
      (typeof currentUser.user_metadata.user_name === "string" &&
        currentUser.user_metadata.user_name) ||
      currentUser.email ||
      "Signed-in user";

    setDisplayName(profileResult.data?.display_name || fallbackName);
    setAssessments(assessmentsResult.data ?? []);
    setRoles(rolesResult.data ?? []);
    setIsAdmin(Boolean(adminResult.data));
    setQueue(queueResult.data ?? []);

    const ownAssessmentIds = new Set(
      (assessmentsResult.data ?? []).map((assessment) => assessment.id),
    );
    setAssignments(
      (assignmentsResult.data ?? []).filter((assignment) =>
        ownAssessmentIds.has(assignment.assessment_id),
      ),
    );
    setError(failures.length ? failures.join(" ") : null);
    setDataLoading(false);
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
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

    void client.auth
      .getSession()
      .then(({ data }) => loadForUser(data.session?.user ?? null));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => void loadForUser(session?.user ?? null), 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadDashboard]);

  const assignmentStates = useMemo(() => {
    const byAssessment = new Map<string, Record<ReviewCategory, string>>();
    for (const assessment of assessments) {
      byAssessment.set(assessment.id, {
        academic: "unassigned",
        ai: "unassigned",
        employability: "unassigned",
      });
    }
    for (const assignment of assignments) {
      if (!CATEGORIES.includes(assignment.category as ReviewCategory)) continue;
      const states = byAssessment.get(assignment.assessment_id);
      if (states)
        states[assignment.category as ReviewCategory] = assignment.state;
    }
    return byAssessment;
  }, [assessments, assignments]);

  const changesCount = assessments.filter((assessment) => {
    const states = assignmentStates.get(assessment.id);
    return (
      assessment.status === "draft" ||
      CATEGORIES.some((category) => states?.[category] === "changes_requested")
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
      CATEGORIES.some((category) => states?.[category] === "changes_requested")
    )
      return "Changes requested";
    if (assessment.status === "approved") return "Ready to export";
    if (assessment.status === "in_review") {
      const approved = CATEGORIES.filter(
        (category) => states?.[category] === "approved",
      ).length;
      return `${approved} of 3 approvals`;
    }
    return "Continue editing";
  };

  const signIn = async () => {
    if (!supabase) return;
    setError(null);
    const redirectTo = window.location.href.split(/[?#]/)[0];
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo },
    });
    if (signInError) setError(signInError.message);
  };

  const signOut = async () => {
    setError(null);
    const { error: signOutError } = (await supabase?.auth.signOut()) ?? {
      error: null,
    };
    if (signOutError) setError(signOutError.message);
  };

  if (!isSupabaseConfigured) {
    return (
      <StatePage
        title="Supabase setup required"
        body="Add the Supabase environment variables before opening your signed-in dashboard."
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
        body="Use your GitHub account to manage briefs, approvals, and review tasks."
        error={error}
      >
        <button type="button" onClick={signIn} className="button-primary gap-2">
          <GitHubMark />
          Sign in with GitHub
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
                        const states = assignmentStates.get(assessment.id) ?? {
                          academic: "unassigned",
                          ai: "unassigned",
                          employability: "unassigned",
                        };
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
                    const states = assignmentStates.get(assessment.id) ?? {
                      academic: "unassigned",
                      ai: "unassigned",
                      employability: "unassigned",
                    };
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
                      key={`${row.assessment_id}-${row.category}`}
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
                          {CATEGORY_LABELS[row.category as ReviewCategory] ??
                            sentenceCase(row.category)}{" "}
                          · {sentenceCase(row.state)}
                        </span>
                        <a
                          href={`./review?assessment=${encodeURIComponent(row.assessment_id)}&category=${encodeURIComponent(row.category)}`}
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
