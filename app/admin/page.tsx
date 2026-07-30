"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Assessment } from "@/lib/database.types";

type AccessState = "loading" | "signed-out" | "denied" | "admin";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

export default function AdminDashboard() {
  const [accessState, setAccessState] = useState<AccessState>(
    isSupabaseConfigured ? "loading" : "signed-out",
  );
  const [user, setUser] = useState<User | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [currentProfileName, setCurrentProfileName] = useState("");
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [academicYear, setAcademicYear] = useState("all");
  const [assessmentType, setAssessmentType] = useState("all");
  const [aiPolicy, setAiPolicy] = useState("all");

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const loadForUser = async (nextUser: User | null) => {
      setUser(nextUser);
      setError(null);

      if (!nextUser) {
        setAssessments([]);
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
        window.location.href = "../";
        return;
      }
      setCurrentProfileName(ownProfile.display_name);

      const { data: membership, error: membershipError } = await client
        .from("admin_users")
        .select("user_id")
        .eq("user_id", nextUser.id)
        .maybeSingle();

      if (membershipError) {
        setError(membershipError.message);
        setAccessState("denied");
        return;
      }

      if (!membership) {
        setAccessState("denied");
        return;
      }

      const { data, error: assessmentsError } = await client
        .from("assessments")
        .select("*")
        .order("updated_at", { ascending: false });

      if (assessmentsError) {
        setError(assessmentsError.message);
        setAssessments([]);
        setProfileNames({});
      } else {
        const loadedAssessments = data ?? [];
        setAssessments(loadedAssessments);

        const ownerIds = [
          ...new Set(loadedAssessments.map((item) => item.owner_id)),
        ];
        if (ownerIds.length > 0) {
          const { data: profiles, error: profilesError } = await client
            .from("profiles")
            .select("user_id, display_name")
            .in("user_id", ownerIds);

          if (profilesError) {
            setError(profilesError.message);
          } else {
            setProfileNames(
              Object.fromEntries(
                (profiles ?? []).map((profile) => [
                  profile.user_id,
                  profile.display_name,
                ]),
              ),
            );
          }
        } else {
          setProfileNames({});
        }
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

  const filtered = useMemo(
    () =>
      assessments.filter(
        (assessment) =>
          (academicYear === "all" ||
            assessment.academic_year === academicYear) &&
          (assessmentType === "all" ||
            assessment.assessment_type === assessmentType) &&
          (aiPolicy === "all" || assessment.ai_policy === aiPolicy),
      ),
    [academicYear, aiPolicy, assessmentType, assessments],
  );

  const years = [
    ...new Set(assessments.map((item) => item.academic_year)),
  ].sort();
  const types = [
    ...new Set(assessments.map((item) => item.assessment_type)),
  ].sort();
  const policies = [
    ...new Set(assessments.map((item) => item.ai_policy)),
  ].sort();
  const ownerCount = new Set(filtered.map((item) => item.owner_id)).size;
  const groupWorkCount = filtered.filter(
    (item) => item.group_work_permitted,
  ).length;
  const draftCount = filtered.filter((item) => item.status === "draft").length;

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
        body="Loading your university session…"
      />
    );
  }

  if (accessState === "signed-out") {
    return (
      <AdminMessage
        title="Administrator sign in"
        body="Sign in with an approved GitHub account."
      >
        <button
          onClick={signIn}
          className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Sign in with GitHub
        </button>
      </AdminMessage>
    );
  }

  if (accessState === "denied") {
    return (
      <AdminMessage
        title="Administrator access required"
        body="Your account is authenticated but is not listed in the admin_users table."
      >
        <button
          onClick={signOut}
          className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </button>
      </AdminMessage>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
              UEA oversight
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              Assessment dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Authenticated as{" "}
              {currentProfileName ||
                user?.user_metadata.user_name ||
                user?.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="../"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to builder
            </a>
            <button
              onClick={signOut}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-8">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Filtered assessments" value={filtered.length} />
          <StatCard label="Assessment owners" value={ownerCount} />
          <StatCard label="Group assessments" value={groupWorkCount} />
          <StatCard label="Drafts" value={draftCount} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Filter
              label="Academic year"
              value={academicYear}
              onChange={setAcademicYear}
              options={years}
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
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
            <h2 className="font-semibold">Assessments</h2>
            <p className="text-sm text-slate-500">
              Records visible through administrator RLS policies.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Assessment</th>
                  <th className="px-5 py-3">Owner</th>
                  <th className="px-5 py-3">Year</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">AI</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((assessment) => (
                  <tr key={assessment.id} className="hover:bg-slate-50">
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
                    <td className="px-5 py-4">{assessment.academic_year}</td>
                    <td className="px-5 py-4">{assessment.assessment_type}</td>
                    <td className="px-5 py-4">{assessment.ai_policy}</td>
                    <td className="px-5 py-4 capitalize">
                      {assessment.status}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                      {formatDate(assessment.updated_at)}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-12 text-center text-slate-500"
                    >
                      No assessments match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
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
  options: string[];
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
      >
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function AdminMessage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 font-bold text-indigo-600">
          UEA
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
          {body}
        </p>
        {children && <div className="mt-6">{children}</div>}
        <a
          href="../"
          className="mt-6 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-800"
        >
          Back to builder
        </a>
      </div>
    </main>
  );
}
