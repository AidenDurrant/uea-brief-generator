"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { Database, Json } from "@/lib/database.types";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppHeader } from "@/app/components/app-header";

type QueueRow =
  Database["public"]["Functions"]["review_queue"]["Returns"][number];
type AuthState = "loading" | "signed-out" | "authenticated";
type ReviewCategory = "academic" | "ai" | "employability";
type JsonRecord = { [key: string]: Json | undefined };

const CATEGORIES: ReviewCategory[] = ["academic", "ai", "employability"];
const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  academic: "Academic",
  ai: "AI suitability",
  employability: "Employability",
};
const CATEGORY_DESCRIPTIONS: Record<ReviewCategory, string> = {
  academic: "Academic assessment review",
  ai: "AI policy suitability",
  employability: "Employability skills review",
};
const CONTENT_SECTIONS = [
  ["contextScenario", "Context & scenario"],
  ["learningOutcomes", "Learning outcomes assessed"],
  ["coreObjectives", "Task specification / core objectives"],
  ["architectureConstraints", "Architecture & technical constraints"],
  ["deliverables", "Deliverables"],
  ["submissionInstructions", "Submission instructions"],
  ["resourcesHints", "Resources & hints"],
  ["contactInfo", "Contact information"],
  ["markingScheme", "Marking scheme"],
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REVIEW_BADGES: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  changes_requested: "border-rose-200 bg-rose-50 text-rose-800",
  unassigned: "border-slate-200 bg-slate-100 text-slate-600",
  unavailable: "border-slate-200 bg-white text-slate-500",
};
const WORKFLOW_BADGES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-700",
  in_review: "border-blue-200 bg-blue-50 text-blue-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  changes_requested: "border-rose-200 bg-rose-50 text-rose-800",
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseContent(content: Json): JsonRecord {
  let value: unknown = content;
  for (
    let attempt = 0;
    attempt < 2 && typeof value === "string";
    attempt += 1
  ) {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function text(value: Json | undefined): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function booleanLabel(value: Json | undefined): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const displayed = text(value);
  return displayed || "Not provided";
}

function sentenceCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "Not recorded";
  if (!includeTime && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
      new Date(year, month - 1, day),
    );
  }
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
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${
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

function StatePage({
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
          Assessment review
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-300">
          {body}
        </p>
        {children && (
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {children}
          </div>
        )}
        <div className="mt-7 flex justify-center gap-5 text-sm font-semibold text-slate-300">
          <a href="./reviews" className="hover:text-white">
            Review dashboard
          </a>
          <a href="./builder" className="hover:text-white">
            Brief builder
          </a>
        </div>
      </section>
    </main>
  );
}

function SectionCard({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/2.5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">
          {number}
        </span>
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ReadOnlyValue({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-1.5 min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium leading-5 text-slate-800">
        {value || (
          <span className="font-normal text-slate-400">Not provided</span>
        )}
      </dd>
    </div>
  );
}

function Markdown({ content }: { content: string }) {
  if (!content) {
    return (
      <p className="text-sm italic text-slate-400">
        Not included in this version.
      </p>
    );
  }
  return (
    <div className="markdown-content min-w-0 text-sm leading-6 text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          h1: ({ children }) => (
            <h3 className="mb-2 mt-4 text-lg font-bold text-slate-900">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-4 text-base font-bold text-slate-900">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 text-sm font-bold text-slate-900">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-indigo-700 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-500"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-4 border-indigo-200 bg-indigo-50/60 px-4 py-2 text-slate-600">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => (
            <code
              className={
                className ??
                "rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-slate-800"
              }
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full min-w-120 border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-slate-300 bg-slate-100 px-3 py-2 font-bold text-slate-800">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-200 px-3 py-2 align-top">
              {children}
            </td>
          ),
          img: ({ src, alt }) => (
            <span className="my-2 inline-flex rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Attachment reference:{" "}
              {alt ||
                (typeof src === "string"
                  ? src.replace(/^attachment:/, "")
                  : "image")}
            </span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ContentSection({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600">
          {label}
        </h3>
      </header>
      <div className="min-w-0 px-4 py-4">
        <Markdown content={content} />
      </div>
    </article>
  );
}

function reviewerLabel(row: QueueRow, user: User) {
  if (!row.reviewer_id) return "Not yet reviewed";
  if (row.reviewer_id === user.id) {
    const metadataName =
      (typeof user.user_metadata.full_name === "string" &&
        user.user_metadata.full_name) ||
      (typeof user.user_metadata.user_name === "string" &&
        user.user_metadata.user_name) ||
      user.email;
    return metadataName ? `${metadataName} (you)` : "You";
  }
  return `Reviewer · ${row.reviewer_id.slice(0, 8)}…`;
}

export default function ReviewPage() {
  const [queryReady, setQueryReady] = useState(false);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [requestedCategory, setRequestedCategory] =
    useState<ReviewCategory | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<ReviewCategory>("academic");
  const [authState, setAuthState] = useState<AuthState>(
    isSupabaseConfigured ? "loading" : "signed-out",
  );
  const [user, setUser] = useState<User | null>(null);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedAssessment = params.get("assessment")?.trim() ?? "";
    const category = params.get("category");
    setAssessmentId(
      UUID_PATTERN.test(requestedAssessment) ? requestedAssessment : null,
    );
    setRequestedCategory(
      CATEGORIES.includes(category as ReviewCategory)
        ? (category as ReviewCategory)
        : null,
    );
    setQueryReady(true);
  }, []);

  const loadQueue = useCallback(async () => {
    const client = supabase;
    if (!client) return false;
    setQueueLoading(true);
    setError(null);
    const { data, error: queueError } = await client.rpc("review_queue");
    setQueueLoading(false);
    setQueueLoaded(true);
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
      setNotice(null);
      if (!nextUser) {
        setRows([]);
        setAuthState("signed-out");
        setQueueLoading(false);
        setQueueLoaded(false);
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

  const assessmentRows = useMemo(
    () =>
      assessmentId
        ? rows
            .filter((row) => row.assessment_id === assessmentId)
            .sort(
              (a, b) =>
                CATEGORIES.indexOf(a.category as ReviewCategory) -
                CATEGORIES.indexOf(b.category as ReviewCategory),
            )
        : [],
    [assessmentId, rows],
  );

  useEffect(() => {
    if (!queryReady || !queueLoaded || !user || assessmentRows.length === 0)
      return;
    if (requestedCategory) {
      setSelectedCategory(requestedCategory);
      return;
    }
    const available = assessmentRows.find((row) => row.can_review);
    const first = available?.category ?? assessmentRows[0]?.category;
    if (CATEGORIES.includes(first as ReviewCategory)) {
      setSelectedCategory(first as ReviewCategory);
    }
  }, [assessmentRows, queryReady, queueLoaded, requestedCategory, user]);

  const selectedRow = assessmentRows.find(
    (row) => row.category === selectedCategory,
  );
  const assessment = assessmentRows[0];
  const root = assessment ? parseContent(assessment.content) : {};
  const formData = isRecord(root.formData) ? root.formData : {};
  const selectedSkills = Array.isArray(root.selectedSkills)
    ? root.selectedSkills.map((skill) => text(skill)).filter(Boolean)
    : [];
  const coTaughtModules = Array.isArray(formData.coTaughtModules)
    ? formData.coTaughtModules.filter(isRecord)
    : [];
  const submissionDates = Array.isArray(formData.submissionDates)
    ? formData.submissionDates.filter(isRecord)
    : [];
  const rubricRows = Array.isArray(root.rubricRows)
    ? root.rubricRows.filter(isRecord)
    : [];

  const chooseCategory = (category: ReviewCategory) => {
    setSelectedCategory(category);
    setComment("");
    setValidationError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("category", category);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  };

  const signIn = async () => {
    if (!supabase) return;
    setError(null);
    const url = new URL(window.location.href);
    url.hash = "";
    const requestedAssessment = url.searchParams.get("assessment") ?? "";
    const category = url.searchParams.get("category");
    if (!UUID_PATTERN.test(requestedAssessment))
      url.searchParams.delete("assessment");
    if (!CATEGORIES.includes(category as ReviewCategory))
      url.searchParams.delete("category");
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: url.toString() },
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

  const recordDecision = async (decision: "approve" | "withdraw") => {
    if (!supabase || !user || !selectedRow || !selectedRow.can_review) return;
    const reviewComment = comment.trim();
    if (decision === "withdraw" && reviewComment.length < 2) {
      setValidationError(
        "Enter at least 2 characters explaining the requested change or withdrawal.",
      );
      return;
    }
    setValidationError(null);
    setSaving(true);
    setError(null);
    setNotice(null);
    const { error: reviewError } = await supabase.rpc(
      "record_assessment_review",
      {
        target_assessment_id: selectedRow.assessment_id,
        target_category: selectedRow.category,
        decision,
        review_comment: reviewComment || null,
      },
    );
    if (reviewError) {
      setError(reviewError.message);
      setSaving(false);
      return;
    }
    const reloaded = await loadQueue();
    setSaving(false);
    if (reloaded) {
      setComment("");
      setNotice(
        decision === "approve"
          ? `${CATEGORY_LABELS[selectedCategory]} review approved.`
          : "Changes requested and the approval withdrawn.",
      );
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <StatePage
        title="Supabase setup required"
        body="Add the Supabase environment variables before opening an assessment review."
      />
    );
  }

  if (!queryReady || authState === "loading") {
    return (
      <StatePage
        title="Checking your access"
        body="Loading the requested assessment review…"
      />
    );
  }

  if (authState === "signed-out" || !user) {
    return (
      <StatePage
        title="Reviewer sign in"
        body="Sign in with your approved GitHub account to view this assessment."
      >
        <button type="button" onClick={signIn} className="button-primary gap-2">
          <GitHubMark />
          Sign in with GitHub
        </button>
        {error && (
          <p role="alert" className="w-full text-sm text-rose-300">
            {error}
          </p>
        )}
      </StatePage>
    );
  }

  if (!assessmentId) {
    return (
      <StatePage
        title="Assessment not specified"
        body="This review link is missing a valid assessment identifier. Open an assessment from the review dashboard."
      />
    );
  }

  if ((queueLoading && !queueLoaded) || (!queueLoaded && !error)) {
    return (
      <StatePage
        title="Loading assessment"
        body="Checking the review queue and your access…"
      />
    );
  }

  if (!assessment) {
    return (
      <StatePage
        title={error ? "Unable to load assessment" : "Assessment unavailable"}
        body={
          error
            ? error
            : "The assessment could not be found in your review queue. It may not exist, may no longer be in review, or you may not be authorised to view it."
        }
      >
        {error && (
          <button
            type="button"
            onClick={() => void loadQueue()}
            className="button-secondary"
          >
            Try again
          </button>
        )}
      </StatePage>
    );
  }

  const canAct =
    selectedRow?.can_review &&
    ["in_review", "approved"].includes(assessment.status);
  const isApproved = selectedRow?.state === "approved";
  const gradingScheme = text(formData.gradingScheme) || "UG";
  const gradeBands =
    gradingScheme === "PGT"
      ? [
          ["fail", "Fail", "<50%"],
          ["twoTwo", "Pass", "50–59%"],
          ["twoOne", "Merit", "60–69%"],
          ["first", "Distinction", "70–84%"],
          ["excelled", "Exceptional", "85%+"],
        ]
      : [
          ["fail", "Fail", "<40%"],
          ["pass", "Pass", "40–49%"],
          ["twoTwo", "2:2", "50–59%"],
          ["twoOne", "2:1", "60–69%"],
          ["first", "1st", "70–84%"],
          ["excelled", "Excelled", "85%+"],
        ];

  return (
    <main className="min-h-screen bg-[#f4f5f8] text-slate-950">
      <AppHeader
        eyebrow="Assessment brief management"
        title="Read-only assessment review"
        subtitle={`${assessment.module_code} · ${assessment.owner_name || "Unknown owner"}`}
        maxWidthClass="max-w-400"
        actionsLabel="Assessment review actions"
        actions={
          <>
            <a href="./reviews" className="button-primary">
              Review dashboard
            </a>
            <a href="./" className="button-secondary">
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

      <div className="mx-auto max-w-400 px-4 py-5 sm:px-7 lg:py-8">
        <div className="mb-5 overflow-hidden rounded-3xl bg-slate-950 px-5 py-6 text-white shadow-xl shadow-slate-900/10 sm:px-7">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-black tracking-wide text-white">
                  {assessment.module_code}
                </span>
                <StatusBadge state={assessment.status} workflow />
                <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                  Version {assessment.assessment_version}
                </span>
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                {text(formData.module) || assessment.title}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                Read-only brief submitted by{" "}
                <span className="font-semibold text-white">
                  {assessment.owner_name || "Unknown owner"}
                </span>
              </p>
            </div>
            <p className="shrink-0 text-xs font-medium text-slate-400">
              No PDF preview · Reviewing saved content
            </p>
          </div>
        </div>

        {(error || notice) && (
          <div className="mb-5 space-y-3">
            {error && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => void loadQueue()}
                  className="font-bold underline underline-offset-4"
                >
                  Reload
                </button>
              </div>
            )}
            {notice && (
              <div
                role="status"
                className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
              >
                {notice}
              </div>
            )}
          </div>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.85fr)_minmax(20rem,1fr)] xl:gap-7">
          <div className="min-w-0 space-y-5">
            <SectionCard number={1} title="Header Details">
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <ReadOnlyValue label="School" value={text(formData.school)} />
                <ReadOnlyValue
                  label="Programme"
                  value={text(formData.programme)}
                />
                <ReadOnlyValue
                  label="Academic year"
                  value={text(formData.academicYear)}
                />
                <ReadOnlyValue
                  label="Module / title"
                  value={text(formData.module) || assessment.title}
                  className="sm:col-span-2"
                />
                <ReadOnlyValue
                  label="Weighting"
                  value={text(formData.weighting)}
                />
                <ReadOnlyValue
                  label="Set / checked by"
                  value={text(formData.setBy)}
                />
                <ReadOnlyValue
                  label="Release date"
                  value={formatDate(text(formData.releaseDate))}
                />
                <ReadOnlyValue
                  label="Submission location"
                  value={text(formData.submissionLocation)}
                />
                <ReadOnlyValue
                  label="Return of feedback"
                  value={text(formData.returnOfFeedback)}
                />
              </dl>

              <div className="mt-5 border-t border-slate-100 pt-5">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Submission / exam dates
                </h3>
                {submissionDates.length > 0 ? (
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {submissionDates.map((entry, index) => (
                      <li
                        key={`${text(entry.date)}-${index}`}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm"
                      >
                        <p className="font-semibold text-slate-800">
                          {text(entry.description) || `Submission ${index + 1}`}
                        </p>
                        <time className="mt-1 block text-xs text-slate-500">
                          {formatDate(text(entry.date), true)}
                        </time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm italic text-slate-400">
                    No submission dates recorded.
                  </p>
                )}
              </div>

              {coTaughtModules.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Co-taught module weightings
                  </h3>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                    {coTaughtModules.map((entry, index) => (
                      <div
                        key={`${text(entry.module)}-${index}`}
                        className="flex justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm"
                      >
                        <dt className="font-semibold text-slate-800">
                          {text(entry.module) || `Module ${index + 1}`}
                        </dt>
                        <dd className="text-slate-600">
                          {text(entry.weighting) || "Not provided"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </SectionCard>

            <SectionCard number={2} title="Assessment Setup">
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <ReadOnlyValue
                  label="Assessment type"
                  value={text(formData.assessmentType)}
                />
                <ReadOnlyValue label="Grading scheme" value={gradingScheme} />
                <ReadOnlyValue
                  label="Group work permitted"
                  value={booleanLabel(formData.groupWorkPermitted)}
                />
                {text(formData.assessmentType) === "Other" && (
                  <ReadOnlyValue
                    label="Custom assessment"
                    value={text(formData.customAssessmentName)}
                  />
                )}
                {text(formData.groupWorkPermitted).toLowerCase() === "yes" && (
                  <ReadOnlyValue
                    label="Group size"
                    value={text(formData.groupSize)}
                  />
                )}
              </dl>
              {text(formData.customAssessmentDesc) && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <Markdown content={text(formData.customAssessmentDesc)} />
                </div>
              )}
              {text(formData.groupMechanics) && (
                <div className="mt-4">
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Group mechanics
                  </h3>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <Markdown content={text(formData.groupMechanics)} />
                  </div>
                </div>
              )}
            </SectionCard>

            <SectionCard number={3} title="Generative AI Policy">
              <div
                className={`rounded-2xl border p-4 ${text(formData.aiPolicy) === "RED" ? "border-rose-200 bg-rose-50" : text(formData.aiPolicy) === "AMBER" ? "border-amber-200 bg-amber-50" : text(formData.aiPolicy) === "GREEN" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
              >
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Traffic-light classification
                </p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {text(formData.aiPolicy) || "Not provided"}
                </p>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {text(formData.aiAmberPermitted) && (
                  <ContentSection
                    label="Permitted uses"
                    content={text(formData.aiAmberPermitted)}
                  />
                )}
                {text(formData.aiAmberProhibited) && (
                  <ContentSection
                    label="Prohibited uses"
                    content={text(formData.aiAmberProhibited)}
                  />
                )}
                {text(formData.aiGreenPermitted) && (
                  <ContentSection
                    label="Permitted uses"
                    content={text(formData.aiGreenPermitted)}
                  />
                )}
              </div>
            </SectionCard>

            <SectionCard number={4} title="Employability Skills">
              {selectedSkills.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm italic text-slate-400">
                  No employability skills selected.
                </p>
              )}
            </SectionCard>

            <SectionCard number={5} title="Content Specifications">
              <div className="space-y-4">
                {CONTENT_SECTIONS.map(([key, label]) => (
                  <ContentSection
                    key={key}
                    label={label}
                    content={text(formData[key])}
                  />
                ))}
              </div>
            </SectionCard>

            <SectionCard number={6} title="Grading Matrix">
              {rubricRows.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-240 border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="sticky left-0 z-10 min-w-44 border-b border-r border-slate-200 bg-slate-100 px-3 py-3 font-bold">
                          Component
                        </th>
                        <th className="min-w-20 border-b border-r border-slate-200 px-3 py-3 font-bold">
                          Weight
                        </th>
                        {gradeBands.map(([key, label, range]) => (
                          <th
                            key={key}
                            className="min-w-48 border-b border-r border-slate-200 px-3 py-3 font-bold last:border-r-0"
                          >
                            {label}
                            <span className="mt-0.5 block font-normal text-slate-500">
                              {range}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rubricRows.map((row, index) => (
                        <tr
                          key={`${text(row.component)}-${index}`}
                          className="align-top even:bg-slate-50/60"
                        >
                          <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-3 font-semibold text-slate-900">
                            {text(row.component) || `Component ${index + 1}`}
                          </th>
                          <td className="border-b border-r border-slate-200 px-3 py-3 font-semibold text-slate-700">
                            {text(row.weight) || "—"}
                          </td>
                          {gradeBands.map(([key]) => (
                            <td
                              key={key}
                              className="border-b border-r border-slate-200 px-3 py-3 leading-5 text-slate-600 last:border-r-0"
                            >
                              <Markdown content={text(row[key])} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm italic text-slate-400">
                  No grading matrix included in this version.
                </p>
              )}
            </SectionCard>
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">
                    Review details
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    Assessment workflow
                  </h2>
                </div>
                <StatusBadge state={assessment.status} workflow />
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-xs">
                <div>
                  <dt className="text-slate-500">Version</dt>
                  <dd className="mt-1 font-semibold text-slate-800">
                    {assessment.assessment_version}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Owner</dt>
                  <dd className="mt-1 font-semibold text-slate-800">
                    {assessment.owner_name || "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Submitted</dt>
                  <dd className="mt-1 font-semibold text-slate-800">
                    {formatDate(assessment.submitted_at, true)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Updated</dt>
                  <dd className="mt-1 font-semibold text-slate-800">
                    {formatDate(assessment.updated_at, true)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <header className="border-b border-slate-200 px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">
                  Category status
                </p>
                <h2 className="mt-1 text-base font-semibold">
                  Three-part review
                </h2>
              </header>
              <div className="divide-y divide-slate-100">
                {CATEGORIES.map((category) => {
                  const row = assessmentRows.find(
                    (item) => item.category === category,
                  );
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => chooseCategory(category)}
                      aria-pressed={selectedCategory === category}
                      className={`flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50 ${selectedCategory === category ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-slate-800">
                          {CATEGORY_LABELS[category]}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {row
                            ? row.can_review
                              ? "Available to your role"
                              : "Oversight view"
                            : "Not available in your queue"}
                        </span>
                      </span>
                      <StatusBadge state={row?.state ?? "unavailable"} />
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">
                    Selected category
                  </p>
                  <h2 className="mt-1 text-base font-semibold">
                    {CATEGORY_DESCRIPTIONS[selectedCategory]}
                  </h2>
                </div>
                <StatusBadge state={selectedRow?.state ?? "unavailable"} />
              </div>

              {selectedRow ? (
                <>
                  <dl className="mt-5 space-y-3 text-xs">
                    <div>
                      <dt className="text-slate-500">Latest decision by</dt>
                      <dd className="mt-1 wrap-break-word font-semibold text-slate-800">
                        {reviewerLabel(selectedRow, user)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">State</dt>
                      <dd className="mt-1 font-semibold text-slate-800">
                        {sentenceCase(selectedRow.state)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Reviewed version</dt>
                      <dd className="mt-1 font-semibold text-slate-800">
                        {selectedRow.reviewed_version == null
                          ? "Not yet reviewed"
                          : `Version ${selectedRow.reviewed_version}`}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Latest comment
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {selectedRow.comment || (
                        <span className="italic text-slate-400">
                          No comment recorded.
                        </span>
                      )}
                    </p>
                  </div>

                  {canAct ? (
                    <div className="mt-5 border-t border-slate-200 pt-5">
                      <label
                        htmlFor="review-comment"
                        className="text-xs font-semibold text-slate-700"
                      >
                        Review comment{" "}
                        <span className="font-normal text-slate-500">
                          (optional for approval; required to withdraw)
                        </span>
                      </label>
                      <textarea
                        id="review-comment"
                        rows={4}
                        value={comment}
                        disabled={saving}
                        onChange={(event) => {
                          setComment(event.target.value);
                          if (event.target.value.trim().length >= 2)
                            setValidationError(null);
                        }}
                        placeholder="Add concise, actionable feedback…"
                        className="mt-2 block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      {validationError && (
                        <p
                          role="alert"
                          className="mt-2 text-xs font-semibold text-rose-700"
                        >
                          {validationError}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void recordDecision("approve")}
                          className="inline-flex min-h-10 items-center justify-center rounded-full bg-emerald-700 px-4 text-xs font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {saving ? "Saving…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void recordDecision("withdraw")}
                          className="inline-flex min-h-10 items-center justify-center rounded-full border border-rose-200 bg-white px-4 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {saving
                            ? "Saving…"
                            : isApproved
                              ? "Withdraw approval"
                              : "Request changes"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
                      {selectedRow.reviewer_id !== user.id
                        ? selectedRow.reviewer_id
                          ? "Read-only oversight: this category is assigned to another reviewer."
                          : "Read-only oversight: no reviewer is assigned to this category."
                        : "Actions are unavailable at this workflow stage."}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-xs leading-5 text-slate-600">
                  This category is not exposed in your queue. Assigned reviewers
                  can view and act only on their own category; administrators
                  and Teaching Directors can see oversight rows.
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
