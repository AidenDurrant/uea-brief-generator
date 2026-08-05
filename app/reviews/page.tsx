"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppHeader } from "@/app/components/app-header";

type QueueRow =
  Database["public"]["Functions"]["review_queue"]["Returns"][number];
type AuthState = "loading" | "signed-out" | "authenticated";
type JsonRecord = { [key: string]: Json | undefined };
type SubmissionDate = { date: string; description: string };

type AssessmentGroup = {
  assessmentId: string;
  title: string;
  moduleCode: string;
  ownerId: string;
  ownerName: string | null;
  version: number;
  status: string;
  submittedAt: string | null;
  updatedAt: string;
  content: Json;
  reviews: QueueRow[];
};

const CATEGORY_LABELS: Record<string, string> = {
  academic: "Academic assessment review",
  ai: "AI suitability",
  employability: "Employability skills",
};

const REVIEW_BADGES: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  changes_requested: "border-rose-200 bg-rose-50 text-rose-800",
};

const WORKFLOW_BADGES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-700",
  in_review: "border-blue-200 bg-blue-50 text-blue-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

function isRecord(value: Json | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayValue(value: Json | undefined): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function sentenceCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

function StatusBadge({
  state,
  workflow = false,
}: {
  state: string;
  workflow?: boolean;
}) {
  const styles = workflow ? WORKFLOW_BADGES : REVIEW_BADGES;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${
        styles[state] ?? "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {sentenceCase(state)}
    </span>
  );
}

function GitHubMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.39.97.1-.75.4-1.27.74-1.56-2.58-.29-5.29-1.29-5.29-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.72 5.38-5.31 5.67.42.36.79 1.07.79 2.16v3.2c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

function AuthMessage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-slate-950 px-5 py-12 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.24),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.16),transparent_30%)]" />
      <section className="relative w-full max-w-md rounded-4xl border border-white/10 bg-white/[0.07] p-8 text-center shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-10">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-white text-sm font-black tracking-wide text-slate-950 shadow-lg">
          UEA
        </div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">
          Assessment workflow
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-300">
          {body}
        </p>
        {children && <div className="mt-7 flex justify-center">{children}</div>}
        <a
          href="./"
          className="mt-7 inline-flex text-sm font-semibold text-slate-300 hover:text-white"
        >
          Back to dashboard
        </a>
      </section>
    </main>
  );
}

function BriefSummary({ content }: { content: Json }) {
  const root = isRecord(content) ? content : {};
  const formData = isRecord(root.formData) ? root.formData : {};
  const selectedSkills = Array.isArray(root.selectedSkills)
    ? root.selectedSkills.map((skill) => displayValue(skill)).filter(Boolean)
    : [];
  const submissionDates: SubmissionDate[] = Array.isArray(
    formData.submissionDates,
  )
    ? formData.submissionDates.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const date = displayValue(entry.date);
        if (!date) return [];
        return [{ date, description: displayValue(entry.description) }];
      })
    : [];

  const facts = [
    ["Programme", displayValue(formData.programme)],
    ["Academic year", displayValue(formData.academicYear)],
    ["Assessment type", displayValue(formData.assessmentType)],
    ["AI policy", displayValue(formData.aiPolicy)],
    ["Group work", displayValue(formData.groupWorkPermitted)],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));

  const sections = [
    ["Learning outcomes", displayValue(formData.learningOutcomes)],
    ["Core objectives", displayValue(formData.coreObjectives)],
  ].filter((section): section is [string, string] => Boolean(section[1]));

  return (
    <div className="space-y-5">
      {facts.length > 0 && (
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3"
            >
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                {label}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {sections.map(([label, value]) => (
          <section key={label}>
            <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              {label}
            </h3>
            <p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
              {value}
            </p>
          </section>
        ))}
      </div>

      {(selectedSkills.length > 0 || submissionDates.length > 0) && (
        <div className="grid gap-5 border-t border-slate-200 pt-5 lg:grid-cols-2">
          {selectedSkills.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Selected employability skills
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </section>
          )}
          {submissionDates.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Submission dates
              </h3>
              <ul className="mt-2 space-y-2">
                {submissionDates.map((submission, index) => (
                  <li
                    key={`${submission.date}-${index}`}
                    className="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm"
                  >
                    <span className="font-semibold text-slate-900">
                      {submission.description || `Submission ${index + 1}`}
                    </span>
                    <time className="text-slate-600">
                      {formatDate(submission.date, true)}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {facts.length === 0 &&
        sections.length === 0 &&
        selectedSkills.length === 0 &&
        submissionDates.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            No brief summary fields are available for this assessment version.
          </p>
        )}
    </div>
  );
}

function ReviewCard({
  row,
  assessmentStatus,
}: {
  row: QueueRow;
  assessmentStatus: string;
}) {
  const canReview = row.can_review;
  const needsAction =
    canReview &&
    ["in_review", "approved"].includes(assessmentStatus) &&
    row.state !== "approved";
  const href = `./review?assessment=${encodeURIComponent(row.assessment_id)}&category=${encodeURIComponent(row.category)}`;

  return (
    <article
      className={`rounded-2xl border p-4 ${
        needsAction
          ? "border-amber-200 bg-amber-50/60"
          : canReview
            ? "border-indigo-200 bg-indigo-50/35"
            : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
            {canReview ? "Available to your role" : "Oversight"}
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">
            {CATEGORY_LABELS[row.category] ?? sentenceCase(row.category)}
          </h3>
        </div>
        <StatusBadge state={row.state} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="text-slate-500">
          {row.reviewed_version == null
            ? needsAction
              ? "Action required"
              : "Not yet reviewed"
            : `Reviewed version ${row.reviewed_version}`}
        </span>
        {needsAction && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
        )}
      </div>

      {row.comment && (
        <p className="mt-3 line-clamp-2 rounded-lg bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">
          {row.comment}
        </p>
      )}

      <a
        href={href}
        className={`mt-4 flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-bold transition-colors ${
          needsAction
            ? "bg-slate-950 text-white hover:bg-slate-800"
            : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        <span>{needsAction ? "Open review" : "View assessment"}</span>
        <span aria-hidden="true">→</span>
      </a>
    </article>
  );
}

export default function ReviewsPage() {
  const [authState, setAuthState] = useState<AuthState>(
    isSupabaseConfigured ? "loading" : "signed-out",
  );
  const [user, setUser] = useState<User | null>(null);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const client = supabase;
    if (!client) return false;
    setQueueLoading(true);
    setError(null);
    const { data, error: queueError } = await client.rpc("review_queue");
    setQueueLoading(false);
    if (queueError) {
      setRows([]);
      setError(queueError.message);
      return false;
    }
    setRows(data ?? []);
    return true;
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    const loadForUser = async (nextUser: User | null) => {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) {
        setRows([]);
        setAuthState("signed-out");
        setQueueLoading(false);
        return;
      }
      setAuthState("authenticated");
      await loadQueue();
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
  }, [loadQueue]);

  const groups = useMemo(() => {
    const grouped = new Map<string, AssessmentGroup>();
    for (const row of rows) {
      const existing = grouped.get(row.assessment_id);
      if (existing) {
        existing.reviews.push(row);
      } else {
        grouped.set(row.assessment_id, {
          assessmentId: row.assessment_id,
          title: row.title,
          moduleCode: row.module_code,
          ownerId: row.owner_id,
          ownerName: row.owner_name,
          version: row.assessment_version,
          status: row.status,
          submittedAt: row.submitted_at,
          updatedAt: row.updated_at,
          content: row.content,
          reviews: [row],
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [rows]);

  const availableCount = rows.filter((row) => row.can_review).length;
  const pendingCount = rows.filter(
    (row) =>
      row.can_review &&
      row.state !== "approved" &&
      ["in_review", "approved"].includes(row.status),
  ).length;

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
      <AuthMessage
        title="Supabase setup required"
        body="Add the Supabase environment variables before using the reviewer dashboard."
      />
    );
  }

  if (authState === "loading") {
    return (
      <AuthMessage
        title="Checking your session"
        body="Loading your reviewer access…"
      />
    );
  }

  if (authState === "signed-out" || !user) {
    return (
      <AuthMessage
        title="Reviewer sign in"
        body="Sign in with your approved GitHub account to open your review queue."
      >
        <button type="button" onClick={signIn} className="button-primary gap-2">
          <GitHubMark />
          Sign in with GitHub
        </button>
      </AuthMessage>
    );
  }

  const displayName =
    (typeof user.user_metadata.full_name === "string" &&
      user.user_metadata.full_name) ||
    (typeof user.user_metadata.user_name === "string" &&
      user.user_metadata.user_name) ||
    user.email ||
    "Signed-in reviewer";

  return (
    <main className="min-h-screen bg-[#f4f6fa] text-slate-950">
      <AppHeader
        eyebrow="Assessment brief management"
        title="Reviewer dashboard"
        subtitle={displayName}
        actionsLabel="Reviewer dashboard actions"
        actions={
          <>
            <a href="./" className="button-primary">
              My dashboard
            </a>
            <a href="./builder" className="button-secondary">
              Builder
            </a>
            <button
              type="button"
              onClick={signOut}
              className="button-secondary"
            >
              Sign out
            </button>
          </>
        }
      />

      <div className="mx-auto max-w-360 space-y-6 px-4 py-6 sm:px-8 lg:py-9">
        <section className="overflow-hidden rounded-[1.75rem] bg-slate-950 px-5 py-6 text-white shadow-xl shadow-slate-900/10 sm:px-8 sm:py-8">
          <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">
                Quality assurance
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Assessment review queue
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">
                Review the key brief details, record decisions available to your
                role, and monitor assessment progress.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                ["Assessments", groups.length],
                ["Available to you", availableCount],
                ["Need attention", pendingCount],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-3 sm:min-w-28 sm:px-4"
                >
                  <dt className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {label}
                  </dt>
                  <dd className="mt-1 text-xl font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <aside className="flex gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 text-sm leading-6 text-indigo-950 sm:px-5">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <p>
            <strong>Version-aware reviews:</strong> any edit by the assessment
            creator invalidates existing approvals and creates a new draft
            version. Review the displayed version before recording a decision.
          </p>
        </aside>

        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="font-bold underline decoration-rose-300 underline-offset-4"
            >
              Try again
            </button>
          </div>
        )}

        {queueLoading && groups.length === 0 ? (
          <section className="panel grid min-h-72 place-items-center p-8 text-center">
            <div>
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
              <p className="mt-4 text-sm font-semibold text-slate-700">
                Loading review queue…
              </p>
            </div>
          </section>
        ) : groups.length === 0 && !error ? (
          <section className="panel grid min-h-72 place-items-center p-8 text-center">
            <div className="max-w-md">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <svg
                  className="h-6 w-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </div>
              <h2 className="mt-4 text-xl font-semibold">
                Your queue is clear
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                There are no assessments available to your reviewer roles or
                oversight access right now.
              </p>
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <article
                key={group.assessmentId}
                className="panel overflow-hidden"
              >
                <header className="border-b border-slate-200 bg-linear-to-r from-white to-slate-50 px-4 py-5 sm:px-6 lg:px-7">
                  <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-slate-950 px-2.5 py-1 text-xs font-black tracking-wide text-white">
                          {group.moduleCode}
                        </span>
                        <StatusBadge state={group.status} workflow />
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600">
                          Version {group.version}
                        </span>
                      </div>
                      <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
                        {group.title}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-600">
                        Owned by{" "}
                        <span className="font-semibold text-slate-800">
                          {group.ownerName || "Unknown owner"}
                        </span>
                      </p>
                    </div>
                    <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-sm lg:text-right">
                      <div>
                        <dt className="text-xs text-slate-500">Submitted</dt>
                        <dd className="mt-0.5 font-semibold text-slate-800">
                          {formatDate(group.submittedAt, true)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Categories</dt>
                        <dd className="mt-0.5 font-semibold text-slate-800">
                          {group.reviews.length}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </header>

                <div className="px-4 py-4 sm:px-6 lg:px-7">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-600">
                        Review status and to-dos
                      </p>
                      <h3 className="mt-0.5 text-sm font-semibold text-slate-800">
                        Open a category to inspect the complete brief and record
                        a decision
                      </h3>
                    </div>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-3">
                    {group.reviews.map((row) => (
                      <ReviewCard
                        key={`${row.assessment_id}:${row.category}`}
                        row={row}
                        assessmentStatus={group.status}
                      />
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
