"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Assessment, Json } from "@/lib/database.types";

type AccessState = "loading" | "signed-out" | "denied" | "admin";
type AdminDirectoryUser = {
  user_id: string;
  display_name: string;
  is_admin: boolean;
};
type Deadline = {
  assessmentId: string;
  assessmentTitle: string;
  moduleCode: string;
  ownerId: string;
  date: Date;
  description: string;
};
type FieldSummary = {
  key: string;
  label: string;
  completed: number;
  responses: number;
  values: { label: string; count: number }[];
};
type FlatValue = string | number | boolean;

type SavedBriefContent = {
  formData?: Record<string, unknown>;
  sectionToggles?: Record<string, boolean>;
  selectedSkills?: string[];
  rubricRows?: Record<string, unknown>[];
  uploadedImages?: Record<string, string>;
};

const ALL = "all";
const LONG_TEXT_THRESHOLD = 100;

const formatDate = (value: string | Date, includeTime = false) => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const humanise = (value: string) =>
  value
    .replace(/^content\./, "")
    .replace(/\[\]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const normaliseValue = (value: FlatValue): FlatValue => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "Not provided";
  return trimmed.length > LONG_TEXT_THRESHOLD ? "Completed" : trimmed;
};

const addFlatValue = (
  output: Map<string, FlatValue[]>,
  path: string,
  value: FlatValue,
) => {
  const existing = output.get(path) ?? [];
  existing.push(normaliseValue(value));
  output.set(path, existing);
};

const flattenValue = (
  value: unknown,
  path: string,
  output: Map<string, FlatValue[]>,
) => {
  if (value === null || value === undefined) return;
  if (["string", "number", "boolean"].includes(typeof value)) {
    addFlatValue(output, path, value as FlatValue);
    return;
  }

  if (Array.isArray(value)) {
    addFlatValue(output, `${path}.count`, value.length);
    value.forEach((item) => {
      if (isRecord(item)) {
        Object.entries(item).forEach(([key, nested]) => {
          if (key !== "id") flattenValue(nested, `${path}[].${key}`, output);
        });
      } else {
        flattenValue(item, path, output);
      }
    });
    return;
  }

  if (isRecord(value)) {
    Object.entries(value).forEach(([key, nested]) => {
      if (path === "content" && key === "uploadedImages") {
        addFlatValue(
          output,
          "content.uploadedImages.count",
          isRecord(nested) ? Object.keys(nested).length : 0,
        );
        return;
      }
      flattenValue(nested, path ? `${path}.${key}` : key, output);
    });
  }
};

const assessmentVariables = (assessment: Assessment) => {
  const output = new Map<string, FlatValue[]>();
  const topLevel: Record<string, FlatValue> = {
    title: assessment.title,
    module_code: assessment.module_code,
    academic_year: assessment.academic_year,
    assessment_type: assessment.assessment_type,
    ai_policy: assessment.ai_policy,
    group_work_permitted: assessment.group_work_permitted,
    status: assessment.status,
    owner: assessment.owner_id,
  };
  Object.entries(topLevel).forEach(([key, value]) =>
    addFlatValue(output, key, value),
  );
  flattenValue(assessment.content, "content", output);
  return output;
};

const parseContent = (content: Json): SavedBriefContent =>
  isRecord(content) ? (content as SavedBriefContent) : {};

const getDeadlines = (assessment: Assessment): Deadline[] => {
  const submissionDates = parseContent(assessment.content).formData
    ?.submissionDates;
  if (!Array.isArray(submissionDates)) return [];

  return submissionDates.flatMap((item) => {
    if (!isRecord(item) || typeof item.date !== "string" || !item.date) {
      return [];
    }
    const date = new Date(item.date);
    if (Number.isNaN(date.getTime())) return [];
    return [
      {
        assessmentId: assessment.id,
        assessmentTitle: assessment.title,
        moduleCode: assessment.module_code,
        ownerId: assessment.owner_id,
        date,
        description:
          typeof item.description === "string" ? item.description : "",
      },
    ];
  });
};

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const getModuleLevel = (moduleCode: string) =>
  moduleCode.match(/-\s*(\d)/)?.[1] ?? null;

type CsvValue = string | number | boolean | null;
type CsvRow = Record<string, CsvValue>;

const flattenForCsv = (value: unknown, path: string, row: CsvRow) => {
  if (value === null || value === undefined) {
    row[path] = null;
    return;
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    row[path] = value as string | number | boolean;
    return;
  }
  if (Array.isArray(value)) {
    row[path] = JSON.stringify(value);
    return;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) row[path] = "{}";
    entries.forEach(([key, nested]) => {
      const nextPath = `${path}.${key}`;
      if (key === "uploadedImages" && isRecord(nested)) {
        row[`${nextPath}.count`] = Object.keys(nested).length;
      } else {
        flattenForCsv(nested, nextPath, row);
      }
    });
  }
};

const escapeCsvCell = (value: CsvValue) => {
  const text = value === null ? "" : String(value);
  const spreadsheetSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
};

const downloadAssessmentCsv = (
  records: Assessment[],
  profileNames: Record<string, string>,
  filename: string,
) => {
  const rows = records.map<CsvRow>((assessment) => {
    const row: CsvRow = {
      id: assessment.id,
      title: assessment.title,
      module_code: assessment.module_code,
      module_level: getModuleLevel(assessment.module_code),
      owner_id: assessment.owner_id,
      owner_name: profileNames[assessment.owner_id] ?? "Profile not completed",
      academic_year: assessment.academic_year,
      assessment_type: assessment.assessment_type,
      ai_policy: assessment.ai_policy,
      group_work_permitted: assessment.group_work_permitted,
      status: assessment.status,
      created_at: assessment.created_at,
      updated_at: assessment.updated_at,
      content_json: JSON.stringify(assessment.content),
    };
    flattenForCsv(assessment.content, "content", row);
    return row;
  });

  const fixedColumns = [
    "id",
    "title",
    "module_code",
    "module_level",
    "owner_id",
    "owner_name",
    "academic_year",
    "assessment_type",
    "ai_policy",
    "group_work_permitted",
    "status",
    "created_at",
    "updated_at",
    "content_json",
  ];
  const additionalColumns = [
    ...new Set(rows.flatMap((row) => Object.keys(row))),
  ]
    .filter((column) => !fixedColumns.includes(column))
    .sort();
  const columns = [...fixedColumns, ...additionalColumns];
  const csv = [
    columns.map(escapeCsvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => escapeCsvCell(row[column] ?? null)).join(","),
    ),
  ].join("\r\n");

  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function AdminDashboard() {
  const [accessState, setAccessState] = useState<AccessState>(
    isSupabaseConfigured ? "loading" : "signed-out",
  );
  const [user, setUser] = useState<User | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<AdminDirectoryUser[]>(
    [],
  );
  const [currentProfileName, setCurrentProfileName] = useState("");
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [promotingUserId, setPromotingUserId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [academicYear, setAcademicYear] = useState(ALL);
  const [moduleLevel, setModuleLevel] = useState(ALL);
  const [assessmentType, setAssessmentType] = useState(ALL);
  const [aiPolicy, setAiPolicy] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const [groupWork, setGroupWork] = useState(ALL);
  const [deadlineWindow, setDeadlineWindow] = useState(ALL);
  const [selectedVariable, setSelectedVariable] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() =>
    startOfMonth(new Date()),
  );

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const loadForUser = async (nextUser: User | null) => {
      setUser(nextUser);
      setError(null);

      if (!nextUser) {
        setAssessments([]);
        setDirectoryUsers([]);
        setCurrentProfileName("");
        setProfileNames({});
        setAccessState("signed-out");
        return;
      }

      setAccessState("loading");

      const { data: ownProfile, error: ownProfileError } = await client
        .from("profiles")
        .select("display_name")
        .eq("user_id", nextUser.id)
        .maybeSingle();

      if (ownProfileError) {
        setError(ownProfileError.message);
        setAccessState("denied");
        return;
      }
      if (!ownProfile) {
        window.location.href = "./";
        return;
      }
      setCurrentProfileName(ownProfile.display_name);

      const { data: membership, error: membershipError } = await client
        .from("admin_users")
        .select("user_id")
        .eq("user_id", nextUser.id)
        .maybeSingle();

      if (membershipError || !membership) {
        setError(membershipError?.message ?? null);
        setAccessState("denied");
        return;
      }

      const [assessmentResult, directoryResult] = await Promise.all([
        client
          .from("assessments")
          .select("*")
          .order("updated_at", { ascending: false }),
        client.rpc("admin_list_users"),
      ]);

      if (assessmentResult.error) {
        setError(assessmentResult.error.message);
        setAssessments([]);
      } else {
        setAssessments(assessmentResult.data ?? []);
      }

      if (directoryResult.error) {
        setError((current) =>
          [current, directoryResult.error.message].filter(Boolean).join(" "),
        );
        setDirectoryUsers([]);
        setProfileNames({});
      } else {
        const users = directoryResult.data ?? [];
        setDirectoryUsers(users);
        setProfileNames(
          Object.fromEntries(
            users.map((profile) => [profile.user_id, profile.display_name]),
          ),
        );
      }
      setAccessState("admin");
    };

    void client.auth
      .getSession()
      .then(({ data }) => loadForUser(data.session?.user ?? null));

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => void loadForUser(session?.user ?? null), 0);
    });

    return () => subscription.unsubscribe();
  }, []);

  const allDeadlinesByAssessment = useMemo(
    () =>
      new Map(
        assessments.map((assessment) => [
          assessment.id,
          getDeadlines(assessment),
        ]),
      ),
    [assessments],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const now = new Date();
    return assessments.filter((assessment) => {
      const deadlines = allDeadlinesByAssessment.get(assessment.id) ?? [];
      const matchesDeadline =
        deadlineWindow === ALL ||
        (deadlineWindow === "upcoming" &&
          deadlines.some((deadline) => deadline.date >= now)) ||
        (deadlineWindow === "overdue" &&
          deadlines.some((deadline) => deadline.date < now)) ||
        (deadlineWindow === "none" && deadlines.length === 0);
      const matchesSearch =
        !query ||
        assessment.title.toLowerCase().includes(query) ||
        assessment.module_code.toLowerCase().includes(query) ||
        (profileNames[assessment.owner_id] ?? "").toLowerCase().includes(query);

      return (
        matchesSearch &&
        matchesDeadline &&
        (academicYear === ALL || assessment.academic_year === academicYear) &&
        (moduleLevel === ALL ||
          getModuleLevel(assessment.module_code) === moduleLevel) &&
        (assessmentType === ALL ||
          assessment.assessment_type === assessmentType) &&
        (aiPolicy === ALL || assessment.ai_policy === aiPolicy) &&
        (status === ALL || assessment.status === status) &&
        (owner === ALL || assessment.owner_id === owner) &&
        (groupWork === ALL ||
          assessment.group_work_permitted === (groupWork === "yes"))
      );
    });
  }, [
    academicYear,
    aiPolicy,
    allDeadlinesByAssessment,
    assessmentType,
    assessments,
    deadlineWindow,
    groupWork,
    moduleLevel,
    owner,
    profileNames,
    search,
    status,
  ]);

  const deadlines = useMemo(
    () =>
      filtered
        .flatMap((assessment) => getDeadlines(assessment))
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [filtered],
  );

  const fieldSummaries = useMemo(() => {
    const summaries = new Map<
      string,
      { completed: number; responses: number; values: Map<string, number> }
    >();

    filtered.forEach((assessment) => {
      assessmentVariables(assessment).forEach((values, key) => {
        const current = summaries.get(key) ?? {
          completed: 0,
          responses: 0,
          values: new Map<string, number>(),
        };
        current.completed += 1;
        current.responses += values.length;
        values.forEach((value) => {
          const label = String(value);
          current.values.set(label, (current.values.get(label) ?? 0) + 1);
        });
        summaries.set(key, current);
      });
    });

    return [...summaries.entries()]
      .map<FieldSummary>(([key, summary]) => ({
        key,
        label: humanise(key),
        completed: summary.completed,
        responses: summary.responses,
        values: [...summary.values.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered]);

  const resolvedSelectedVariable = fieldSummaries.some(
    (field) => field.key === selectedVariable,
  )
    ? selectedVariable
    : (fieldSummaries.find((field) => field.key === "assessment_type")?.key ??
      fieldSummaries[0]?.key ??
      "");
  const activeSummary = fieldSummaries.find(
    (field) => field.key === resolvedSelectedVariable,
  );
  const years = uniqueOptions(assessments, "academic_year");
  const levels = [
    ...new Set(
      assessments
        .map((assessment) => getModuleLevel(assessment.module_code))
        .filter((level): level is string => Boolean(level)),
    ),
  ].sort((a, b) => Number(a) - Number(b));
  const types = uniqueOptions(assessments, "assessment_type");
  const policies = uniqueOptions(assessments, "ai_policy");
  const statuses = uniqueOptions(assessments, "status");
  const ownerOptions = [...new Set(assessments.map((item) => item.owner_id))]
    .map((id) => ({ value: id, label: profileNames[id] ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const ownerCount = new Set(filtered.map((item) => item.owner_id)).size;
  const groupWorkCount = filtered.filter(
    (item) => item.group_work_permitted,
  ).length;
  const upcomingDeadlineCount = deadlines.filter(
    (deadline) => deadline.date >= new Date(),
  ).length;
  const activeFilterCount =
    [
      academicYear,
      moduleLevel,
      assessmentType,
      aiPolicy,
      status,
      owner,
      groupWork,
      deadlineWindow,
    ].filter((value) => value !== ALL).length + (search.trim() ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setAcademicYear(ALL);
    setModuleLevel(ALL);
    setAssessmentType(ALL);
    setAiPolicy(ALL);
    setStatus(ALL);
    setOwner(ALL);
    setGroupWork(ALL);
    setDeadlineWindow(ALL);
  };

  const promoteUser = async (target: AdminDirectoryUser) => {
    if (!supabase || target.is_admin) return;
    setPromotingUserId(target.user_id);
    setError(null);
    const { error: promotionError } = await supabase.rpc("admin_promote_user", {
      target_user_id: target.user_id,
    });
    setPromotingUserId(null);
    if (promotionError) {
      setError(promotionError.message);
      return;
    }
    setDirectoryUsers((current) =>
      current.map((item) =>
        item.user_id === target.user_id ? { ...item, is_admin: true } : item,
      ),
    );
  };

  const signIn = async () => {
    if (!supabase) return;
    const redirectTo = window.location.href.split(/[?#]/)[0];
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo },
    });
    if (signInError) setError(signInError.message);
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
  };

  if (!isSupabaseConfigured) {
    return (
      <AdminMessage
        title="Supabase setup required"
        body="Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before using the administration dashboard."
      />
    );
  }

  if (accessState === "loading") {
    return (
      <AdminMessage
        title="Checking access"
        body="Loading your administrator session…"
      />
    );
  }

  if (accessState === "signed-out") {
    return (
      <AdminMessage
        title="Administrator sign in"
        body="Sign in with an approved GitHub account."
      >
        <button onClick={signIn} className="button-primary">
          Sign in with GitHub
        </button>
      </AdminMessage>
    );
  }

  if (accessState === "denied") {
    return (
      <AdminMessage
        title="Administrator access required"
        body="Your account is authenticated but is not an administrator."
      >
        <button onClick={signOut} className="button-secondary">
          Sign out
        </button>
      </AdminMessage>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-xs font-bold tracking-wide text-white">
              UEA
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Assessment oversight
              </p>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                Administration workspace
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-500 md:inline">
              {currentProfileName ||
                user?.user_metadata.user_name ||
                user?.email}
            </span>
            <a href="./" className="button-secondary">
              Back to builder
            </a>
            <button onClick={signOut} className="button-dark">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Filtered assessments"
            value={filtered.length}
            detail={`of ${assessments.length} total`}
          />
          <StatCard
            label="Assessment owners"
            value={ownerCount}
            detail="within this result set"
          />
          <StatCard
            label="Group assessments"
            value={groupWorkCount}
            detail={`${percentage(groupWorkCount, filtered.length)} of filtered`}
          />
          <StatCard
            label="Upcoming deadlines"
            value={upcomingDeadlineCount}
            detail={`${deadlines.length} deadline entries`}
          />
        </section>

        <section className="panel p-4 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Refine the dataset</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">
                Filters
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                All statistics, deadlines and records update together.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadAssessmentCsv(
                    assessments,
                    profileNames,
                    `uea-assessments-all-${dateKey(new Date())}.csv`,
                  )
                }
                disabled={assessments.length === 0}
                className="button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download all CSV
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadAssessmentCsv(
                    filtered,
                    profileNames,
                    `uea-assessments-filtered-${dateKey(new Date())}.csv`,
                  )
                }
                disabled={filtered.length === 0}
                className="button-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download filtered CSV ({filtered.length})
              </button>
              <button
                type="button"
                onClick={clearFilters}
                disabled={activeFilterCount === 0}
                className="button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear filters
                {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="filter-label sm:col-span-2">
              Search assessments
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Title, module or owner"
                className="filter-control"
              />
            </label>
            <Filter
              label="Academic year"
              value={academicYear}
              onChange={setAcademicYear}
              options={years}
            />
            <Filter
              label="Level"
              value={moduleLevel}
              onChange={setModuleLevel}
              options={levels.map((level) => ({
                value: level,
                label: `Level ${level}`,
              }))}
            />
            <Filter
              label="Assessment type"
              value={assessmentType}
              onChange={setAssessmentType}
              options={types}
            />
            <Filter
              label="AI policy"
              value={aiPolicy}
              onChange={setAiPolicy}
              options={policies}
            />
            <Filter
              label="Status"
              value={status}
              onChange={setStatus}
              options={statuses}
            />
            <Filter
              label="Owner"
              value={owner}
              onChange={setOwner}
              options={ownerOptions}
            />
            <Filter
              label="Group work"
              value={groupWork}
              onChange={setGroupWork}
              options={[
                { value: "yes", label: "Permitted" },
                { value: "no", label: "Not permitted" },
              ]}
            />
            <Filter
              label="Deadline"
              value={deadlineWindow}
              onChange={setDeadlineWindow}
              options={[
                { value: "upcoming", label: "Has upcoming deadline" },
                { value: "overdue", label: "Has past deadline" },
                { value: "none", label: "No deadline" },
              ]}
            />
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-slate-200 p-5 sm:p-6">
            <p className="eyebrow">Saved-variable analytics</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  Statistics explorer
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-500">
                  Inspect completion and value distributions for every saved
                  top-level and brief-content variable. Long narrative responses
                  are grouped as completed to keep statistics meaningful.
                </p>
              </div>
              <label className="filter-label w-full sm:w-80">
                Variable
                <select
                  value={resolvedSelectedVariable}
                  onChange={(event) => setSelectedVariable(event.target.value)}
                  className="filter-control"
                >
                  {fieldSummaries.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {activeSummary ? (
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.38fr)]">
              <DistributionChart summary={activeSummary} />
              <div className="grid content-start gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <MiniStat
                  label="Assessments with value"
                  value={`${activeSummary.completed} / ${filtered.length}`}
                />
                <MiniStat
                  label="Completion"
                  value={percentage(activeSummary.completed, filtered.length)}
                />
                <MiniStat
                  label="Distinct responses"
                  value={activeSummary.values.length.toLocaleString()}
                />
              </div>
            </div>
          ) : (
            <EmptyState message="No saved variables are available for the current filters." />
          )}
        </section>

        <CalendarPanel
          month={calendarMonth}
          deadlines={deadlines}
          profileNames={profileNames}
          onMonthChange={setCalendarMonth}
        />

        <section className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
            <p className="eyebrow">Filtered records</p>
            <h2 className="mt-1 font-semibold">Assessments</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50/80 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Assessment</th>
                  <th className="px-5 py-3 font-semibold">Owner</th>
                  <th className="px-5 py-3 font-semibold">Year</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 font-semibold">AI</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Next deadline</th>
                  <th className="px-5 py-3 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filtered.map((assessment) => {
                  const nextDeadline = (
                    allDeadlinesByAssessment.get(assessment.id) ?? []
                  )
                    .filter((item) => item.date >= new Date())
                    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
                  return (
                    <tr
                      key={assessment.id}
                      className="transition-colors hover:bg-slate-50/80"
                    >
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">
                          {assessment.title}
                        </div>
                        <div className="text-xs text-slate-500">
                          {assessment.module_code}
                        </div>
                      </td>
                      <td
                        className="max-w-56 px-5 py-4"
                        title={assessment.owner_id}
                      >
                        <div className="font-medium text-slate-700">
                          {profileNames[assessment.owner_id] ||
                            "Profile not completed"}
                        </div>
                        <div className="truncate font-mono text-[10px] text-slate-400">
                          {assessment.owner_id}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        {assessment.academic_year}
                      </td>
                      <td className="px-5 py-4">
                        {assessment.assessment_type}
                      </td>
                      <td className="px-5 py-4">
                        <PolicyBadge value={assessment.ai_policy} />
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-700">
                          {assessment.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                        {nextDeadline
                          ? formatDate(nextDeadline.date, true)
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                        {formatDate(assessment.updated_at)}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState message="No assessments match these filters." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-slate-200 p-5 sm:p-6">
            <p className="eyebrow">Access management</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              Administrators
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Promote a registered user after verifying their identity.
              Promotion grants oversight of all saved assessment information and
              cannot be reversed from this prototype interface.
            </p>
          </div>
          <div className="grid divide-y divide-slate-100">
            {directoryUsers.map((directoryUser) => (
              <div
                key={directoryUser.user_id}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">
                      {directoryUser.display_name}
                    </p>
                    {directoryUser.user_id === user?.id && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        You
                      </span>
                    )}
                  </div>
                  <p className="truncate font-mono text-[11px] text-slate-400">
                    {directoryUser.user_id}
                  </p>
                </div>
                {directoryUser.is_admin ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Administrator
                  </span>
                ) : (
                  <button
                    onClick={() => void promoteUser(directoryUser)}
                    disabled={promotingUserId !== null}
                    className="button-secondary disabled:cursor-wait disabled:opacity-50"
                  >
                    {promotingUserId === directoryUser.user_id
                      ? "Promoting…"
                      : "Make administrator"}
                  </button>
                )}
              </div>
            ))}
            {directoryUsers.length === 0 && (
              <EmptyState message="No completed user profiles are available." />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function uniqueOptions(
  assessments: Assessment[],
  key: "academic_year" | "assessment_type" | "ai_policy" | "status",
) {
  return [...new Set(assessments.map((item) => item[key]))].sort();
}

function percentage(value: number, total: number) {
  return total === 0 ? "0%" : `${Math.round((value / total) * 100)}%`;
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="panel p-5">
      <div className="text-3xl font-semibold tracking-[-0.04em]">{value}</div>
      <div className="mt-2 text-sm font-medium text-slate-700">{label}</div>
      <div className="mt-0.5 text-xs text-slate-400">{detail}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>
      <div className="mt-1 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: (string | { value: string; label: string })[];
}) {
  return (
    <label className="filter-label">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="filter-control"
      >
        <option value={ALL}>All</option>
        {options.map((option) => {
          const item =
            typeof option === "string"
              ? { value: option, label: option }
              : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function DistributionChart({ summary }: { summary: FieldSummary }) {
  const visibleValues = summary.values.slice(0, 12);
  const max = Math.max(...visibleValues.map((item) => item.count), 1);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900">{summary.label}</h3>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">
            {summary.key}
          </p>
        </div>
        <span className="text-xs text-slate-400">
          Top {visibleValues.length} values
        </span>
      </div>
      <div className="space-y-3">
        {visibleValues.map((item) => (
          <div
            key={item.label}
            className="grid grid-cols-[minmax(100px,0.42fr)_minmax(120px,1fr)_auto] items-center gap-3 text-sm"
          >
            <span className="truncate text-slate-600" title={item.label}>
              {item.label}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-slate-800 transition-[width]"
                style={{ width: `${(item.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right font-semibold tabular-nums text-slate-700">
              {item.count}
            </span>
          </div>
        ))}
      </div>
      {summary.values.length > visibleValues.length && (
        <p className="mt-4 text-xs text-slate-400">
          {summary.values.length - visibleValues.length} additional values are
          not shown.
        </p>
      )}
    </div>
  );
}

function CalendarPanel({
  month,
  deadlines,
  profileNames,
  onMonthChange,
}: {
  month: Date;
  deadlines: Deadline[];
  profileNames: Record<string, string>;
  onMonthChange: (date: Date) => void;
}) {
  const firstWeekday = (month.getDay() + 6) % 7;
  const gridStart = new Date(
    month.getFullYear(),
    month.getMonth(),
    1 - firstWeekday,
  );
  const days = Array.from(
    { length: 42 },
    (_, index) =>
      new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index,
      ),
  );
  const deadlinesByDate = new Map<string, Deadline[]>();
  deadlines.forEach((deadline) => {
    const key = dateKey(deadline.date);
    deadlinesByDate.set(key, [...(deadlinesByDate.get(key) ?? []), deadline]);
  });
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(month);
  const visibleDeadlines = deadlines.filter(
    (deadline) =>
      deadline.date.getFullYear() === month.getFullYear() &&
      deadline.date.getMonth() === month.getMonth(),
  );
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-5 sm:p-6">
        <div>
          <p className="eyebrow">Deadline planning</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            {monthLabel}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {visibleDeadlines.length} filtered deadline
            {visibleDeadlines.length === 1 ? "" : "s"} this month
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() =>
              onMonthChange(
                new Date(month.getFullYear(), month.getMonth() - 1, 1),
              )
            }
          >
            ←
          </button>
          <button
            className="button-secondary"
            onClick={() => onMonthChange(startOfMonth(new Date()))}
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() =>
              onMonthChange(
                new Date(month.getFullYear(), month.getMonth() + 1, 1),
              )
            }
          >
            →
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div
                key={day}
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayDeadlines = deadlinesByDate.get(dateKey(day)) ?? [];
              const inMonth = day.getMonth() === month.getMonth();
              const today = dateKey(day) === dateKey(new Date());
              return (
                <div
                  key={day.toISOString()}
                  className={`min-h-32 border-b border-r border-slate-100 p-2 ${inMonth ? "bg-white" : "bg-slate-50/50"}`}
                >
                  <div
                    className={`mb-2 grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${today ? "bg-slate-950 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}
                  >
                    {day.getDate()}
                  </div>
                  <div className="space-y-1">
                    {dayDeadlines.slice(0, 3).map((deadline, index) => (
                      <div
                        key={`${deadline.assessmentId}-${deadline.date.toISOString()}-${index}`}
                        title={`${deadline.assessmentTitle} — ${profileNames[deadline.ownerId] ?? "Unknown owner"}`}
                        className="rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 text-[10px] leading-tight text-blue-900"
                      >
                        <div className="truncate font-semibold">
                          {deadline.moduleCode || deadline.assessmentTitle}
                        </div>
                        <div className="mt-0.5 truncate text-blue-600">
                          {deadline.date.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {deadline.description
                            ? ` · ${deadline.description}`
                            : ""}
                        </div>
                      </div>
                    ))}
                    {dayDeadlines.length > 3 && (
                      <div className="px-1 text-[10px] font-semibold text-slate-400">
                        +{dayDeadlines.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {visibleDeadlines.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/60 p-5 sm:px-6">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
            This month
          </h3>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleDeadlines.map((deadline, index) => (
              <div
                key={`${deadline.assessmentId}-${deadline.date.toISOString()}-list-${index}`}
                className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="w-11 shrink-0 text-center">
                  <div className="text-lg font-semibold leading-none">
                    {deadline.date.getDate()}
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase text-slate-400">
                    {deadline.date.toLocaleDateString("en-GB", {
                      month: "short",
                    })}
                  </div>
                </div>
                <div className="min-w-0 border-l border-slate-200 pl-3">
                  <p className="truncate text-sm font-semibold">
                    {deadline.assessmentTitle}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {deadline.description || "Submission deadline"} ·{" "}
                    {profileNames[deadline.ownerId] ?? "Unknown owner"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PolicyBadge({ value }: { value: string }) {
  const style =
    value === "RED"
      ? "bg-red-50 text-red-700"
      : value === "AMBER"
        ? "bg-amber-50 text-amber-700"
        : value === "GREEN"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
      {value}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-5 py-12 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function AdminMessage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f9] p-6">
      <div className="panel w-full max-w-lg p-8 text-center">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-xs font-bold text-white">
          UEA
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
          {body}
        </p>
        {children && <div className="mt-6">{children}</div>}
        <a
          href="./"
          className="mt-6 inline-block text-sm font-semibold text-slate-700 hover:text-slate-950"
        >
          Back to builder
        </a>
      </div>
    </main>
  );
}
