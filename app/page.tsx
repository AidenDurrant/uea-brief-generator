"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import SKILLS_LIST from "./skills.json";
import ASSESSMENT_METHODS from "./assessments.json";
import TEMPLATE from "./template.json";

// ─── Constants & Extracted Text ───────────────────────────────────────────────
const DRAFT_STORAGE_KEY = "uea_brief_draft_v2";
const DB_STORAGE_KEY = "uea_briefs_db";

const DEFAULT_STATIC_CONTENT = {
  academicIntegrity: {
    title: "Academic Integrity",
    warning: "Please read all the information below carefully",
    body: "The University takes academic integrity very seriously. You must not commit plagiarism, collusion, or contract cheating in your submitted work. Our Policy on Plagiarism, Collusion, and Contract Cheating explains:\n\n* what is meant by the terms 'plagiarism', 'collusion', and 'contract cheating'\n* how to avoid plagiarism, collusion, and contract cheating\n* using a proofreader\n* what will happen if we suspect that you have breached the policy.\n\nIt is essential that you read this policy, and you undertake (or refresh your memory of) our school's training on this. You can find the policy and related guidance here:\n\n[https://my.uea.ac.uk/departments/learningand-teaching/students/academic-cycle/regulations-and-discipline/plagiarism-awareness](https://my.uea.ac.uk/departments/learningand-teaching/students/academic-cycle/regulations-and-discipline/plagiarism-awareness)",
    groupWorkPrefix: "In this assessment, working with others is",
    individualWarning:
      "All aspects of your submission, including but not limited to: research, design, development and writing, must be your own work according to your own understanding of topics. Please pay careful attention to the definitions of contract cheating, plagiarism and collusion in the policy and ask your module organiser if you are unsure about anything.",
  },
  aiPolicy: {
    title: "AI Policy and Use",
    preamble:
      "To ensure fairness and clarity, this module uses a Traffic Light system to outline exactly how you can and cannot use generative AI tools for your assessment.",
    redTitle: "🔴 RED: No Generative AI Permitted",
    redBody:
      "The use of Generative AI tools (e.g., ChatGPT, GitHub Copilot, Claude, Gemini) is **strictly prohibited** for any part of this assessment.\n\n* All code, logic, and writing must be entirely your own creation.\n* Use of AI tools will be treated as academic misconduct.",
    amberTitle: "🟡 AMBER: Restricted AI Usage Permitted",
    amberBody:
      "Generative AI tools may be used for specific, restricted purposes within this assessment.",
    amberDeclaration:
      "**Declaration Requirement:** You must explicitly document any allowed AI use. Failure to declare permitted use is considered academic misconduct.",
    greenTitle: "🟢 GREEN: Full AI Integration Encouraged",
    greenBody:
      "Generative AI tools are permitted and/or are a core component of this assessment.",
    greenDeclaration:
      "**Declaration Requirement:** You must include an AI_USAGE.md file detailing which tools were used and how outputs were integrated. You remain fully responsible for the accuracy of any AI-generated content.",
  },
};

// @ts-ignore - gracefully fall back if staticContent isn't in template.json yet
const staticContent = TEMPLATE.staticContent || DEFAULT_STATIC_CONTENT;

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

const AI_OPTIONS = [
  { value: "RED", emoji: "🔴", label: "RED", desc: "No AI Permitted" },
  { value: "AMBER", emoji: "🟡", label: "AMBER", desc: "Restricted Use" },
  { value: "GREEN", emoji: "🟢", label: "GREEN", desc: "Full Integration" },
];

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

const MarkdownRenderer = ({
  content,
  images,
}: {
  content: string;
  images?: Record<string, string>;
}) => {
  return (
    <div className="markdown-content text-[11pt] leading-relaxed text-black">
      <style>{`.markdown-content::after { content: ""; display: table; clear: both; } .markdown-content img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }`}</style>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(value: string) => value}
        components={{
          img: ({ node, src, alt, ...props }) => {
            if (!src) return null;
            let finalSrc = typeof src === "string" ? src : "";

            if (
              typeof src === "string" &&
              src.startsWith("attachment:") &&
              images
            ) {
              const imgId = src.replace("attachment:", "");
              finalSrc = images[imgId] || src;
            }

            let finalAlt = alt || "";
            let imgWidth: string | undefined = undefined;
            let imgAlign = "center";
            if (alt && typeof alt === "string" && alt.includes("|")) {
              const parts = alt.split("|").map((p) => p.trim());
              const lastPart = parts[parts.length - 1].toLowerCase();
              if (["left", "right", "center"].includes(lastPart))
                imgAlign = parts.pop() || "center";
              if (parts.length > 1) imgWidth = parts.pop();
              finalAlt = parts.join(" | ").trim();
            }

            const imgStyle: React.CSSProperties = { width: imgWidth };
            if (imgAlign === "left") {
              imgStyle.float = "left";
              imgStyle.margin = "0.5rem 1.5rem 0.5rem 0";
            } else if (imgAlign === "right") {
              imgStyle.float = "right";
              imgStyle.margin = "0.5rem 0 0.5rem 1.5rem";
            } else {
              imgStyle.display = "block";
              imgStyle.margin = "1rem auto";
            }

            return (
              <img src={finalSrc} alt={finalAlt} style={imgStyle} {...props} />
            );
          },
        }}
      >
        {content || ""}
      </ReactMarkdown>
    </div>
  );
};

function SectionHeading({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="flex items-center justify-center shrink-0 text-xs font-bold select-none bg-indigo-50 text-indigo-600 rounded-full w-6 h-6">
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
        className={`px-4 py-1.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md transition-all duration-200 ${checked ? "bg-indigo-600 text-white shadow-md" : "text-slate-500 hover:text-slate-700 hover:bg-slate-300/50"}`}
      >
        Visible
      </button>
      <button
        type="button"
        onClick={() => checked && onChange()}
        className={`px-4 py-1.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md transition-all duration-200 ${!checked ? "bg-slate-600 text-white shadow-md" : "text-slate-500 hover:text-slate-700 hover:bg-slate-300/50"}`}
      >
        Hidden
      </button>
    </div>
  );
}

// ─── Default State Generator ──────────────────────────────────────────────────
const getDefaultState = () => {
  const data: Record<string, any> = {
    assessmentType: "Prompt Portfolio",
    groupWorkPermitted: "No",
    groupSize: TEMPLATE.groupWorkDefault.size,
    groupMechanics: TEMPLATE.groupWorkDefault.mechanics,
    submissionDates: [
      { id: Date.now(), date: "2026-05-22T15:00", description: "Code/Report" },
    ],
    aiPolicy: "RED",
    ...TEMPLATE.aiPolicyDefaults,
  };
  TEMPLATE.headerFields.forEach((f) => (data[f.id] = f.default));
  TEMPLATE.contentSections.forEach((f) => (data[f.id] = f.defaultText));

  const toggles: Record<string, boolean> = { gradingMatrix: true };
  TEMPLATE.contentSections.forEach((f) => (toggles[f.id] = true));

  const rubrics = [
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
  ];

  return {
    formData: data,
    sectionToggles: toggles,
    selectedSkills: [] as string[],
    rubricRows: rubrics,
    uploadedImages: {} as Record<string, string>,
  };
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function BriefGenerator() {
  const defaults = getDefaultState();
  const [isClient, setIsClient] = useState(false);

  const [zoom, setZoom] = useState(80);
  const [panelWidth, setPanelWidth] = useState(46);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Database / API States
  const [briefsList, setBriefsList] = useState<any[]>([]);
  const [currentBriefId, setCurrentBriefId] = useState<string | null>(null);

  // Form States (Safely initialized to prevent undefined mapping crashes)
  const [formData, setFormData] = useState<Record<string, any>>(
    defaults.formData,
  );
  const [sectionToggles, setSectionToggles] = useState<Record<string, boolean>>(
    defaults.sectionToggles,
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    defaults.selectedSkills,
  );
  const [uploadedImages, setUploadedImages] = useState<Record<string, string>>(
    defaults.uploadedImages,
  );
  const [rubricRows, setRubricRows] = useState<any[]>(defaults.rubricRows);

  // Load Data safely
  useEffect(() => {
    setIsClient(true);

    // Load Mock DB
    try {
      const db = JSON.parse(localStorage.getItem(DB_STORAGE_KEY) || "[]");
      setBriefsList(Array.isArray(db) ? db : []);
    } catch (e) {
      setBriefsList([]);
    }

    // Load Draft
    const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        // Merge saved data strictly over defaults to guarantee the schema is completely intact
        setFormData({ ...defaults.formData, ...(parsed.formData || {}) });
        setSectionToggles({
          ...defaults.sectionToggles,
          ...(parsed.sectionToggles || {}),
        });
        setSelectedSkills(parsed.selectedSkills || defaults.selectedSkills);
        setRubricRows(
          parsed.rubricRows?.length ? parsed.rubricRows : defaults.rubricRows,
        );
        setUploadedImages(parsed.uploadedImages || defaults.uploadedImages);
        setCurrentBriefId(parsed.currentBriefId || null);
      } catch (error) {
        console.error("Failed to parse draft:", error);
      }
    }
  }, []);

  // Auto-save draft
  useEffect(() => {
    if (!isClient) return;
    const draft = {
      formData,
      sectionToggles,
      selectedSkills,
      rubricRows,
      uploadedImages,
      currentBriefId,
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [
    formData,
    sectionToggles,
    selectedSkills,
    rubricRows,
    uploadedImages,
    currentBriefId,
    isClient,
  ]);

  // ALL HOOKS MUST BE DECLARED BEFORE ANY EARLY RETURNS
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

  // Prevent server-side render mismatch crashes
  if (!isClient) return null;

  // Actions
  const loadDefault = () => {
    setFormData(defaults.formData);
    setSectionToggles(defaults.sectionToggles);
    setSelectedSkills(defaults.selectedSkills);
    setRubricRows(defaults.rubricRows);
    setUploadedImages(defaults.uploadedImages);
    setCurrentBriefId(null);
    if (typeof window !== "undefined" && window.innerWidth < 768)
      setIsSidebarOpen(false);
  };

  const handleLoadBrief = (briefId: string) => {
    const brief = briefsList.find((b) => b.id === briefId);
    if (!brief) return;

    setFormData({ ...defaults.formData, ...(brief.formData || {}) });
    setSectionToggles({
      ...defaults.sectionToggles,
      ...(brief.sectionToggles || {}),
    });
    setSelectedSkills(brief.selectedSkills || defaults.selectedSkills);
    setRubricRows(
      brief.rubricRows?.length ? brief.rubricRows : defaults.rubricRows,
    );
    setUploadedImages(brief.uploadedImages || defaults.uploadedImages);
    setCurrentBriefId(brief.id);
    if (typeof window !== "undefined" && window.innerWidth < 768)
      setIsSidebarOpen(false);
  };

  const handleDeleteBrief = (e: React.MouseEvent, briefId: string) => {
    e.stopPropagation();
    if (window.confirm("Delete this saved brief forever?")) {
      const updatedList = briefsList.filter((b) => b.id !== briefId);
      setBriefsList(updatedList);
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(updatedList));
      if (currentBriefId === briefId) loadDefault();
    }
  };

  const handleSaveToDatabase = () => {
    const title = formData.module || "Untitled Assessment";
    const payload = {
      formData,
      sectionToggles,
      selectedSkills,
      rubricRows,
      uploadedImages,
      aiPolicy: formData.aiPolicy,
      assessmentType: formData.assessmentType,
    };

    let updatedList = [...briefsList];
    let newId = currentBriefId;

    if (newId) {
      updatedList = updatedList.map((b) =>
        b.id === newId ? { ...b, title, updated: Date.now(), ...payload } : b,
      );
    } else {
      newId = Date.now().toString();
      updatedList.unshift({
        id: newId,
        title,
        updated: Date.now(),
        ...payload,
      });
    }

    setBriefsList(updatedList);
    setCurrentBriefId(newId);
    localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(updatedList));
    alert("Brief saved successfully to local database!");
  };

  const handleClearDraft = () => {
    if (
      window.confirm(
        "Are you sure you want to clear your draft and start over with the default template?",
      )
    ) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      loadDefault();
    }
  };

  const toggleSection = (key: string) =>
    setSectionToggles((prev) => ({ ...prev, [key]: !prev[key] }));
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

  const addSubmissionDate = () =>
    setFormData((p) => ({
      ...p,
      submissionDates: [
        ...(p.submissionDates || []),
        { id: Date.now(), date: "", description: "" },
      ],
    }));
  const updateSubmissionDate = (
    id: number,
    field: "date" | "description",
    val: string,
  ) =>
    setFormData((p) => ({
      ...p,
      submissionDates: (p.submissionDates || []).map((d: any) =>
        d.id === id ? { ...d, [field]: val } : d,
      ),
    }));
  const removeSubmissionDate = (id: number) =>
    setFormData((p) => ({
      ...p,
      submissionDates: (p.submissionDates || []).filter(
        (d: any) => d.id !== id,
      ),
    }));

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    fieldId: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 800;
        let [w, h] = [img.width, img.height];
        if (w > h && w > MAX) {
          h *= MAX / w;
          w = MAX;
        } else if (h > MAX) {
          w *= MAX / h;
          h = MAX;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        const imgId = "img-" + Date.now();
        setUploadedImages((prev) => ({ ...prev, [imgId]: dataUrl }));
        setFormData((prev) => ({
          ...prev,
          [fieldId]:
            (prev[fieldId] || "") +
            `\n\n![Image | 100% | center](attachment:${imgId})\n`,
        }));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleTab = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    updateFn: (val: string) => void,
  ) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;
      const newValue = value.substring(0, start) + "\t" + value.substring(end);
      updateFn(newValue);
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 1;
      }, 0);
    }
  };

  const currentAssessment =
    formData.assessmentType === "Other"
      ? {
          method: "Other",
          tier: "Custom",
          category: "Custom",
          desc: formData.customAssessmentDesc || "",
        }
      : ASSESSMENT_METHODS.find((a) => a.method === formData.assessmentType) ||
        ASSESSMENT_METHODS[0];

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans bg-slate-900 print:block print:h-auto print:overflow-visible print:bg-white">
      {/* ═══════════════════════════════════════════════════════════
          SIDEBAR — Database Form Manager
      ═══════════════════════════════════════════════════════════ */}
      <div
        className="shrink-0 flex flex-col bg-slate-900 shadow-2xl text-slate-300 print:hidden z-30 transition-all duration-300 ease-in-out overflow-hidden border-slate-800"
        style={{
          width: isSidebarOpen ? 256 : 0,
          opacity: isSidebarOpen ? 1 : 0,
          borderRightWidth: isSidebarOpen ? 1 : 0,
        }}
      >
        <div
          style={{ width: "256px" }}
          className="flex flex-col h-full shrink-0"
        >
          <div className="p-5 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/50">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                className="shrink-0 text-indigo-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                />
              </svg>
              <span className="text-xs font-bold text-white tracking-widest uppercase">
                My Briefs
              </span>
            </div>
            <button
              type="button"
              onClick={loadDefault}
              className="text-xs font-bold text-indigo-400 hover:text-white bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-1 rounded transition-colors"
            >
              + New
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {briefsList.length === 0 && (
              <div className="text-xs text-slate-500 text-center p-6 border border-dashed border-slate-700/50 rounded-lg mt-2">
                No saved briefs yet. <br /> Click + New to start.
              </div>
            )}
            {briefsList.map((brief) => (
              <div
                key={brief.id}
                onClick={() => handleLoadBrief(brief.id)}
                className={`group flex items-center justify-between w-full text-left px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 ${
                  currentBriefId === brief.id
                    ? "bg-indigo-600 text-white shadow-md"
                    : "hover:bg-slate-800 text-slate-400"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">
                    {brief.title}
                  </div>
                  <div
                    className={`text-[10px] mt-0.5 font-medium ${currentBriefId === brief.id ? "text-indigo-200" : "text-slate-500"}`}
                  >
                    {new Date(brief.updated).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteBrief(e, brief.id)}
                  className={`shrink-0 ml-2 p-1.5 rounded-md hover:bg-red-500 hover:text-white transition-colors ${currentBriefId === brief.id ? "text-indigo-200 hover:text-white" : "text-slate-600 opacity-0 group-hover:opacity-100"}`}
                  title="Delete brief"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    className="shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 flex overflow-hidden bg-white relative"
      >
        {/* ═══════════════════════════════════════════════════════════
            LEFT — Editor
        ═══════════════════════════════════════════════════════════ */}
        <div
          className="h-full flex flex-col print:hidden shrink-0 overflow-hidden"
          style={{ width: `${panelWidth}%`, minWidth: 300 }}
        >
          <header
            className="shrink-0 flex items-center justify-between shadow-sm z-20"
            style={{
              background: "#fff",
              borderBottom: "1px solid #e8eaed",
              paddingLeft: 20,
              paddingRight: 30,
              paddingTop: 14,
              paddingBottom: 14,
            }}
          >
            <div className="flex items-center gap-3">
              {/* Hamburger Menu Toggle */}
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors mr-1"
                title="Toggle Sidebar"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  className="shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>

              <img
                src="/UEA_Logo_BLK_MONO_N_A_59244.png"
                alt="UEA"
                style={{ width: 150, height: 36 }}
              />
              <div className="hidden xl:block ml-2">
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

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClearDraft}
                className="hidden xl:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors active:scale-95"
              >
                Clear Draft
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors active:scale-95"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  className="shrink-0"
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
              <div className="w-px h-5 bg-slate-200 mx-1"></div>
              <button
                type="button"
                onClick={handleSaveToDatabase}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors active:scale-95 shadow-sm"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  className="shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                {currentBriefId ? "Update" : "Save New"}
              </button>
            </div>
          </header>

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
                {/* Dynamic Headers from JSON */}
                {TEMPLATE.headerFields.map((field) => (
                  <div key={field.id}>
                    <FieldLabel>{field.label}</FieldLabel>
                    {field.id === "weighting" ? (
                      <div className="flex">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className={INPUT}
                          style={{
                            borderTopRightRadius: 0,
                            borderBottomRightRadius: 0,
                          }}
                          value={
                            typeof formData[field.id] === "string"
                              ? formData[field.id].replace("%", "")
                              : formData[field.id] || ""
                          }
                          onChange={(e) => {
                            let val = e.target.value;
                            if (val === "") {
                              handleChange(field.id, "");
                            } else {
                              let num = parseInt(val, 10);
                              if (num < 0) num = 0;
                              if (num > 100) num = 100;
                              handleChange(field.id, num.toString() + "%");
                            }
                          }}
                        />
                        <span
                          className="flex items-center px-4 bg-slate-100 border border-l-0 border-slate-200 text-slate-500 font-bold text-sm"
                          style={{
                            borderTopRightRadius: "0.5rem",
                            borderBottomRightRadius: "0.5rem",
                          }}
                        >
                          %
                        </span>
                      </div>
                    ) : (
                      <input
                        type={field.type || "text"}
                        className={INPUT}
                        value={formData[field.id] || ""}
                        onChange={(e) => handleChange(field.id, e.target.value)}
                      />
                    )}
                  </div>
                ))}

                {/* Dynamic Submission Dates Field with Flex Wrap */}
                <div className="pt-2 border-t border-slate-100">
                  <FieldLabel>Submission / Exam Date(s)</FieldLabel>
                  <div className="space-y-3">
                    {formData.submissionDates?.map((item: any) => (
                      <div key={item.id} className="flex flex-wrap gap-2">
                        <input
                          type="datetime-local"
                          className={`${INPUT} flex-1 min-w-[200px] shrink-0 font-medium`}
                          value={item.date || ""}
                          onChange={(e) =>
                            updateSubmissionDate(
                              item.id,
                              "date",
                              e.target.value,
                            )
                          }
                        />
                        <div className="flex flex-1 min-w-[200px] gap-2">
                          <input
                            type="text"
                            className={`${INPUT} flex-1`}
                            value={item.description || ""}
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
                  value={formData.assessmentType || ""}
                  onChange={(e) =>
                    handleChange("assessmentType", e.target.value)
                  }
                >
                  {ASSESSMENT_METHODS.map((a) => (
                    <option key={a.method} value={a.method}>
                      {a.method}
                    </option>
                  ))}
                  <option value="Other">Other...</option>
                </select>

                {formData.assessmentType === "Other" ? (
                  <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                    <div>
                      <FieldLabel>Assessment Title</FieldLabel>
                      <input
                        type="text"
                        className={INPUT}
                        placeholder="e.g., Live Exhibition"
                        value={formData.customAssessmentName || ""}
                        onChange={(e) =>
                          handleChange("customAssessmentName", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <FieldLabel>Description</FieldLabel>
                      <textarea
                        className={`${INPUT} h-24 resize-y`}
                        placeholder="Describe the nature of this custom assessment..."
                        value={formData.customAssessmentDesc || ""}
                        onChange={(e) =>
                          handleChange("customAssessmentDesc", e.target.value)
                        }
                        onKeyDown={(e) =>
                          handleTab(e, (val) =>
                            handleChange("customAssessmentDesc", val),
                          )
                        }
                      />
                    </div>
                  </div>
                ) : (
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
                )}
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
              <div className="mb-0">
                <FieldLabel>Group Work</FieldLabel>
                <div
                  className="flex p-1 gap-1 rounded-xl"
                  style={{ background: "#f1f5f9" }}
                >
                  {[
                    ["No", "Individual Assignment"],
                    ["Yes", "Group Work Permitted"],
                  ].map(([val, display]) => {
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
                            xmlns="http://www.w3.org/2000/svg"
                            width="11"
                            height="11"
                            className="shrink-0"
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

              <div
                style={{
                  borderTop: "1px solid #f1f5f9",
                  marginTop: 28,
                  paddingTop: 28,
                }}
              >
                <FieldLabel>Employability Skills Assessed</FieldLabel>
                <div
                  className="mt-4 max-h-[340px] overflow-y-auto border border-slate-200 rounded-2xl bg-slate-50/50 p-3 space-y-2 shadow-inner"
                  style={{ scrollbarWidth: "thin" }}
                >
                  {SKILLS_LIST.map((skillItem: any) => {
                    const skillName =
                      typeof skillItem === "string"
                        ? skillItem
                        : skillItem.name;
                    const skillDesc =
                      typeof skillItem === "string"
                        ? ""
                        : skillItem.description;
                    const on = selectedSkills.includes(skillName);

                    return (
                      <label
                        key={skillName}
                        className={`group flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200 border ${
                          on
                            ? "bg-indigo-50 border-indigo-300 shadow-sm shadow-indigo-100"
                            : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-center justify-center shrink-0 mt-0.5">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleSkill(skillName)}
                            className="w-5 h-5 cursor-pointer accent-indigo-600 transition-all"
                          />
                        </div>
                        <div className="flex flex-col flex-1">
                          <span
                            className={`text-[12px] font-extrabold uppercase tracking-widest ${on ? "text-indigo-900" : "text-slate-700"}`}
                          >
                            {skillName}
                          </span>
                          {skillDesc && (
                            <span
                              className={`text-[13px] mt-1 font-medium leading-relaxed ${on ? "text-indigo-700/90" : "text-slate-500"}`}
                            >
                              {skillDesc}
                            </span>
                          )}
                        </div>
                      </label>
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
                        value={
                          (formData[
                            field as keyof typeof formData
                          ] as string) || ""
                        }
                        onChange={(e) => handleChange(field, e.target.value)}
                        onKeyDown={(e) =>
                          handleTab(e, (val) => handleChange(field, val))
                        }
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
                    value={formData.aiGreenPermitted || ""}
                    onChange={(e) =>
                      handleChange("aiGreenPermitted", e.target.value)
                    }
                    onKeyDown={(e) =>
                      handleTab(e, (val) =>
                        handleChange("aiGreenPermitted", val),
                      )
                    }
                  />
                </div>
              )}
            </section>

            {/* 5 — Content Specifications (Dynamic from JSON) */}
            <section
              className="bg-white rounded-xl p-8 overflow-hidden box-border"
              style={{
                boxShadow:
                  "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <SectionHeading step={5} title="Content Specifications" />
              <div className="space-y-4 max-w-full">
                {/* Special Injection for Group Mechanics Editor if Permitted */}
                {formData.groupWorkPermitted === "Yes" && (
                  <div className="p-5 rounded-2xl border border-indigo-200 bg-indigo-50 shadow-sm max-w-full overflow-hidden box-border">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-bold text-indigo-800 uppercase tracking-wider">
                          Group Mechanics
                        </label>
                        <label className="cursor-pointer text-[9px] font-extrabold uppercase tracking-wider rounded transition-all duration-200 px-2 py-1 bg-white hover:bg-indigo-100 text-indigo-600 border border-indigo-200 flex items-center gap-1 shadow-sm">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            className="shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect
                              x="3"
                              y="3"
                              width="18"
                              height="18"
                              rx="2"
                              ry="2"
                            ></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                          </svg>
                          Add Image
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) =>
                              handleImageUpload(e, "groupMechanics")
                            }
                          />
                        </label>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 border-b border-indigo-200 pb-4">
                        <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                          Target Group Size:
                        </label>
                        <select
                          className={`${INPUT} w-40 py-1.5 px-3 font-medium cursor-pointer border-indigo-200`}
                          value={formData.groupSize || ""}
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
                      <textarea
                        className={`${INPUT} font-mono h-28 leading-relaxed resize-y border-indigo-200 focus:border-indigo-500`}
                        value={(formData.groupMechanics as string) || ""}
                        onChange={(e) =>
                          handleChange("groupMechanics", e.target.value)
                        }
                        onKeyDown={(e) =>
                          handleTab(e, (val) =>
                            handleChange("groupMechanics", val),
                          )
                        }
                      />
                    </div>
                  </div>
                )}

                {/* Loop through JSON content sections (excluding Eval block) */}
                {TEMPLATE.contentSections
                  .filter((f) => f.pdfGroup !== "Evaluation & Grading")
                  .map((f) => {
                    const isVisible = sectionToggles[f.id];
                    return (
                      <div
                        key={f.id}
                        className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm max-w-full overflow-hidden box-border"
                      >
                        <div
                          className={`flex flex-wrap items-center justify-between gap-2 ${isVisible ? "mb-4" : ""}`}
                        >
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                              {f.label}
                            </label>
                            {isVisible && (
                              <label className="cursor-pointer text-[9px] font-extrabold uppercase tracking-wider rounded transition-all duration-200 px-2 py-1 bg-white hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 border border-slate-200 flex items-center gap-1 shadow-sm">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="10"
                                  height="10"
                                  className="shrink-0"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <rect
                                    x="3"
                                    y="3"
                                    width="18"
                                    height="18"
                                    rx="2"
                                    ry="2"
                                  ></rect>
                                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                  <polyline points="21 15 16 10 5 21"></polyline>
                                </svg>
                                Add Image
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => handleImageUpload(e, f.id)}
                                />
                              </label>
                            )}
                          </div>
                          <VisibilityToggle
                            checked={!!isVisible}
                            onChange={() => toggleSection(f.id)}
                          />
                        </div>
                        {isVisible && (
                          <textarea
                            className={`${INPUT} font-mono h-28 leading-relaxed resize-y`}
                            value={(formData[f.id] as string) || ""}
                            onChange={(e) => handleChange(f.id, e.target.value)}
                            onKeyDown={(e) =>
                              handleTab(e, (val) => handleChange(f.id, val))
                            }
                          />
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
              <SectionHeading step={6} title="Evaluation & Grading" />
              <div className="space-y-4 max-w-full">
                {/* Loop through JSON content sections (specifically the Eval block) */}
                {TEMPLATE.contentSections
                  .filter((f) => f.pdfGroup === "Evaluation & Grading")
                  .map((f) => {
                    const isVisible = sectionToggles[f.id];
                    return (
                      <div
                        key={f.id}
                        className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm max-w-full overflow-hidden box-border"
                      >
                        <div
                          className={`flex flex-wrap items-center justify-between gap-2 ${isVisible ? "mb-4" : ""}`}
                        >
                          <div className="flex items-center gap-3">
                            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                              {f.label}
                            </label>
                            {isVisible && (
                              <label className="cursor-pointer text-[9px] font-extrabold uppercase tracking-wider rounded transition-all duration-200 px-2 py-1 bg-white hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 border border-slate-200 flex items-center gap-1 shadow-sm">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="10"
                                  height="10"
                                  className="shrink-0"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <rect
                                    x="3"
                                    y="3"
                                    width="18"
                                    height="18"
                                    rx="2"
                                    ry="2"
                                  ></rect>
                                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                  <polyline points="21 15 16 10 5 21"></polyline>
                                </svg>
                                Add Image
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => handleImageUpload(e, f.id)}
                                />
                              </label>
                            )}
                          </div>
                          <VisibilityToggle
                            checked={!!isVisible}
                            onChange={() => toggleSection(f.id)}
                          />
                        </div>
                        {isVisible && (
                          <textarea
                            className={`${INPUT} font-mono h-28 leading-relaxed resize-y`}
                            value={(formData[f.id] as string) || ""}
                            onChange={(e) => handleChange(f.id, e.target.value)}
                            onKeyDown={(e) =>
                              handleTab(e, (val) => handleChange(f.id, val))
                            }
                          />
                        )}
                      </div>
                    );
                  })}

                {/* The Matrix Builder */}
                <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm max-w-full overflow-hidden box-border">
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 ${sectionToggles.gradingMatrix ? "mb-4" : ""}`}
                  >
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Grading Matrix Table
                    </label>
                    <VisibilityToggle
                      checked={!!sectionToggles.gradingMatrix}
                      onChange={() => toggleSection("gradingMatrix")}
                    />
                  </div>

                  {sectionToggles.gradingMatrix && (
                    <div className="space-y-5 max-w-full">
                      {rubricRows.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-xl border border-slate-200 overflow-hidden box-border max-w-full shadow-sm"
                        >
                          <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200">
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
                                value={row.component || ""}
                                onChange={(e) =>
                                  updateRubricRow(
                                    row.id,
                                    "component",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="w-full sm:w-32 shrink-0">
                              <FieldLabel>Weight</FieldLabel>
                              <input
                                type="text"
                                className={`${INPUT} text-center`}
                                value={row.weight || ""}
                                onChange={(e) =>
                                  updateRubricRow(
                                    row.id,
                                    "weight",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 p-5 bg-slate-50 max-w-full box-border">
                            {GRADE_BANDS.map((g) => (
                              <div
                                key={g.key}
                                className="max-w-full box-border"
                              >
                                <div
                                  className={`flex items-center justify-between text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border mb-1.5 ${g.pill}`}
                                >
                                  <span>{g.label}</span>
                                  <span className="opacity-70 font-medium normal-case">
                                    {g.range}
                                  </span>
                                </div>
                                <textarea
                                  className="w-full max-w-full box-border bg-white border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/10 px-3 py-2 rounded-lg text-xs h-24 outline-none resize-none text-slate-700 transition-all"
                                  value={
                                    (row[
                                      g.key as keyof typeof row
                                    ] as string) || ""
                                  }
                                  onChange={(e) =>
                                    updateRubricRow(
                                      row.id,
                                      g.key,
                                      e.target.value,
                                    )
                                  }
                                  onKeyDown={(e) =>
                                    handleTab(e, (val) =>
                                      updateRubricRow(row.id, g.key, val),
                                    )
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
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* ── Drag-to-resize handle ── */}
        <div
          role="separator"
          aria-label="Drag to resize"
          className="h-full shrink-0 z-20 print:hidden select-none flex items-center justify-center bg-slate-100 border-l border-r border-slate-200"
          style={{
            width: 20,
            cursor: "col-resize",
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
              style={{ zoom: zoom / 100 }}
            >
              {/* PDF Header */}
              <div className="mb-8 border-b-[3px] border-black pb-4 text-center print:break-after-avoid">
                <h1 className="text-3xl font-bold uppercase tracking-widest">
                  {TEMPLATE.documentTitles?.institution ||
                    "University of East Anglia"}
                </h1>
                <h2 className="text-[1.2rem] font-semibold mt-2">
                  {formData.school}
                </h2>
                <h3 className="text-[1.1rem] mt-2 text-gray-700 italic">
                  {formData.programme}
                </h3>
              </div>

              {/* Details table (Dynamically mapped from JSON) */}
              <table className="w-full text-left border-collapse border border-black mb-8 text-[11pt] break-inside-avoid print:break-inside-avoid">
                <tbody>
                  {TEMPLATE.headerFields
                    .filter((f) => f.id !== "school" && f.id !== "programme")
                    .map((field, i) => (
                      <tr
                        key={i}
                        className="border-b border-black print:break-inside-avoid"
                      >
                        <th className="py-2.5 px-4 print-bg-gray-light bg-gray-100 w-[35%] border-r border-black font-semibold">
                          {field.label}
                        </th>
                        <td className="py-2.5 px-4">
                          {field.type === "date"
                            ? formatDateOnly(formData[field.id] as string)
                            : (formData[field.id] as string)}
                        </td>
                      </tr>
                    ))}
                  <tr className="border-b border-black print:break-inside-avoid">
                    <th className="py-2.5 px-4 print-bg-gray-light bg-gray-100 w-[35%] border-r border-black font-semibold">
                      Submission / Exam Date(s)
                    </th>
                    <td className="py-2.5 px-4">
                      {formData.submissionDates?.map((d: any, idx: number) => (
                        <div key={idx} className={idx > 0 ? "mt-1" : ""}>
                          {formatDateTime(d.date, d.description)}
                        </div>
                      ))}
                    </td>
                  </tr>
                  <tr className="border-b border-black print:break-inside-avoid">
                    <th className="py-2.5 px-4 print-bg-gray-light bg-gray-100 w-[35%] border-r border-black font-semibold">
                      Submission Location
                    </th>
                    <td className="py-2.5 px-4">
                      {formData.submissionLocation as string}
                    </td>
                  </tr>
                  <tr className="border-b border-black print:break-inside-avoid">
                    <th className="py-2.5 px-4 print-bg-gray-light bg-gray-100 w-[35%] border-r border-black font-semibold">
                      Return of Feedback
                    </th>
                    <td className="py-2.5 px-4">
                      {formData.returnOfFeedback as string}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Dynamic Content Sections Mapping */}
              {TEMPLATE.pdfGroupOrder.map((groupTitle) => {
                const sectionsInGroup = TEMPLATE.contentSections.filter(
                  (s) => s.pdfGroup === groupTitle,
                );
                const isOverview =
                  groupTitle === "Overview & Learning Outcomes";
                const isTaskSpec = groupTitle === "Task Specification";
                const isEvalGroup = groupTitle === "Evaluation & Grading";

                const hasVisibleDynamic = sectionsInGroup.some(
                  (s) => sectionToggles[s.id] && formData[s.id],
                );
                const hasSkills = isOverview && selectedSkills.length > 0;
                const hasGroupWork =
                  isTaskSpec && formData.groupWorkPermitted === "Yes";
                const hasGradingMatrix =
                  isEvalGroup &&
                  sectionToggles.gradingMatrix &&
                  rubricRows.length > 0;

                if (
                  !hasVisibleDynamic &&
                  !hasSkills &&
                  !hasGroupWork &&
                  !hasGradingMatrix
                )
                  return null;

                return (
                  <div
                    key={groupTitle}
                    className="mb-8 break-inside-avoid print:break-inside-avoid"
                  >
                    <h3 className="text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                      {groupTitle}
                    </h3>

                    {/* Special Injections based on Group */}
                    {isTaskSpec && hasGroupWork && (
                      <div className="mb-4">
                        <strong>
                          Group Mechanics (Target Size: {formData.groupSize}):
                        </strong>{" "}
                        <MarkdownRenderer
                          content={formData.groupMechanics as string}
                          images={uploadedImages}
                        />
                      </div>
                    )}

                    {/* Render standard configured sections */}
                    {sectionsInGroup.map((s) => {
                      if (!sectionToggles[s.id] || !formData[s.id]) return null;
                      return (
                        <div key={s.id} className="mb-4">
                          {s.pdfLabelStyle === "inline" && (
                            <strong>{s.label}: </strong>
                          )}
                          {s.pdfLabelStyle === "heading" && (
                            <h4 className="font-bold mt-5 mb-2 print:break-after-avoid">
                              {s.label}:
                            </h4>
                          )}
                          <MarkdownRenderer
                            content={formData[s.id] as string}
                            images={uploadedImages}
                          />
                        </div>
                      );
                    })}

                    {/* Special Injection for Skills at end of Overview */}
                    {isOverview && hasSkills && (
                      <div className="mb-3">
                        <strong>Employability Skills:</strong>{" "}
                        {selectedSkills.join(", ")}
                      </div>
                    )}

                    {/* Special Injection for Grading Matrix at end of Evaluation block */}
                    {hasGradingMatrix && (
                      <table className="table-fixed w-full text-left border-collapse border border-black text-[8pt] leading-tight mt-4 break-words">
                        <thead className="break-inside-avoid print:break-inside-avoid">
                          <tr className="print-bg-gray bg-gray-100 text-center border-b-2 border-black font-bold">
                            <th className="border-r border-black p-1.5 w-[14%]">
                              Component
                            </th>
                            <th className="border-r border-black p-1.5 w-[7%] text-[7pt]">
                              Weight
                            </th>
                            <th className="border-r border-black p-1.5 w-[13.1%]">
                              Fail (&lt;40%)
                            </th>
                            <th className="border-r border-black p-1.5 w-[13.1%]">
                              Pass (40-49%)
                            </th>
                            <th className="border-r border-black p-1.5 w-[13.1%]">
                              2:2 (50-59%)
                            </th>
                            <th className="border-r border-black p-1.5 w-[13.1%]">
                              2:1 (60-69%)
                            </th>
                            <th className="border-r border-black p-1.5 w-[13.1%]">
                              1st (70-84%)
                            </th>
                            <th className="p-1.5 w-[13.1%]">Excelled (85%+)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rubricRows.map((row) => (
                            <tr
                              key={row.id}
                              className="border-b border-black align-top break-inside-avoid print:break-inside-avoid"
                            >
                              <td className="border-r border-black p-1.5 font-bold print-bg-gray-light bg-gray-50 break-words">
                                {row.component}
                              </td>
                              <td className="border-r border-black p-1.5 text-center font-bold print-bg-gray-light bg-gray-50">
                                {row.weight}
                              </td>
                              <td className="border-r border-black p-1.5 break-words">
                                {row.fail}
                              </td>
                              <td className="border-r border-black p-1.5 break-words">
                                {row.pass}
                              </td>
                              <td className="border-r border-black p-1.5 break-words">
                                {row.twoTwo}
                              </td>
                              <td className="border-r border-black p-1.5 break-words">
                                {row.twoOne}
                              </td>
                              <td className="border-r border-black p-1.5 break-words">
                                {row.first}
                              </td>
                              <td className="p-1.5 break-words">
                                {row.excelled}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}

              {/* Academic Integrity */}
              <div className="mb-8 text-[11pt] leading-relaxed break-inside-avoid print:break-inside-avoid">
                <p className="font-bold text-center underline mb-4 uppercase tracking-wider print:break-after-avoid">
                  {staticContent.academicIntegrity.warning}
                </p>
                <h3 className="text-[14pt] font-bold border-b-2 border-black mb-3 uppercase tracking-tight print:break-after-avoid">
                  {staticContent.academicIntegrity.title}
                </h3>
                <MarkdownRenderer
                  content={staticContent.academicIntegrity.body}
                />
                <div className="p-6 sm:p-8 box-border border-2 border-black print-bg-gray-light bg-gray-50 italic mt-4 print:p-6">
                  {staticContent.academicIntegrity.groupWorkPrefix}{" "}
                  <strong className="uppercase font-extrabold">
                    {formData.groupWorkPermitted === "Yes"
                      ? "PERMITTED"
                      : "NOT PERMITTED"}
                  </strong>
                  .{" "}
                  {formData.groupWorkPermitted === "No" &&
                    staticContent.academicIntegrity.individualWarning}
                </div>
              </div>

              {/* AI Policy */}
              <div className="mb-8">
                <h3 className="text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                  {staticContent.aiPolicy.title}
                </h3>
                <p className="mb-4 text-[11pt] leading-relaxed">
                  {staticContent.aiPolicy.preamble}
                </p>

                <div className="break-inside-avoid print:break-inside-avoid">
                  <table className="table-fixed w-full border-collapse border border-black mb-5 font-bold text-center text-[11pt]">
                    <tbody>
                      <tr>
                        <td
                          className={`border border-black p-3 w-[33.3%] ${formData.aiPolicy === "RED" ? "bg-red-200 print-bg-red" : ""}`}
                        >
                          🔴 RED {formData.aiPolicy === "RED" ? "✓" : ""}
                        </td>
                        <td
                          className={`border border-black p-3 w-[33.3%] ${formData.aiPolicy === "AMBER" ? "bg-yellow-200 print-bg-yellow" : ""}`}
                        >
                          🟡 AMBER {formData.aiPolicy === "AMBER" ? "✓" : ""}
                        </td>
                        <td
                          className={`border border-black p-3 w-[33.3%] ${formData.aiPolicy === "GREEN" ? "bg-green-200 print-bg-green" : ""}`}
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
                          {staticContent.aiPolicy.redTitle}
                        </h4>
                        <MarkdownRenderer
                          content={staticContent.aiPolicy.redBody}
                        />
                      </>
                    )}
                    {formData.aiPolicy === "AMBER" && (
                      <>
                        <h4 className="font-bold text-yellow-800 mb-2 uppercase tracking-wide text-[12pt] print:break-after-avoid">
                          {staticContent.aiPolicy.amberTitle}
                        </h4>
                        <p className="mb-3">
                          {staticContent.aiPolicy.amberBody}
                        </p>
                        <p className="mb-2">
                          <strong>Permitted Uses:</strong>{" "}
                          {formData.aiAmberPermitted as string}
                        </p>
                        <p className="mb-3">
                          <strong>Prohibited Uses:</strong>{" "}
                          {formData.aiAmberProhibited as string}
                        </p>
                        <div className="italic">
                          <MarkdownRenderer
                            content={staticContent.aiPolicy.amberDeclaration}
                          />
                        </div>
                      </>
                    )}
                    {formData.aiPolicy === "GREEN" && (
                      <>
                        <h4 className="font-bold text-green-800 mb-2 uppercase tracking-wide text-[12pt] print:break-after-avoid">
                          {staticContent.aiPolicy.greenTitle}
                        </h4>
                        <p className="mb-3">
                          {staticContent.aiPolicy.greenBody}
                        </p>
                        <p className="mb-3">
                          <strong>Permitted Uses:</strong>{" "}
                          {formData.aiGreenPermitted as string}
                        </p>
                        <div className="italic">
                          <MarkdownRenderer
                            content={staticContent.aiPolicy.greenDeclaration}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
