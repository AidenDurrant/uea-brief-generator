"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import SKILLS_LIST from "./skills.json";
import ASSESSMENT_METHODS from "./assessments.json";

// ─── Constants ────────────────────────────────────────────────────────────────
const LOCAL_STORAGE_KEY = "uea_brief_draft_v1";

const AI_CARD_STATES: Record<
  string,
  { bg: string; border: string; labelColor: string; dotBg: string }
> = {
  RED: {
    bg: "#fef2f2",
    border: "#f87171",
    labelColor: "#dc2626",
    dotBg: "#ef4444",
  },
  AMBER: {
    bg: "#fffbeb",
    border: "#f59e0b",
    labelColor: "#d97706",
    dotBg: "#f59e0b",
  },
  GREEN: {
    bg: "#f0fdf4",
    border: "#22c55e",
    labelColor: "#16a34a",
    dotBg: "#22c55e",
  },
};

const INPUT =
  "w-full max-w-full box-border bg-slate-50 border border-slate-200 text-slate-900 rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all hover:bg-white hover:border-slate-300 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 placeholder:text-slate-400";

// ─── Helper Formatting Functions ──────────────────────────────────────────────

const formatDateOnly = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const formatDateTime = (dateString?: string, description?: string) => {
  if (!dateString) return description || "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return `${dateString} ${description || ""}`.trim();

  const formattedDate = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return description ? `${formattedDate} (${description})` : formattedDate;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const MarkdownRenderer = ({ content }: { content: string }) => (
  <div className="markdown-content text-[11pt] leading-relaxed text-black">
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {content}
    </ReactMarkdown>
  </div>
);

function SectionHeading({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div
        className="flex items-center justify-center shrink-0 text-xs font-bold select-none"
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "#eef2ff",
          color: "#4f46e5",
        }}
      >
        {step}
      </div>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-400 mb-1.5">
      {children}
    </label>
  );
}

function ZoomBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white font-bold text-base leading-none transition-all duration-150 select-none"
    >
      {children}
    </button>
  );
}

function VisibilityToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex bg-slate-200 p-1 rounded-lg select-none items-center shadow-inner">
      <button
        type="button"
        onClick={() => !checked && onChange()}
        className={`px-4 py-1.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md transition-all duration-200 ${
          checked
            ? "bg-indigo-600 text-white shadow-md"
            : "text-slate-500 hover:text-slate-700 hover:bg-slate-300/50"
        }`}
      >
        Visible
      </button>
      <button
        type="button"
        onClick={() => checked && onChange()}
        className={`px-4 py-1.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md transition-all duration-200 ${
          !checked
            ? "bg-slate-600 text-white shadow-md"
            : "text-slate-500 hover:text-slate-700 hover:bg-slate-300/50"
        }`}
      >
        Hidden
      </button>
    </div>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const AI_OPTIONS = [
  { value: "RED", emoji: "🔴", label: "RED", desc: "No AI Permitted" },
  { value: "AMBER", emoji: "🟡", label: "AMBER", desc: "Restricted Use" },
  { value: "GREEN", emoji: "🟢", label: "GREEN", desc: "Full Integration" },
];

const GRADE_BANDS = [
  {
    key: "fail",
    label: "Fail",
    range: "<40%",
    pill: "bg-red-100 text-red-700 border-red-200",
  },
  {
    key: "pass",
    label: "Pass",
    range: "40–49%",
    pill: "bg-orange-100 text-orange-700 border-orange-200",
  },
  {
    key: "twoTwo",
    label: "2:2",
    range: "50–59%",
    pill: "bg-yellow-100 text-yellow-700 border-yellow-200",
  },
  {
    key: "twoOne",
    label: "2:1",
    range: "60–69%",
    pill: "bg-sky-100 text-sky-700 border-sky-200",
  },
  {
    key: "first",
    label: "1st",
    range: "70–84%",
    pill: "bg-indigo-100 text-indigo-700 border-indigo-200",
  },
  {
    key: "excelled",
    label: "Excelled",
    range: "85%+",
    pill: "bg-violet-100 text-violet-700 border-violet-200",
  },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function BriefGenerator() {
  const [zoom, setZoom] = useState(80);
  const [panelWidth, setPanelWidth] = useState(46);
  const [isLoaded, setIsLoaded] = useState(false); // Prevents hydration mismatch
  const containerRef = useRef<HTMLDivElement>(null);

  // 1. Set Initial State Defaults
  const [formData, setFormData] = useState({
    school: "School of Computing Science",
    programme: "BSc Computing Science 2026-2027",
    module: "CMP-1001 Introduction to Programming",
    assessmentType: "Prompt Portfolio",
    weighting: "40%",
    setBy: "Module Organiser Name / Second Marker Name",
    releaseDate: "2026-10-01",
    submissionDates: [
      { id: Date.now(), date: "2026-05-22T15:00", description: "Code/Report" },
    ],
    submissionLocation: "Blackboard / GitHub Classroom",
    returnOfFeedback: "Within 20 working days",
    groupWorkPermitted: "No",
    groupSize: "3", // Default specific size field
    contextScenario:
      "Provide a 2-3 sentence real-world framing or context for the assessment.",
    learningOutcomes:
      "* Demonstrate a systematic understanding of key aspects of artificial intelligence.\n* Deploy accurately established techniques of analysis and enquiry within computer science.",
    groupMechanics:
      "**Formation:** Register via the link by Friday of Week 7.\n**No Group?:** If you cannot find a group, email the module organiser by X date to be assigned.",
    coreObjectives:
      "### Task 1: Algorithm Implementation\nOutline specific task requirements or exam topics. e.g., Implement $O(N \\log N)$ sort.",
    architectureConstraints:
      "**Required Components:** Python 3.10+, PyTorch\n**Allowed Materials:** Open book, one A4 cheat sheet.",
    deliverables:
      "**Source Code/Files:** A single `.zip` file containing all code and a `README.md`.\n**Documentation/Report:** Concisely document the architecture and methods.",
    submissionInstructions:
      "Submit via the Blackboard assignment link before the deadline.",
    resourcesHints:
      "**Provided Data:** Historical datasets available on Blackboard.\n**Documentation:** Review the official API Guidelines.",
    contactInfo: "Module Organiser: m.organiser@uea.ac.uk",
    aiPolicy: "RED",
    aiAmberPermitted:
      "You may use AI to explain error messages or format references.",
    aiAmberProhibited:
      "You MUST NOT use AI to generate application code or write technical reports.",
    aiGreenPermitted:
      "You may use AI tools to assist with coding, debugging, drafting, and architecture design.",
  });

  const [sectionToggles, setSectionToggles] = useState({
    contextScenario: true,
    learningOutcomes: true,
    coreObjectives: true,
    architectureConstraints: true,
    deliverables: true,
    submissionInstructions: true,
    resourcesHints: true,
    contactInfo: true,
  });

  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [rubricRows, setRubricRows] = useState([
    {
      id: Date.now(),
      component: "Live Element (Demo)",
      weight: "55%",
      fail: "Core concepts misunderstood; tasks incomplete.",
      pass: "Basic understanding demonstrated; bare minimum functionality shown.",
      twoTwo:
        "Fair understanding; mostly functional but with notable errors or gaps.",
      twoOne: "Good understanding; solid execution with minor issues.",
      first: "Excellent understanding; highly optimised.",
      excelled: "Exceptional insight; flawless execution of edge cases.",
    },
  ]);

  // 2. Load Draft on Mount
  useEffect(() => {
    const savedDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        if (parsed.formData) {
          // Migration: Convert old submission date strings into the new calendar format
          if (typeof parsed.formData.submissionDate === "string") {
            parsed.formData.submissionDates = [
              {
                id: Date.now(),
                date: "",
                description: parsed.formData.submissionDate,
              },
            ];
            delete parsed.formData.submissionDate;
          } else if (parsed.formData.submissionDates) {
            parsed.formData.submissionDates =
              parsed.formData.submissionDates.map((d: any) => {
                if (d.val !== undefined) {
                  return { id: d.id, date: "", description: d.val };
                }
                return d;
              });
          }
          if (
            !parsed.formData.submissionDates ||
            parsed.formData.submissionDates.length === 0
          ) {
            parsed.formData.submissionDates = [
              { id: Date.now(), date: "", description: "" },
            ];
          }
          setFormData(parsed.formData);
        }
        if (parsed.sectionToggles) setSectionToggles(parsed.sectionToggles);
        if (parsed.selectedSkills) setSelectedSkills(parsed.selectedSkills);
        if (parsed.rubricRows) setRubricRows(parsed.rubricRows);
      } catch (error) {
        console.error("Failed to parse local storage draft:", error);
      }
    }
    setIsLoaded(true);
  }, []);

  // 3. Auto-save Draft on Change
  useEffect(() => {
    if (!isLoaded) return; // Don't save before initial load
    const draft = { formData, sectionToggles, selectedSkills, rubricRows };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft));
  }, [formData, sectionToggles, selectedSkills, rubricRows, isLoaded]);

  // 4. Clear Draft Handler
  const handleClearDraft = () => {
    if (
      window.confirm(
        "Are you sure you want to clear your draft and start over with the default template?",
      )
    ) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      window.location.reload(); // Fast way to reset states to default
    }
  };

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const onMouseMove = (ev: MouseEvent) => {
        const { left, width } = container.getBoundingClientRect();
        setPanelWidth(
          Math.max(25, Math.min(72, ((ev.clientX - left) / width) * 100)),
        );
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  const toggleSection = (key: keyof typeof sectionToggles) => {
    setSectionToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSkill = (s: string) =>
    setSelectedSkills((p) =>
      p.includes(s) ? p.filter((x) => x !== s) : [...p, s],
    );

  const addRubricRow = () =>
    setRubricRows([
      ...rubricRows,
      {
        id: Date.now(),
        component: "New Component",
        weight: "10%",
        fail: "",
        pass: "",
        twoTwo: "",
        twoOne: "",
        first: "",
        excelled: "",
      },
    ]);

  const updateRubricRow = (id: number, field: string, value: string) =>
    setRubricRows(
      rubricRows.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );

  const removeRubricRow = (id: number) =>
    setRubricRows(rubricRows.filter((r) => r.id !== id));

  const handleChange = (field: string, value: string) =>
    setFormData((p) => ({ ...p, [field]: value }));

  // Multiple Submission Dates Handlers
  const addSubmissionDate = () => {
    setFormData((p) => ({
      ...p,
      submissionDates: [
        ...p.submissionDates,
        { id: Date.now(), date: "", description: "" },
      ],
    }));
  };

  const updateSubmissionDate = (
    id: number,
    field: "date" | "description",
    val: string,
  ) => {
    setFormData((p) => ({
      ...p,
      submissionDates: p.submissionDates.map((d) =>
        d.id === id ? { ...d, [field]: val } : d,
      ),
    }));
  };

  const removeSubmissionDate = (id: number) => {
    setFormData((p) => ({
      ...p,
      submissionDates: p.submissionDates.filter((d) => d.id !== id),
    }));
  };

  const textAreas = [
    { label: "Context & Scenario", key: "contextScenario" },
    { label: "Learning Outcomes Assessed", key: "learningOutcomes" },
    ...(formData.groupWorkPermitted === "Yes"
      ? [{ label: "Group Mechanics", key: "groupMechanics" }]
      : []),
    { label: "Task Spec / Core Objectives", key: "coreObjectives" },
    {
      label: "Architecture & Technical Constraints",
      key: "architectureConstraints",
    },
    { label: "Deliverables", key: "deliverables" },
    { label: "Submission Instructions", key: "submissionInstructions" },
    { label: "Resources & Hints", key: "resourcesHints" },
    { label: "Contact Information", key: "contactInfo" },
  ];

  // Helper variable to fetch current assessment object
  const currentAssessment =
    ASSESSMENT_METHODS.find((a) => a.method === formData.assessmentType) ||
    ASSESSMENT_METHODS[0];

  // Prevent rendering until local storage is loaded to avoid hydration mismatch flashes
  if (!isLoaded) return null;

  // ─── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="flex h-screen w-full overflow-hidden font-sans print:block print:h-auto print:overflow-visible"
    >
      {/* ═══════════════════════════════════════════════════════════
          LEFT — Editor
      ═══════════════════════════════════════════════════════════ */}
      <div
        className="h-full flex flex-col print:hidden shrink-0 overflow-hidden"
        style={{ width: `${panelWidth}%`, minWidth: 300 }}
      >
        {/* ── Header ── */}
        <header
          className="shrink-0 flex items-center justify-between"
          style={{
            background: "#fff",
            borderBottom: "1px solid #e8eaed",
            paddingLeft: 40,
            paddingRight: 40,
            paddingTop: 14,
            paddingBottom: 14,
          }}
        >
          <div className="flex items-center gap-3">
            <img
              src="/UEA_Logo_BLK_MONO_N_A_59244.png"
              alt="UEA"
              style={{ width: 150, height: 36 }}
            />
            <div>
              <h1
                style={{
                  color: "#111827",
                  fontWeight: 700,
                  fontSize: 14,
                  lineHeight: 1.3,
                }}
              >
                Assessment Builder
              </h1>
              <p style={{ color: "#9ca3af", fontSize: 11 }}>
                School of Computing Science
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClearDraft}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors active:scale-95"
            >
              Clear Draft
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors active:scale-95"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                />
              </svg>
              Export PDF
            </button>
          </div>
        </header>

        {/* ── Scrollable form ── */}
        <div
          className="flex-1 overflow-y-auto space-y-6"
          style={{
            background: "#f5f6fa",
            paddingLeft: 56,
            paddingRight: 56,
            paddingTop: 32,
            paddingBottom: 80,
          }}
        >
          {/* 1 — Header Details */}
          <section
            className="bg-white rounded-xl p-8"
            style={{
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <SectionHeading step={1} title="Header Details" />
            <div className="flex flex-col space-y-5">
              {(
                [
                  ["school", "School"],
                  ["programme", "Programme / Year"],
                  ["module", "Module"],
                  ["weighting", "Weighting"],
                  ["setBy", "Set / Checked By"],
                  ["releaseDate", "Release Date"],
                ] as [string, string][]
              ).map(([key, label]) => (
                <div key={key}>
                  <FieldLabel>{label}</FieldLabel>
                  <input
                    type={key === "releaseDate" ? "date" : "text"}
                    className={INPUT}
                    value={formData[key as keyof typeof formData] as string}
                    onChange={(e) => handleChange(key, e.target.value)}
                  />
                </div>
              ))}

              {/* Dynamic Submission Dates Field with Flex Wrap */}
              <div>
                <FieldLabel>Submission / Exam Date(s)</FieldLabel>
                <div className="space-y-3">
                  {formData.submissionDates.map((item) => (
                    <div key={item.id} className="flex flex-wrap gap-2">
                      <input
                        type="datetime-local"
                        className={`${INPUT} flex-1 min-w-[200px] shrink-0 font-medium`}
                        value={item.date}
                        onChange={(e) =>
                          updateSubmissionDate(item.id, "date", e.target.value)
                        }
                      />
                      <div className="flex flex-1 min-w-[200px] gap-2">
                        <input
                          type="text"
                          className={`${INPUT} flex-1`}
                          value={item.description}
                          placeholder="Label (e.g. Code/Report)"
                          onChange={(e) =>
                            updateSubmissionDate(
                              item.id,
                              "description",
                              e.target.value,
                            )
                          }
                        />
                        {formData.submissionDates.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSubmissionDate(item.id)}
                            className="shrink-0 px-3.5 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-slate-200 bg-white hover:border-red-200 shadow-sm"
                            title="Remove date"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addSubmissionDate}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors mt-1 inline-block"
                  >
                    + Add another date
                  </button>
                </div>
              </div>

              {(
                [
                  ["submissionLocation", "Submission Location"],
                  ["returnOfFeedback", "Return of Feedback"],
                ] as [string, string][]
              ).map(([key, label]) => (
                <div key={key}>
                  <FieldLabel>{label}</FieldLabel>
                  <input
                    type="text"
                    className={INPUT}
                    value={formData[key as keyof typeof formData] as string}
                    onChange={(e) => handleChange(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* 2 — Assessment Type */}
          <section
            className="bg-white rounded-xl p-8"
            style={{
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <SectionHeading step={2} title="Assessment Method" />

            <div>
              <FieldLabel>Type of Assessment</FieldLabel>
              <select
                className={`${INPUT} font-semibold text-indigo-900 cursor-pointer mb-5`}
                value={formData.assessmentType}
                onChange={(e) => handleChange("assessmentType", e.target.value)}
              >
                {ASSESSMENT_METHODS.map((a) => (
                  <option key={a.method} value={a.method}>
                    {a.method}
                  </option>
                ))}
              </select>

              {/* Dynamic details purely for the Editor, not rendered on PDF */}
              <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-200">
                  <span
                    className={`inline-block px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-widest rounded-md border shadow-sm w-fit ${
                      currentAssessment.tier.includes("Tier A")
                        ? "bg-green-100 text-green-800 border-green-300"
                        : currentAssessment.tier.includes("Tier B")
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-red-100 text-red-800 border-red-300"
                    }`}
                  >
                    {currentAssessment.tier}
                  </span>
                  <span className="inline-block px-3.5 py-1.5 bg-white text-slate-600 border border-slate-200 text-[10px] font-extrabold uppercase tracking-widest rounded-md shadow-sm w-fit sm:text-right">
                    Category: {currentAssessment.category}
                  </span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed font-medium">
                  {currentAssessment.desc}
                </p>
              </div>
            </div>
          </section>

          {/* 3 — Policies & Skills */}
          <section
            className="bg-white rounded-xl p-8"
            style={{
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <SectionHeading step={3} title="Policies & Skills" />

            {/* ─ Group Work ─ */}
            <div className="mb-0">
              <FieldLabel>Group Work</FieldLabel>
              <div
                className="flex p-1 gap-1 rounded-xl"
                style={{ background: "#f1f5f9" }}
              >
                {(
                  [
                    ["No", "Individual Assignment"],
                    ["Yes", "Group Work Permitted"],
                  ] as [string, string][]
                ).map(([val, display]) => {
                  const active = formData.groupWorkPermitted === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleChange("groupWorkPermitted", val)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium rounded-lg select-none"
                      style={{
                        transition: "all 0.2s",
                        background: active ? "#4f46e5" : "transparent",
                        color: active ? "#fff" : "#94a3b8",
                        boxShadow: active
                          ? "0 1px 4px rgba(79,70,229,0.35)"
                          : "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.color = "#475569";
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.color = "#94a3b8";
                      }}
                    >
                      {active && (
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                      {display}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ─ Employability Skills ─ */}
            <div
              style={{
                borderTop: "1px solid #f1f5f9",
                marginTop: 28,
                paddingTop: 28,
              }}
            >
              <FieldLabel>Employability Skills Assessed</FieldLabel>
              <div className="flex flex-wrap gap-2 mt-3">
                {SKILLS_LIST.map((skill) => {
                  const on = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      className="inline-flex items-center gap-1.5 select-none"
                      style={{
                        height: 32,
                        padding: "0 14px",
                        borderRadius: 99,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "all 0.15s",
                        border: on
                          ? "1.5px solid #4f46e5"
                          : "1.5px solid #e2e8f0",
                        background: on ? "#4f46e5" : "#fff",
                        color: on ? "#fff" : "#64748b",
                      }}
                      onMouseEnter={(e) => {
                        if (!on) {
                          e.currentTarget.style.borderColor = "#a5b4fc";
                          e.currentTarget.style.background = "#eef2ff";
                          e.currentTarget.style.color = "#4338ca";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!on) {
                          e.currentTarget.style.borderColor = "#e2e8f0";
                          e.currentTarget.style.background = "#fff";
                          e.currentTarget.style.color = "#64748b";
                        }
                      }}
                    >
                      {on && (
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                      {skill}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 4 — AI Policy */}
          <section
            className="bg-white rounded-xl p-8"
            style={{
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <SectionHeading step={4} title="Generative AI Policy" />

            <div className="grid grid-cols-3 gap-4 mb-7">
              {AI_OPTIONS.map((opt) => {
                const on = formData.aiPolicy === opt.value;
                const s = AI_CARD_STATES[opt.value];
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleChange("aiPolicy", opt.value)}
                    className="flex flex-col items-center gap-1.5 py-4 px-3 rounded-xl cursor-pointer select-none text-center relative"
                    style={{
                      transition: "all 0.15s",
                      border: on
                        ? `2px solid ${s.border}`
                        : "2px solid #e2e8f0",
                      background: on ? s.bg : "#fff",
                      boxShadow: on ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (!on) {
                        e.currentTarget.style.borderColor = "#c7d2fe";
                        e.currentTarget.style.background = "#fafafa";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!on) {
                        e.currentTarget.style.borderColor = "#e2e8f0";
                        e.currentTarget.style.background = "#fff";
                      }
                    }}
                  >
                    <span style={{ fontSize: 24, lineHeight: 1 }}>
                      {opt.emoji}
                    </span>
                    <span
                      className="text-xs font-bold uppercase tracking-widest mt-0.5"
                      style={{ color: on ? s.labelColor : "#374151" }}
                    >
                      {opt.label}
                    </span>
                    <span
                      className="text-xs leading-tight"
                      style={{ color: on ? s.labelColor : "#9ca3af" }}
                    >
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {formData.aiPolicy === "AMBER" && (
              <div className="space-y-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
                {[
                  { label: "Permitted Uses", field: "aiAmberPermitted" },
                  { label: "Prohibited Uses", field: "aiAmberProhibited" },
                ].map(({ label, field }) => (
                  <div key={field}>
                    <label className="block text-xs font-bold text-amber-700 uppercase tracking-wide mb-1.5">
                      {label}
                    </label>
                    <textarea
                      className="w-full max-w-full box-border bg-white border border-amber-200 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 rounded-lg px-3.5 py-2.5 text-sm outline-none h-24 resize-y transition-all"
                      value={formData[field as keyof typeof formData] as string}
                      onChange={(e) => handleChange(field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
            {formData.aiPolicy === "GREEN" && (
              <div className="p-4 rounded-xl bg-green-50 border border-green-200">
                <label className="block text-xs font-bold text-green-700 uppercase tracking-wide mb-1.5">
                  Permitted Uses
                </label>
                <textarea
                  className="w-full max-w-full box-border bg-white border border-green-200 focus:border-green-500 focus:ring-4 focus:ring-green-500/10 rounded-lg px-3.5 py-2.5 text-sm outline-none h-24 resize-y transition-all"
                  value={formData.aiGreenPermitted}
                  onChange={(e) =>
                    handleChange("aiGreenPermitted", e.target.value)
                  }
                />
              </div>
            )}
          </section>

          {/* 5 — Content Specifications (With Visible Toggles & Dynamic Group Size) */}
          <section
            className="bg-white rounded-xl p-8 overflow-hidden box-border"
            style={{
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <SectionHeading step={5} title="Content Specifications" />
            <div className="space-y-4 max-w-full">
              {textAreas.map((f) => {
                const isToggleable = f.key !== "groupMechanics";
                const isVisible = isToggleable
                  ? sectionToggles[f.key as keyof typeof sectionToggles]
                  : true;

                return (
                  <div
                    key={f.key}
                    className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm max-w-full overflow-hidden box-border"
                  >
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 ${
                        isVisible ? "mb-4" : ""
                      }`}
                    >
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                        {f.label}
                      </label>
                      {isToggleable && (
                        <VisibilityToggle
                          checked={isVisible}
                          onChange={() =>
                            toggleSection(f.key as keyof typeof sectionToggles)
                          }
                        />
                      )}
                    </div>
                    {isVisible && (
                      <div className="space-y-4">
                        {/* Dynamic group size input injected above the mechanics text area */}
                        {f.key === "groupMechanics" && (
                          <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              Target Group Size:
                            </label>
                            <select
                              className={`${INPUT} w-40 py-1.5 px-3 font-medium cursor-pointer`}
                              value={formData.groupSize}
                              onChange={(e) =>
                                handleChange("groupSize", e.target.value)
                              }
                            >
                              <option value="2">2</option>
                              <option value="3">3</option>
                              <option value="4">4</option>
                              <option value="5">5</option>
                              <option value="6">6</option>
                              <option value="2-3">2-3</option>
                              <option value="3-4">3-4</option>
                              <option value="4-5">4-5</option>
                              <option value="5-6">5-6</option>
                              <option value="Variable">Variable</option>
                            </select>
                          </div>
                        )}
                        <textarea
                          className={`${INPUT} font-mono h-28 leading-relaxed resize-y`}
                          value={
                            formData[f.key as keyof typeof formData] as string
                          }
                          onChange={(e) => handleChange(f.key, e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 6 — Evaluation Matrix */}
          <section
            className="bg-white rounded-xl p-8 max-w-full overflow-hidden box-border"
            style={{
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <SectionHeading step={6} title="Evaluation Matrix" />
            <div className="space-y-5 max-w-full">
              {rubricRows.map((row, index) => (
                <div
                  key={row.id}
                  className="rounded-xl border border-slate-200 overflow-hidden box-border max-w-full shadow-sm"
                >
                  {/* Action Bar for the Row */}
                  <div className="flex items-center justify-between px-5 py-3 bg-slate-100/80 border-b border-slate-200">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      Component Row
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRubricRow(row.id)}
                      className="text-[10px] font-extrabold uppercase tracking-wider rounded-md px-3 py-1.5 transition-all"
                      style={{
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        color: "#64748b",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "#fca5a5";
                        e.currentTarget.style.color = "#dc2626";
                        e.currentTarget.style.background = "#fef2f2";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "#e2e8f0";
                        e.currentTarget.style.color = "#64748b";
                        e.currentTarget.style.background = "#fff";
                      }}
                    >
                      ✕ Remove
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end px-5 py-4 bg-slate-50 border-b border-slate-100 max-w-full box-border">
                    <div className="flex-1 min-w-0 w-full">
                      <FieldLabel>Component Name</FieldLabel>
                      <input
                        type="text"
                        className={INPUT}
                        value={row.component}
                        onChange={(e) =>
                          updateRubricRow(row.id, "component", e.target.value)
                        }
                      />
                    </div>
                    <div className="w-full sm:w-32 shrink-0">
                      <FieldLabel>Weight</FieldLabel>
                      <input
                        type="text"
                        className={`${INPUT} text-center`}
                        value={row.weight}
                        onChange={(e) =>
                          updateRubricRow(row.id, "weight", e.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 p-5 max-w-full box-border">
                    {GRADE_BANDS.map((g) => (
                      <div key={g.key} className="max-w-full box-border">
                        <div
                          className={`flex items-center justify-between text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border mb-1.5 ${g.pill}`}
                        >
                          <span>{g.label}</span>
                          <span className="opacity-70 font-medium normal-case">
                            {g.range}
                          </span>
                        </div>
                        <textarea
                          className="w-full max-w-full box-border bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/10 px-3 py-2 rounded-lg text-xs h-24 outline-none resize-none text-slate-700 transition-all"
                          value={row[g.key as keyof typeof row] as string}
                          onChange={(e) =>
                            updateRubricRow(row.id, g.key, e.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addRubricRow}
                className="w-full max-w-full box-border py-4 flex items-center justify-center gap-2 text-xs font-semibold rounded-xl"
                style={{
                  border: "1.5px dashed #c7d2fe",
                  color: "#6366f1",
                  background: "transparent",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#eef2ff";
                  e.currentTarget.style.borderColor = "#818cf8";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "#c7d2fe";
                }}
              >
                + Add Component Row
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* ── Drag-to-resize handle ── */}
      <div
        role="separator"
        aria-label="Drag to resize"
        className="h-full shrink-0 z-20 print:hidden select-none flex items-center justify-center"
        style={{
          width: 20,
          cursor: "col-resize",
          background: "#f1f5f9",
          borderLeft: "1px solid #e2e8f0",
          borderRight: "1px solid #e2e8f0",
          transition: "background-color 0.15s",
        }}
        onMouseDown={handleDividerMouseDown}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#e0e7ff";
          const bars =
            e.currentTarget.querySelectorAll<HTMLElement>(".grip-bar");
          bars.forEach((b) => (b.style.background = "#6366f1"));
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#f1f5f9";
          const bars =
            e.currentTarget.querySelectorAll<HTMLElement>(".grip-bar");
          bars.forEach((b) => (b.style.background = "#94a3b8"));
        }}
      >
        <div
          className="pointer-events-none"
          style={{ display: "flex", gap: 4 }}
        >
          <div
            className="grip-bar"
            style={{
              width: 2,
              height: 28,
              borderRadius: 2,
              background: "#94a3b8",
              transition: "background-color 0.15s",
            }}
          />
          <div
            className="grip-bar"
            style={{
              width: 2,
              height: 28,
              borderRadius: 2,
              background: "#94a3b8",
              transition: "background-color 0.15s",
            }}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          RIGHT — PDF Preview
      ═══════════════════════════════════════════════════════════ */}
      <div className="flex-1 h-full flex flex-col overflow-hidden print:block print:h-auto print:overflow-visible print:bg-white print:p-0 print:m-0">
        {/* Zoom toolbar */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-800 border-b border-slate-900/60 shrink-0 print:hidden">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Preview
          </span>
          <div className="flex items-center gap-1.5">
            <ZoomBtn onClick={() => setZoom((z) => Math.max(40, z - 10))}>
              −
            </ZoomBtn>
            <span className="text-xs text-slate-300 font-mono w-10 text-center tabular-nums">
              {zoom}%
            </span>
            <ZoomBtn onClick={() => setZoom((z) => Math.min(160, z + 10))}>
              +
            </ZoomBtn>
            <div className="w-px h-4 bg-slate-700 mx-1" />
            <button
              type="button"
              onClick={() => setZoom(80)}
              className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-white hover:bg-white/10 rounded-md transition-all duration-150"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Document canvas */}
        <div className="flex-1 overflow-auto bg-slate-700 p-10 flex justify-center items-start print:p-0 print:block print:h-auto print:overflow-visible print:bg-white print:m-0">
          <div
            className="pdf-page box-border mx-auto bg-white text-black font-serif shrink-0 w-[210mm] min-h-[297mm] p-[20mm] shadow-[0_25px_60px_rgba(0,0,0,0.45)] print:w-[210mm] print:min-h-auto print:m-0 print:shadow-none print:block"
            style={{
              zoom: zoom / 100,
            }}
          >
            {/* PDF Header */}
            <div className="mb-8 border-b-[3px] border-black pb-4 text-center print:break-after-avoid">
              <h1 className="text-3xl font-bold uppercase tracking-widest">
                University of East Anglia
              </h1>
              <h2 className="text-[1.2rem] font-semibold mt-2">
                {formData.school}
              </h2>
              <h3 className="text-[1.1rem] mt-2 text-gray-700 italic">
                {formData.programme}
              </h3>
            </div>

            {/* Details table */}
            <table className="w-full text-left border-collapse border border-black mb-8 text-[11pt] break-inside-avoid print:break-inside-avoid">
              <tbody>
                {(
                  [
                    ["Module", formData.module],
                    ["Assessment Type", formData.assessmentType],
                    ["Weighting", formData.weighting],
                    ["Set By / Checked By", formData.setBy],
                    ["Release Date", formatDateOnly(formData.releaseDate)],
                    [
                      "Submission / Exam Date(s)",
                      formData.submissionDates.map((d) =>
                        formatDateTime(d.date, d.description),
                      ),
                    ],
                    ["Submission Location", formData.submissionLocation],
                    ["Return of Feedback", formData.returnOfFeedback],
                  ] as [string, string | string[]][]
                ).map(([label, val], i) => (
                  <tr
                    key={i}
                    className="border-b border-black print:break-inside-avoid"
                  >
                    <th className="py-2.5 px-4 print-bg-gray-light bg-gray-100 w-[35%] border-r border-black font-semibold">
                      {label}
                    </th>
                    <td className="py-2.5 px-4">
                      {Array.isArray(val)
                        ? val.map((v, idx) => (
                            <div key={idx} className={idx > 0 ? "mt-1" : ""}>
                              {v}
                            </div>
                          ))
                        : val}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Overview */}
            {(sectionToggles.contextScenario ||
              sectionToggles.learningOutcomes ||
              selectedSkills.length > 0) && (
              <div className="mb-8 break-inside-avoid print:break-inside-avoid">
                <h3 className="text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                  Overview & Learning Outcomes
                </h3>
                {sectionToggles.contextScenario && (
                  <div className="mb-3">
                    <strong>Context &amp; Scenario:</strong>{" "}
                    <MarkdownRenderer content={formData.contextScenario} />
                  </div>
                )}
                {sectionToggles.learningOutcomes && (
                  <div className="mb-3">
                    <strong>Learning Outcomes Assessed:</strong>{" "}
                    <MarkdownRenderer content={formData.learningOutcomes} />
                  </div>
                )}
                {selectedSkills.length > 0 && (
                  <div className="mb-3">
                    <strong>Employability Skills:</strong>{" "}
                    {selectedSkills.join(", ")}
                  </div>
                )}
              </div>
            )}

            {/* Task Specification */}
            {(formData.groupWorkPermitted === "Yes" ||
              sectionToggles.coreObjectives ||
              sectionToggles.architectureConstraints) && (
              <div className="mb-8 break-inside-avoid print:break-inside-avoid">
                <h3 className="text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                  Task Specification
                </h3>
                {formData.groupWorkPermitted === "Yes" && (
                  <div className="mb-4">
                    <strong>
                      Group Mechanics (Target Size: {formData.groupSize}):
                    </strong>{" "}
                    <MarkdownRenderer content={formData.groupMechanics} />
                  </div>
                )}
                {sectionToggles.coreObjectives && (
                  <div className="mb-4">
                    <strong>Core Objectives:</strong>{" "}
                    <MarkdownRenderer content={formData.coreObjectives} />
                  </div>
                )}
                {sectionToggles.architectureConstraints && (
                  <div className="mb-4">
                    <strong>Architecture &amp; Technical Constraints:</strong>{" "}
                    <MarkdownRenderer
                      content={formData.architectureConstraints}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Deliverables */}
            {(sectionToggles.deliverables ||
              sectionToggles.submissionInstructions) && (
              <div className="mb-8 break-inside-avoid print:break-inside-avoid">
                <h3 className="text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                  Deliverables
                </h3>
                {sectionToggles.deliverables && (
                  <MarkdownRenderer content={formData.deliverables} />
                )}
                {sectionToggles.submissionInstructions && (
                  <>
                    <h4 className="font-bold mt-5 mb-2 print:break-after-avoid">
                      Submission Instructions:
                    </h4>
                    <MarkdownRenderer
                      content={formData.submissionInstructions}
                    />
                  </>
                )}
              </div>
            )}

            {/* Resources & Contact */}
            {(sectionToggles.resourcesHints || sectionToggles.contactInfo) && (
              <div className="mb-8 break-inside-avoid print:break-inside-avoid">
                <h3 className="text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                  Resources &amp; Contact
                </h3>
                {sectionToggles.resourcesHints && (
                  <MarkdownRenderer content={formData.resourcesHints} />
                )}
                {sectionToggles.contactInfo && (
                  <>
                    <h4 className="font-bold mt-4 mb-2 print:break-after-avoid">
                      Contact Information:
                    </h4>
                    <MarkdownRenderer content={formData.contactInfo} />
                  </>
                )}
              </div>
            )}

            {/* Academic Integrity */}
            <div className="mb-8 text-[11pt] leading-relaxed break-inside-avoid print:break-inside-avoid">
              <p className="font-bold text-center underline mb-4 uppercase tracking-wider print:break-after-avoid">
                Please read all the information below carefully
              </p>
              <h3 className="text-[14pt] font-bold border-b-2 border-black mb-3 uppercase tracking-tight print:break-after-avoid">
                Academic Integrity
              </h3>
              <p className="mb-3">
                The University takes academic integrity very seriously. You must
                not commit plagiarism, collusion, or contract cheating in your
                submitted work. Our Policy on Plagiarism, Collusion, and
                Contract Cheating explains:
              </p>
              <ul className="list-disc pl-8 mb-3 space-y-1">
                <li>
                  what is meant by the terms &apos;plagiarism&apos;,
                  &apos;collusion&apos;, and &apos;contract cheating&apos;
                </li>
                <li>
                  how to avoid plagiarism, collusion, and contract cheating
                </li>
                <li>using a proofreader</li>
                <li>
                  what will happen if we suspect that you have breached the
                  policy.
                </li>
              </ul>
              <p className="mb-3">
                It is essential that you read this policy, and you undertake (or
                refresh your memory of) our school&apos;s training on this. You
                can find the policy and related guidance here:
              </p>
              <a
                href="https://my.uea.ac.uk/departments/learningand-teaching/students/academic-cycle/regulations-and-discipline/plagiarism-awareness"
                className="text-blue-800 break-all underline mb-5 block font-medium"
              >
                https://my.uea.ac.uk/departments/learningand-teaching/students/academic-cycle/regulations-and-discipline/plagiarism-awareness
              </a>
              <div className="p-6 sm:p-8 box-border border-2 border-black print-bg-gray-light bg-gray-50 italic mt-4 print:p-6">
                In this assessment, working with others is{" "}
                <strong className="uppercase font-extrabold">
                  {formData.groupWorkPermitted === "Yes"
                    ? "PERMITTED"
                    : "NOT PERMITTED"}
                </strong>
                .{" "}
                {formData.groupWorkPermitted === "No" &&
                  "All aspects of your submission, including but not limited to: research, design, development and writing, must be your own work according to your own understanding of topics. Please pay careful attention to the definitions of contract cheating, plagiarism and collusion in the policy and ask your module organiser if you are unsure about anything."}
              </div>
            </div>

            {/* AI Policy */}
            <div className="mb-8">
              <h3 className="text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                AI Policy and Use
              </h3>
              <p className="mb-4 text-[11pt] leading-relaxed">
                To ensure fairness and clarity, this module uses a Traffic Light
                system to outline exactly how you can and cannot use generative
                AI tools for your assessment.
              </p>

              <div className="break-inside-avoid print:break-inside-avoid">
                <table className="w-full border-collapse border border-black mb-5 font-bold text-center text-[11pt]">
                  <tbody>
                    <tr>
                      <td
                        className={`border border-black p-3 w-1/3 ${formData.aiPolicy === "RED" ? "bg-red-200 print-bg-red" : ""}`}
                      >
                        🔴 RED {formData.aiPolicy === "RED" ? "✓" : ""}
                      </td>
                      <td
                        className={`border border-black p-3 w-1/3 ${formData.aiPolicy === "AMBER" ? "bg-yellow-200 print-bg-yellow" : ""}`}
                      >
                        🟡 AMBER {formData.aiPolicy === "AMBER" ? "✓" : ""}
                      </td>
                      <td
                        className={`border border-black p-3 w-1/3 ${formData.aiPolicy === "GREEN" ? "bg-green-200 print-bg-green" : ""}`}
                      >
                        🟢 GREEN {formData.aiPolicy === "GREEN" ? "✓" : ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="border-[2px] border-black p-6 sm:p-8 box-border print-bg-gray-light bg-gray-50/50 leading-relaxed text-[11pt] print:p-6">
                  {formData.aiPolicy === "RED" && (
                    <>
                      <h4 className="font-bold text-red-800 mb-2 uppercase tracking-wide text-[12pt] print:break-after-avoid">
                        🔴 RED: No Generative AI Permitted
                      </h4>
                      <p className="mb-2">
                        The use of Generative AI tools (e.g., ChatGPT, GitHub
                        Copilot, Claude, Gemini) is{" "}
                        <strong className="text-red-900">
                          strictly prohibited
                        </strong>{" "}
                        for any part of this assessment.
                      </p>
                      <ul className="list-disc pl-6 space-y-1">
                        <li>
                          All code, logic, and writing must be entirely your own
                          creation.
                        </li>
                        <li>
                          Use of AI tools will be treated as academic
                          misconduct.
                        </li>
                      </ul>
                    </>
                  )}
                  {formData.aiPolicy === "AMBER" && (
                    <>
                      <h4 className="font-bold text-yellow-800 mb-2 uppercase tracking-wide text-[12pt] print:break-after-avoid">
                        🟡 AMBER: Restricted AI Usage Permitted
                      </h4>
                      <p className="mb-3">
                        Generative AI tools may be used for specific, restricted
                        purposes within this assessment.
                      </p>
                      <p className="mb-2">
                        <strong>Permitted Uses:</strong>{" "}
                        {formData.aiAmberPermitted}
                      </p>
                      <p className="mb-3">
                        <strong>Prohibited Uses:</strong>{" "}
                        {formData.aiAmberProhibited}
                      </p>
                      <p className="italic">
                        <strong className="not-italic">
                          Declaration Requirement:
                        </strong>{" "}
                        You must explicitly document any allowed AI use. Failure
                        to declare permitted use is considered academic
                        misconduct.
                      </p>
                    </>
                  )}
                  {formData.aiPolicy === "GREEN" && (
                    <>
                      <h4 className="font-bold text-green-800 mb-2 uppercase tracking-wide text-[12pt] print:break-after-avoid">
                        🟢 GREEN: Full AI Integration Encouraged
                      </h4>
                      <p className="mb-3">
                        Generative AI tools are permitted and/or are a core
                        component of this assessment.
                      </p>
                      <p className="mb-3">
                        <strong>Permitted Uses:</strong>{" "}
                        {formData.aiGreenPermitted}
                      </p>
                      <p className="italic">
                        <strong className="not-italic">
                          Declaration Requirement:
                        </strong>{" "}
                        You must include an AI_USAGE.md file detailing which
                        tools were used and how outputs were integrated. You
                        remain fully responsible for the accuracy of any
                        AI-generated content.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Grading matrix */}
            <div className="mb-8">
              <h3 className="text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                Evaluation &amp; Grading Matrix
              </h3>
              <p className="mb-4 text-[11pt] leading-relaxed">
                The final mark is based on the following criteria across the
                standard degree classification boundaries:
              </p>
              <table className="w-full text-left border-collapse border border-black text-[9.5pt] leading-snug">
                <thead className="break-inside-avoid print:break-inside-avoid">
                  <tr className="print-bg-gray bg-gray-100 text-center border-b-2 border-black font-bold">
                    <th className="border-r border-black p-2 w-28">
                      Component
                    </th>
                    <th className="border-r border-black p-2 w-12">Weight</th>
                    <th className="border-r border-black p-2">
                      Fail (&lt;40%)
                    </th>
                    <th className="border-r border-black p-2">Pass (40-49%)</th>
                    <th className="border-r border-black p-2">2:2 (50-59%)</th>
                    <th className="border-r border-black p-2">2:1 (60-69%)</th>
                    <th className="border-r border-black p-2">1st (70-84%)</th>
                    <th className="p-2">Excelled (85%+)</th>
                  </tr>
                </thead>
                <tbody>
                  {rubricRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-black align-top break-inside-avoid print:break-inside-avoid"
                    >
                      <td className="border-r border-black p-2.5 font-bold print-bg-gray-light bg-gray-50">
                        {row.component}
                      </td>
                      <td className="border-r border-black p-2.5 text-center font-bold print-bg-gray-light bg-gray-50">
                        {row.weight}
                      </td>
                      <td className="border-r border-black p-2.5">
                        {row.fail}
                      </td>
                      <td className="border-r border-black p-2.5">
                        {row.pass}
                      </td>
                      <td className="border-r border-black p-2.5">
                        {row.twoTwo}
                      </td>
                      <td className="border-r border-black p-2.5">
                        {row.twoOne}
                      </td>
                      <td className="border-r border-black p-2.5">
                        {row.first}
                      </td>
                      <td className="p-2.5">{row.excelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
