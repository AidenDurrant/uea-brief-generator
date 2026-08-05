"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import SKILLS_LIST from "../skills.json";
import ASSESSMENT_METHODS from "../assessments.json";
import TEMPLATE from "../template.json";
import MODULE_CATALOG from "../module-catalog.json";
import { AppHeader } from "@/app/components/app-header";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Assessment, Database, Json } from "@/lib/database.types";
import type { User } from "@supabase/supabase-js";

// ─── Constants & Extracted Text ───────────────────────────────────────────────
const DRAFT_STORAGE_KEY = "uea_brief_draft_v2";

type CoTaughtModule = {
  id: number;
  module: string;
  weighting: string;
};

type ReviewStatusRow =
  Database["public"]["Functions"]["assessment_review_status"]["Returns"][number];

type SavedBriefContent = {
  formData?: Record<string, unknown>;
  sectionToggles?: Record<string, boolean>;
  selectedSkills?: string[];
  rubricRows?: Record<string, unknown>[];
  uploadedImages?: Record<string, string>;
};

const DEFAULT_STATIC_CONTENT = {
  academicIntegrity: {
    title: "Academic Integrity",
    warning: "Please read all the information below carefully",
    body: "The University takes academic integrity very seriously. You must not commit plagiarism, collusion, or contract cheating in your submitted work. Our Policy on Plagiarism, Collusion, and Contract Cheating explains:\n\n* what is meant by the terms 'plagiarism', 'collusion', and 'contract cheating'\n* how to avoid plagiarism, collusion, and contract cheating\n* using a proofreader\n* what will happen if we suspect that you have breached the policy.\n\nIt is essential that you read this policy, and you undertake (or refresh your memory of) our school's training on this. You can find the policy and related guidance here:\n\n[https://my.uea.ac.uk/departments/learningand-teaching/students/academic-cycle/regulations-and-discipline/plagiarism-awareness](https://my.uea.ac.uk/departments/learningand-teaching/students/academic-cycle/regulations-and-discipline/plagiarism-awareness)",
    groupWorkPrefix: "In this assessment, working with others is",
    individualWarning:
      "All aspects of your submission, including but not limited to: research, design, development and writing, must be your own work according to your own understanding of topics. Please pay careful attention to the definitions of contract cheating, plagiarism and collusion in the policy and ask your assessment setter if you are unsure about anything.",
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

const UG_GRADE_BANDS = [
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

const PGT_GRADE_BANDS = [
  {
    key: "fail",
    label: "Fail",
    range: "<50%",
    pill: "bg-red-100 text-red-700 border-red-200",
  },
  {
    key: "twoTwo",
    label: "Pass",
    range: "50–59%",
    pill: "bg-orange-100 text-orange-700 border-orange-200",
  },
  {
    key: "twoOne",
    label: "Merit",
    range: "60–69%",
    pill: "bg-sky-100 text-sky-700 border-sky-200",
  },
  {
    key: "first",
    label: "Distinction",
    range: "70–84%",
    pill: "bg-indigo-100 text-indigo-700 border-indigo-200",
  },
  {
    key: "excelled",
    label: "Exceptional",
    range: "85%+",
    pill: "bg-violet-100 text-violet-700 border-violet-200",
  },
];

const AI_OPTIONS = [
  { value: "RED", emoji: "🔴", label: "RED", desc: "No AI Permitted" },
  { value: "AMBER", emoji: "🟡", label: "AMBER", desc: "Restricted Use" },
  { value: "GREEN", emoji: "🟢", label: "GREEN", desc: "Full Integration" },
];

const ACADEMIC_YEAR_OPTIONS = ["2025-2026", "2026-2027", "2027-2028"];
type ModuleCode = keyof typeof MODULE_CATALOG.modules;

const moduleValue = (code: string) => {
  const title = MODULE_CATALOG.modules[code as ModuleCode];
  return title ? `${code} ${title}` : code;
};

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

const normaliseLoadedFormData = (
  saved: unknown,
  defaults: Record<string, unknown>,
) => {
  const source =
    typeof saved === "object" && saved !== null
      ? (saved as Record<string, unknown>)
      : {};
  const merged = { ...defaults, ...source };

  if (!Object.prototype.hasOwnProperty.call(source, "academicYear")) {
    const legacyProgramme = String(source.programme || "");
    const legacyYear = legacyProgramme
      .match(/20\d{2}\s*[-/]\s*20\d{2}/)?.[0]
      .replace(/\s/g, "")
      .replace("/", "-");

    if (legacyYear && ACADEMIC_YEAR_OPTIONS.includes(legacyYear)) {
      merged.academicYear = legacyYear;
    }
    if (legacyYear) {
      merged.programme = legacyProgramme
        .replace(/20\d{2}\s*[-/]\s*20\d{2}/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }

  return merged;
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
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
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
    <div className="section-heading flex items-center gap-3 mb-6">
      <div className="flex items-center justify-center shrink-0 text-xs font-bold select-none bg-indigo-50 text-indigo-600 rounded-full w-6 h-6">
        {step}
      </div>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-400 mb-1.5 flex-1">
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
    <button
      type="button"
      onClick={onChange}
      className="visibility-toggle"
      aria-pressed={checked}
      aria-label={checked ? "Hide section" : "Show section"}
    >
      <span className="visibility-toggle-track" data-checked={checked}>
        <span className="visibility-toggle-thumb" />
      </span>
      <span>{checked ? "Visible" : "Hidden"}</span>
    </button>
  );
}

// ─── Default State Generator ──────────────────────────────────────────────────
const getDefaultState = () => {
  const data: Record<string, any> = {
    assessmentType: "Prompt Portfolio",
    gradingScheme: "UG",
    coTaughtWeightingsEnabled: false,
    coTaughtModules: [] as CoTaughtModule[],
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

  const [zoom, setZoom] = useState(60);
  const [panelWidth, setPanelWidth] = useState(66.67);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfPageRef = useRef<HTMLDivElement>(null);
  const hasHandledBriefLink = useRef(false);
  const [printPageCount, setPrintPageCount] = useState(1);

  // Supabase authentication and persistence state
  const [briefsList, setBriefsList] = useState<Assessment[]>([]);
  const [currentBriefId, setCurrentBriefId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profileName, setProfileName] = useState("");
  const [pendingDisplayName, setPendingDisplayName] = useState("");
  const [isProfileRequired, setIsProfileRequired] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(isSupabaseConfigured);
  const [isBriefsLoading, setIsBriefsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmittingForReview, setIsSubmittingForReview] = useState(false);
  const [savedSignature, setSavedSignature] = useState("");
  const [exportApprovalOverride, setExportApprovalOverride] = useState<
    boolean | null
  >(null);
  const [reviewStatuses, setReviewStatuses] = useState<ReviewStatusRow[]>([]);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  // Form States
  const [formData, setFormData] = useState<Record<string, any>>(
    defaults.formData,
  );
  const [sectionToggles, setSectionToggles] = useState<Record<string, boolean>>(
    defaults.sectionToggles,
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    defaults.selectedSkills,
  );
  const [expandedSkills, setExpandedSkills] = useState<string[]>([]); // Tracks which skill descriptions are open
  const [uploadedImages, setUploadedImages] = useState<Record<string, string>>(
    defaults.uploadedImages,
  );
  const [rubricRows, setRubricRows] = useState<any[]>(defaults.rubricRows);
  const selectedCatalogSchool = MODULE_CATALOG.schools.find(
    (school) => school.name === String(formData.school || ""),
  );
  const availableProgrammes = selectedCatalogSchool?.programmes ?? [];
  const selectedCatalogProgramme = availableProgrammes.find(
    (programme) => programme.name === String(formData.programme || ""),
  );
  const availableModuleCodes = selectedCatalogProgramme?.moduleCodes ?? [];
  const gradeBands =
    formData.gradingScheme === "PGT" ? PGT_GRADE_BANDS : UG_GRADE_BANDS;
  const currentEditorSignature = JSON.stringify({
    formData,
    sectionToggles,
    selectedSkills,
    rubricRows,
    uploadedImages,
  });
  const currentSavedAssessment = briefsList.find(
    (brief) => brief.id === currentBriefId,
  );
  const hasUnsavedChanges =
    !currentBriefId || currentEditorSignature !== savedSignature;
  const isApprovedForExport =
    !hasUnsavedChanges &&
    (exportApprovalOverride ?? currentSavedAssessment?.status === "approved");

  const refreshBriefs = useCallback(async (ownerId: string) => {
    if (!supabase) return;
    setIsBriefsLoading(true);
    setPersistenceError(null);

    const { data, error } = await supabase
      .from("assessments")
      .select("*")
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false });

    if (error) {
      setPersistenceError(error.message);
      setBriefsList([]);
    } else {
      setBriefsList(data ?? []);
    }
    setIsBriefsLoading(false);
  }, []);

  const refreshReviewStatus = useCallback(async (assessmentId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("assessment_review_status", {
      target_assessment_id: assessmentId,
    });
    if (error) {
      setPersistenceError(error.message);
      setReviewStatuses([]);
      return;
    }
    setReviewStatuses(data ?? []);
  }, []);

  const refreshAdminStatus = useCallback(async (userId: string) => {
    if (!supabase) return;
    const [administrator, teachingDirector] = await Promise.all([
      supabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("reviewer_roles")
        .select("user_id")
        .eq("user_id", userId)
        .eq("role", "teaching_director")
        .maybeSingle(),
    ]);
    setIsAdmin(Boolean(administrator.data || teachingDirector.data));
  }, []);

  const refreshProfile = useCallback(async (user: User) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      setPersistenceError(error.message);
      return;
    }

    if (data?.display_name) {
      setProfileName(data.display_name);
      setPendingDisplayName(data.display_name);
      setIsProfileRequired(false);
      return;
    }

    const suggestedName = String(
      user.user_metadata.full_name ||
        user.user_metadata.name ||
        user.user_metadata.user_name ||
        "",
    );
    setProfileName("");
    setPendingDisplayName(suggestedName);
    setIsProfileRequired(true);
  }, []);

  // Load the local draft and initialise the Supabase auth session.
  useEffect(() => {
    setIsClient(true);

    const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        setFormData(
          normaliseLoadedFormData(parsed.formData, defaults.formData),
        );
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

    const client = supabase;
    if (!client) {
      setIsAuthLoading(false);
      return;
    }

    const syncSession = async () => {
      const {
        data: { session },
      } = await client.auth.getSession();
      const user = session?.user ?? null;
      setCurrentUser(user);
      setIsAuthLoading(false);
      if (user) {
        await Promise.all([
          refreshBriefs(user.id),
          refreshAdminStatus(user.id),
          refreshProfile(user),
        ]);
      }
    };
    void syncSession();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      setIsAuthLoading(false);
      if (user) {
        window.setTimeout(() => {
          void refreshBriefs(user.id);
          void refreshAdminStatus(user.id);
          void refreshProfile(user);
        }, 0);
      } else {
        setBriefsList([]);
        setCurrentBriefId(null);
        setProfileName("");
        setPendingDisplayName("");
        setIsProfileRequired(false);
        setIsAdmin(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [refreshAdminStatus, refreshBriefs, refreshProfile]);

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

  useEffect(() => {
    if (
      !isClient ||
      hasHandledBriefLink.current ||
      isBriefsLoading ||
      briefsList.length === 0
    ) {
      return;
    }

    const requestedBriefId = new URLSearchParams(window.location.search).get(
      "brief",
    );
    if (!requestedBriefId) {
      hasHandledBriefLink.current = true;
      return;
    }

    const brief = briefsList.find((item) => item.id === requestedBriefId);
    if (!brief) {
      hasHandledBriefLink.current = true;
      setPersistenceError("The requested assessment brief could not be found.");
      return;
    }

    const content = brief.content as unknown as SavedBriefContent;
    const loadedFormData = normaliseLoadedFormData(
      content.formData,
      defaults.formData,
    );
    const loadedSectionToggles = {
      ...defaults.sectionToggles,
      ...(content.sectionToggles || {}),
    };
    const loadedSkills = content.selectedSkills || defaults.selectedSkills;
    const loadedRubrics = content.rubricRows?.length
      ? content.rubricRows
      : defaults.rubricRows;
    const loadedImages = content.uploadedImages || defaults.uploadedImages;

    hasHandledBriefLink.current = true;
    setFormData(loadedFormData);
    setSectionToggles(loadedSectionToggles);
    setSelectedSkills(loadedSkills);
    setRubricRows(loadedRubrics);
    setUploadedImages(loadedImages);
    setCurrentBriefId(brief.id);
    setExportApprovalOverride(null);
    setSavedSignature(
      JSON.stringify({
        formData: loadedFormData,
        sectionToggles: loadedSectionToggles,
        selectedSkills: loadedSkills,
        rubricRows: loadedRubrics,
        uploadedImages: loadedImages,
      }),
    );
    void refreshReviewStatus(brief.id);
  }, [briefsList, isBriefsLoading, isClient, refreshReviewStatus]);

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
    setExpandedSkills([]);
    setRubricRows(defaults.rubricRows);
    setUploadedImages(defaults.uploadedImages);
    setCurrentBriefId(null);
    setSavedSignature("");
    setExportApprovalOverride(null);
    setReviewStatuses([]);
    setWorkflowMessage(null);
    if (typeof window !== "undefined" && window.innerWidth < 768)
      setIsSidebarOpen(false);
  };

  const handleGitHubSignIn = async () => {
    if (!supabase) return;
    setPersistenceError(null);
    const redirectTo = window.location.href.split(/[?#]/)[0];
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo },
    });
    if (error) setPersistenceError(error.message);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    loadDefault();
  };

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || !currentUser) return;

    const displayName = pendingDisplayName.trim();
    if (displayName.length < 2 || displayName.length > 100) {
      setPersistenceError("Enter a display name between 2 and 100 characters.");
      return;
    }

    setIsProfileSaving(true);
    setPersistenceError(null);
    const { error } = await supabase
      .from("profiles")
      .upsert(
        { user_id: currentUser.id, display_name: displayName },
        { onConflict: "user_id" },
      );
    setIsProfileSaving(false);

    if (error) {
      setPersistenceError(error.message);
      return;
    }

    setProfileName(displayName);
    setIsProfileRequired(false);
  };

  const handleLoadBrief = (briefId: string) => {
    const brief = briefsList.find((item) => item.id === briefId);
    if (!brief) return;
    const content = brief.content as unknown as SavedBriefContent;
    const loadedFormData = normaliseLoadedFormData(
      content.formData,
      defaults.formData,
    );
    const loadedSectionToggles = {
      ...defaults.sectionToggles,
      ...(content.sectionToggles || {}),
    };
    const loadedSkills = content.selectedSkills || defaults.selectedSkills;
    const loadedRubrics = content.rubricRows?.length
      ? content.rubricRows
      : defaults.rubricRows;
    const loadedImages = content.uploadedImages || defaults.uploadedImages;

    setFormData(loadedFormData);
    setSectionToggles(loadedSectionToggles);
    setSelectedSkills(loadedSkills);
    setExpandedSkills([]);
    setRubricRows(loadedRubrics);
    setUploadedImages(loadedImages);
    setCurrentBriefId(brief.id);
    setExportApprovalOverride(null);
    setSavedSignature(
      JSON.stringify({
        formData: loadedFormData,
        sectionToggles: loadedSectionToggles,
        selectedSkills: loadedSkills,
        rubricRows: loadedRubrics,
        uploadedImages: loadedImages,
      }),
    );
    setWorkflowMessage(null);
    void refreshReviewStatus(brief.id);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleDeleteBrief = async (
    event: React.MouseEvent,
    briefId: string,
  ) => {
    event.stopPropagation();
    if (!supabase || !window.confirm("Delete this saved brief forever?"))
      return;

    const { error } = await supabase
      .from("assessments")
      .delete()
      .eq("id", briefId);

    if (error) {
      setPersistenceError(error.message);
      return;
    }

    setBriefsList((current) => current.filter((brief) => brief.id !== briefId));
    if (currentBriefId === briefId) loadDefault();
  };

  const handleSaveToDatabase = async () => {
    if (!supabase || !currentUser) {
      setPersistenceError("Sign in with GitHub to save assessments.");
      return;
    }

    setIsSaving(true);
    setPersistenceError(null);

    const title = String(formData.module || "Untitled Assessment");
    const moduleCode = title.split(/\s+/)[0] || "Unspecified";
    const moduleLevelMatch = moduleCode.match(/\d/);
    const moduleLevel = moduleLevelMatch ? Number(moduleLevelMatch[0]) : null;
    const programme = String(formData.programme || "").trim() || null;
    const selectedAcademicYear = String(formData.academicYear || "");
    const academicYear = ACADEMIC_YEAR_OPTIONS.includes(selectedAcademicYear)
      ? selectedAcademicYear
      : "Unspecified";
    const persistedFormData: Record<string, unknown> = { ...formData };

    if (formData.groupWorkPermitted !== "Yes") {
      persistedFormData.groupSize = null;
      persistedFormData.groupMechanics = null;
    }

    Object.entries(sectionToggles).forEach(([sectionId, isVisible]) => {
      if (!isVisible && sectionId !== "gradingMatrix") {
        persistedFormData[sectionId] = null;
      }
    });

    if (!formData.coTaughtWeightingsEnabled) {
      persistedFormData.coTaughtModules = null;
    }

    if (formData.assessmentType !== "Other") {
      persistedFormData.customAssessmentName = null;
      persistedFormData.customAssessmentDesc = null;
    }

    if (formData.aiPolicy !== "AMBER") {
      persistedFormData.aiAmberPermitted = null;
      persistedFormData.aiAmberProhibited = null;
    }
    if (formData.aiPolicy !== "GREEN") {
      persistedFormData.aiGreenPermitted = null;
    }

    const cleanEmptyValues = (value: unknown): unknown => {
      if (typeof value === "string") return value.trim() ? value : null;
      if (Array.isArray(value)) return value.map(cleanEmptyValues);
      if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
          Object.entries(value).map(([key, nested]) => [
            key,
            cleanEmptyValues(nested),
          ]),
        );
      }
      return value;
    };

    const content = JSON.parse(
      JSON.stringify(
        cleanEmptyValues({
          formData: persistedFormData,
          sectionToggles,
          selectedSkills: selectedSkills.length > 0 ? selectedSkills : null,
          rubricRows: sectionToggles.gradingMatrix
            ? rubricRows.map((row) =>
                formData.gradingScheme === "PGT" ? { ...row, pass: null } : row,
              )
            : null,
          uploadedImages,
        }),
      ),
    ) as Json;

    const record = {
      title,
      module_code: moduleCode,
      module_level: moduleLevel,
      programme,
      academic_year: academicYear,
      assessment_type: String(formData.assessmentType || "Unspecified"),
      ai_policy: String(formData.aiPolicy || "Unspecified"),
      group_work_permitted: formData.groupWorkPermitted === "Yes",
      content,
    };

    const existingId =
      currentBriefId && briefsList.some((brief) => brief.id === currentBriefId)
        ? currentBriefId
        : null;

    const query = existingId
      ? supabase.from("assessments").update(record).eq("id", existingId)
      : supabase
          .from("assessments")
          .insert({ ...record, owner_id: currentUser.id });

    const { data, error } = await query.select("*").single();
    setIsSaving(false);

    if (error) {
      setPersistenceError(error.message);
      return;
    }

    setCurrentBriefId(data.id);
    setExportApprovalOverride(null);
    setSavedSignature(currentEditorSignature);
    setWorkflowMessage(
      data.status === "draft"
        ? "Draft saved. Submit it separately when the required reviewer role pools are available."
        : "Assessment saved.",
    );
    await Promise.all([
      refreshBriefs(currentUser.id),
      refreshReviewStatus(data.id),
    ]);
  };

  const handleSubmitForReview = async () => {
    if (!supabase || !currentUser || !currentBriefId) {
      setPersistenceError(
        "Save the assessment before submitting it for review.",
      );
      return;
    }
    if (hasUnsavedChanges) {
      setPersistenceError(
        "Save your latest changes before submitting for review.",
      );
      return;
    }

    setIsSubmittingForReview(true);
    setExportApprovalOverride(null);
    setPersistenceError(null);
    setWorkflowMessage(null);
    const { error } = await supabase.rpc("submit_assessment_for_review", {
      target_assessment_id: currentBriefId,
    });
    setIsSubmittingForReview(false);

    if (error) {
      setPersistenceError(error.message);
      return;
    }

    setWorkflowMessage("Submitted for all three required reviews.");
    await Promise.all([
      refreshBriefs(currentUser.id),
      refreshReviewStatus(currentBriefId),
    ]);
  };

  const prepareWatermarksForPrint = () => {
    const page = pdfPageRef.current;
    if (!page) return;

    const pixelsPerMillimetre = 96 / 25.4;
    const printablePageHeight = 257 * pixelsPerMillimetre;
    let pageCount = 1;
    let usedHeight = 0;

    Array.from(page.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      if (
        child.classList.contains("draft-watermark") ||
        child.classList.contains("print-page-watermark")
      )
        return;

      const styles = window.getComputedStyle(child);
      const margins =
        (Number.parseFloat(styles.marginTop) || 0) +
        (Number.parseFloat(styles.marginBottom) || 0);
      const elementHeight = child.offsetHeight + margins;
      const avoidsPageBreak =
        styles.breakInside === "avoid" || styles.pageBreakInside === "avoid";

      if (
        avoidsPageBreak &&
        elementHeight <= printablePageHeight &&
        usedHeight > 0 &&
        usedHeight + elementHeight > printablePageHeight
      ) {
        pageCount += 1;
        usedHeight = 0;
      }

      usedHeight += elementHeight;
      while (usedHeight > printablePageHeight + 1) {
        pageCount += 1;
        usedHeight -= printablePageHeight;
      }
    });

    setPrintPageCount(Math.max(1, pageCount));
  };

  const openPrintDialog = () => {
    prepareWatermarksForPrint();
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => window.print()),
    );
  };

  const handleExportPdf = async () => {
    if (!supabase || !currentBriefId || hasUnsavedChanges) {
      openPrintDialog();
      return;
    }

    setPersistenceError(null);
    const { data: fullyApproved, error } = await supabase.rpc(
      "assessment_can_export_final",
      { target_assessment_id: currentBriefId },
    );

    if (error) {
      setPersistenceError(error.message);
      return;
    }

    setExportApprovalOverride(fullyApproved);
    if (!fullyApproved) {
      setWorkflowMessage(
        "Approval is incomplete or has changed. This export contains the draft watermark.",
      );
    } else {
      setWorkflowMessage(null);
    }

    openPrintDialog();
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

  const toggleSkillExpand = (name: string) => {
    setExpandedSkills((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  };

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

  const handleSchoolChange = (schoolName: string) => {
    const school = MODULE_CATALOG.schools.find(
      (item) => item.name === schoolName,
    );
    const programme = school?.programmes[0];
    const moduleCode = programme?.moduleCodes[0];
    setFormData((current) => ({
      ...current,
      school: schoolName,
      programme: programme?.name ?? "",
      module: moduleCode ? moduleValue(moduleCode) : "",
    }));
  };

  const handleProgrammeChange = (programmeName: string) => {
    const programme = availableProgrammes.find(
      (item) => item.name === programmeName,
    );
    const moduleCode = programme?.moduleCodes[0];
    setFormData((current) => ({
      ...current,
      programme: programmeName,
      module: moduleCode ? moduleValue(moduleCode) : "",
    }));
  };

  const toggleCoTaughtWeightings = () =>
    setFormData((current) => {
      const enabled = !current.coTaughtWeightingsEnabled;
      const existing = (current.coTaughtModules || []) as CoTaughtModule[];
      return {
        ...current,
        coTaughtWeightingsEnabled: enabled,
        coTaughtModules:
          enabled && existing.length === 0
            ? [
                {
                  id: Date.now(),
                  module: "",
                  weighting: current.weighting || "",
                },
              ]
            : existing,
      };
    });
  const addCoTaughtModule = () =>
    setFormData((current) => ({
      ...current,
      coTaughtModules: [
        ...((current.coTaughtModules || []) as CoTaughtModule[]),
        { id: Date.now(), module: "", weighting: "" },
      ],
    }));
  const updateCoTaughtModule = (
    id: number,
    field: "module" | "weighting",
    value: string,
  ) =>
    setFormData((current) => ({
      ...current,
      coTaughtModules: (
        (current.coTaughtModules || []) as CoTaughtModule[]
      ).map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    }));
  const removeCoTaughtModule = (id: number) =>
    setFormData((current) => ({
      ...current,
      coTaughtModules: (
        (current.coTaughtModules || []) as CoTaughtModule[]
      ).filter((item) => item.id !== id),
    }));

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
    <div className="app-shell flex h-screen w-full overflow-hidden font-sans bg-slate-900 print:block print:h-auto print:overflow-visible print:bg-white">
      {currentUser && isProfileRequired && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-5 backdrop-blur-sm print:hidden">
          <form
            onSubmit={handleSaveProfile}
            className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl"
          >
            <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-white">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.02c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.3-5.27-1.29-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.75 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
              </svg>
            </div>
            <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
              Welcome to the assessment builder
            </h2>
            <p className="mt-3 text-center text-sm leading-6 text-slate-500">
              Choose the name colleagues and administrators will see alongside
              your assessments.
            </p>
            <label className="mt-6 block text-sm font-semibold text-slate-700">
              Display name
              <input
                autoFocus
                required
                minLength={2}
                maxLength={100}
                value={pendingDisplayName}
                onChange={(event) => setPendingDisplayName(event.target.value)}
                placeholder="e.g. Alex Morgan"
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              />
            </label>
            <button
              type="submit"
              disabled={isProfileSaving}
              className="mt-5 w-full rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
            >
              {isProfileSaving ? "Saving…" : "Continue"}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-3 w-full rounded-full px-5 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
            >
              Sign out
            </button>
          </form>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SIDEBAR — Database Form Manager
      ═══════════════════════════════════════════════════════════ */}
      <div
        className="brief-sidebar shrink-0 flex flex-col bg-slate-900 shadow-2xl text-slate-300 print:hidden z-30 transition-all duration-300 ease-in-out overflow-hidden border-slate-800"
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
            {!isSupabaseConfigured && (
              <div className="text-xs text-amber-300/80 text-center p-5 border border-dashed border-amber-500/30 rounded-xl mt-2">
                Add the Supabase environment variables to enable shared storage.
              </div>
            )}
            {isSupabaseConfigured && isAuthLoading && (
              <div className="text-xs text-slate-500 text-center p-6">
                Checking your session…
              </div>
            )}
            {isSupabaseConfigured && !isAuthLoading && !currentUser && (
              <div className="text-xs text-slate-400 text-center p-5 border border-dashed border-slate-700 rounded-xl mt-2">
                <p className="mb-3">
                  Sign in with GitHub to access saved briefs.
                </p>
                <button
                  type="button"
                  onClick={handleGitHubSignIn}
                  className="px-4 py-2 rounded-full bg-indigo-600 text-white font-semibold hover:bg-indigo-500"
                >
                  Sign in with GitHub
                </button>
              </div>
            )}
            {currentUser && isBriefsLoading && (
              <div className="text-xs text-slate-500 text-center p-6">
                Loading assessments…
              </div>
            )}
            {currentUser && !isBriefsLoading && briefsList.length === 0 && (
              <div className="text-xs text-slate-500 text-center p-6 border border-dashed border-slate-700/50 rounded-xl mt-2">
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
                    {new Date(brief.updated_at).toLocaleDateString()}
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

          {currentUser && (
            <section className="border-t border-slate-800 bg-slate-950/60 p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Account
              </p>
              <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-sm font-bold text-indigo-300">
                  {(profileName || currentUser.email || "U")
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {profileName || "GitHub user"}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {currentUser.email || "Authenticated with GitHub"}
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                <a
                  href="./"
                  className="flex items-center justify-between rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2.5 text-xs font-semibold text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white"
                >
                  <span>My dashboard</span>
                  <span aria-hidden="true">→</span>
                </a>
                <a
                  href="./reviews"
                  className="flex items-center justify-between rounded-xl border border-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white"
                >
                  <span>My review queue</span>
                  <span aria-hidden="true">→</span>
                </a>
                {isAdmin && (
                  <a
                    href="./admin"
                    className="flex items-center justify-between rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2.5 text-xs font-semibold text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white"
                  >
                    <span>Administration dashboard</span>
                    <span aria-hidden="true">→</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-800 px-3 py-2.5 text-left text-xs font-semibold text-slate-400 hover:border-slate-700 hover:bg-slate-800 hover:text-white"
                >
                  <span>Sign out</span>
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="workspace-shell flex-1 flex overflow-hidden bg-white relative"
      >
        {/* ═══════════════════════════════════════════════════════════
            LEFT — Editor
        ═══════════════════════════════════════════════════════════ */}
        <div
          className="editor-panel h-full flex flex-col print:hidden shrink-0 overflow-hidden"
          style={{ width: `${panelWidth}%`, minWidth: 300 }}
        >
          <AppHeader
            eyebrow="Assessment brief management"
            title="Assessment Builder"
            subtitle={formData.module || formData.programme || "New brief"}
            sticky={false}
            maxWidthClass="max-w-none"
            className="editor-toolbar z-20"
            leading={
              <button
                type="button"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="toolbar-icon-button -ml-1 p-2 text-slate-500 transition-colors hover:text-indigo-600"
                title="Toggle sidebar"
                aria-label="Toggle saved briefs menu"
                aria-expanded={isSidebarOpen}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  className="shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            }
            actionsLabel="Builder actions"
            actions={
              <div className="editor-toolbar-actions flex min-w-55 flex-1 flex-wrap items-center justify-end gap-2">
                {!isSupabaseConfigured && (
                  <span className="hidden 2xl:inline text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
                    Supabase setup required
                  </span>
                )}
                {isSupabaseConfigured && !isAuthLoading && !currentUser && (
                  <button
                    type="button"
                    onClick={handleGitHubSignIn}
                    className="toolbar-action toolbar-action-muted flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
                  >
                    GitHub sign in
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleClearDraft}
                  className="toolbar-action toolbar-action-muted flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-500 transition-colors active:scale-95"
                >
                  Clear Draft
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportPdf()}
                  className="toolbar-action toolbar-action-muted flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-500 transition-colors active:scale-95"
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
                  {isApprovedForExport
                    ? "Export final PDF"
                    : "Export draft PDF"}
                </button>
                <div className="w-px h-5 bg-slate-200 mx-1"></div>
                <button
                  type="button"
                  onClick={handleSaveToDatabase}
                  disabled={isSaving}
                  className="toolbar-action toolbar-action-primary flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white transition-colors active:scale-95 disabled:opacity-60 disabled:cursor-wait"
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
                  {isSaving
                    ? "Saving…"
                    : currentBriefId
                      ? "Update"
                      : "Save New"}
                </button>
              </div>
            }
          />

          {currentSavedAssessment && (
            <div className="border-b border-slate-200 bg-white px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-700">
                    Review workflow · Version {currentSavedAssessment.version}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 font-semibold capitalize ${
                      currentSavedAssessment.status === "approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : currentSavedAssessment.status === "in_review"
                          ? "bg-blue-100 text-blue-700"
                          : currentSavedAssessment.status ===
                              "changes_requested"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {currentSavedAssessment.status.replaceAll("_", " ")}
                  </span>
                  {(["academic", "ai", "employability"] as const).map(
                    (category) => {
                      const review = reviewStatuses.find(
                        (item) => item.category === category,
                      );
                      return (
                        <span
                          key={category}
                          className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${
                            review?.state === "approved"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : review?.state === "changes_requested"
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                          title={
                            review?.reviewer_name ||
                            "Awaiting an eligible role-holder"
                          }
                        >
                          {category === "academic"
                            ? "Academic"
                            : category === "ai"
                              ? "AI"
                              : "Employability"}
                          : {review?.state?.replaceAll("_", " ") || "pending"}
                        </span>
                      );
                    },
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSubmitForReview}
                  disabled={
                    isSubmittingForReview ||
                    hasUnsavedChanges ||
                    currentSavedAssessment.status !== "draft"
                  }
                  className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSubmittingForReview
                    ? "Submitting…"
                    : hasUnsavedChanges
                      ? "Save before submitting"
                      : currentSavedAssessment.status === "draft"
                        ? "Submit for approval"
                        : currentSavedAssessment.status === "approved"
                          ? "Fully approved"
                          : "Review in progress"}
                </button>
              </div>
              {reviewStatuses.some(
                (review) =>
                  review.state === "changes_requested" && review.comment,
              ) && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {reviewStatuses
                    .filter(
                      (review) =>
                        review.state === "changes_requested" && review.comment,
                    )
                    .map((review) => (
                      <div
                        key={review.category}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                      >
                        <p className="font-semibold capitalize">
                          {review.category.replaceAll("_", " ")} review changes
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-5">
                          {review.comment}
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {workflowMessage && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-700">
              {workflowMessage}
            </div>
          )}

          {persistenceError && (
            <div className="px-5 py-2.5 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between gap-4">
              <span>{persistenceError}</span>
              <button
                type="button"
                onClick={() => setPersistenceError(null)}
                className="font-bold"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="editor-content flex-1 overflow-y-auto space-y-6">
            {/* 1 — Header Details */}
            <section className="ui-card">
              <SectionHeading step={1} title="Header Details" />
              <div className="flex flex-col space-y-5">
                {/* Dynamic Headers from JSON */}
                {TEMPLATE.headerFields.map((field) => (
                  <div key={field.id}>
                    <FieldLabel>{field.label}</FieldLabel>
                    {field.id === "school" ? (
                      <select
                        className={INPUT}
                        value={formData.school || ""}
                        onChange={(event) =>
                          handleSchoolChange(event.target.value)
                        }
                      >
                        {!selectedCatalogSchool && formData.school && (
                          <option value={formData.school}>
                            {formData.school} (saved value)
                          </option>
                        )}
                        {MODULE_CATALOG.schools.map((school) => (
                          <option key={school.name} value={school.name}>
                            {school.name}
                          </option>
                        ))}
                      </select>
                    ) : field.id === "programme" ? (
                      <select
                        className={INPUT}
                        value={formData.programme || ""}
                        onChange={(event) =>
                          handleProgrammeChange(event.target.value)
                        }
                        disabled={availableProgrammes.length === 0}
                      >
                        {!selectedCatalogProgramme && formData.programme && (
                          <option value={formData.programme}>
                            {formData.programme} (saved value)
                          </option>
                        )}
                        {["Undergraduate", "Postgraduate"].map((studyLevel) => {
                          const programmes = availableProgrammes.filter(
                            (programme) => programme.studyLevel === studyLevel,
                          );
                          return programmes.length > 0 ? (
                            <optgroup key={studyLevel} label={studyLevel}>
                              {programmes.map((programme) => (
                                <option
                                  key={programme.name}
                                  value={programme.name}
                                >
                                  {programme.name}
                                </option>
                              ))}
                            </optgroup>
                          ) : null;
                        })}
                      </select>
                    ) : field.id === "module" ? (
                      <select
                        className={INPUT}
                        value={formData.module || ""}
                        onChange={(event) =>
                          handleChange("module", event.target.value)
                        }
                        disabled={availableModuleCodes.length === 0}
                      >
                        {formData.module &&
                          !availableModuleCodes.some(
                            (code) => moduleValue(code) === formData.module,
                          ) && (
                            <option value={formData.module}>
                              {formData.module} (saved value)
                            </option>
                          )}
                        {availableModuleCodes.map((code) => (
                          <option key={code} value={moduleValue(code)}>
                            {code} —{" "}
                            {MODULE_CATALOG.modules[code as ModuleCode]}
                          </option>
                        ))}
                      </select>
                    ) : field.id === "weighting" ? (
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
                    ) : field.id === "academicYear" ? (
                      <select
                        className={INPUT}
                        value={formData.academicYear || ""}
                        onChange={(e) =>
                          handleChange("academicYear", e.target.value)
                        }
                      >
                        {ACADEMIC_YEAR_OPTIONS.map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
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

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-700">
                        Different weightings for co-taught modules
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Add another module when the same brief has a different
                        assessment weighting.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={toggleCoTaughtWeightings}
                      aria-pressed={!!formData.coTaughtWeightingsEnabled}
                      className={`rounded-full px-4 py-2 text-xs font-semibold ${
                        formData.coTaughtWeightingsEnabled
                          ? "bg-indigo-600 text-white"
                          : "border border-slate-300 bg-white text-slate-600"
                      }`}
                    >
                      {formData.coTaughtWeightingsEnabled
                        ? "Enabled"
                        : "Enable"}
                    </button>
                  </div>
                  {formData.coTaughtWeightingsEnabled && (
                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                      {(
                        (formData.coTaughtModules || []) as CoTaughtModule[]
                      ).map((item) => (
                        <div
                          key={item.id}
                          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]"
                        >
                          <input
                            type="text"
                            className={INPUT}
                            placeholder="Module code and title"
                            value={item.module}
                            onChange={(event) =>
                              updateCoTaughtModule(
                                item.id,
                                "module",
                                event.target.value,
                              )
                            }
                          />
                          <input
                            type="text"
                            className={INPUT}
                            placeholder="Weighting, e.g. 50%"
                            value={item.weighting}
                            onChange={(event) =>
                              updateCoTaughtModule(
                                item.id,
                                "weighting",
                                event.target.value,
                              )
                            }
                          />
                          <button
                            type="button"
                            onClick={() => removeCoTaughtModule(item.id)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addCoTaughtModule}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                      >
                        + Add co-taught module
                      </button>
                    </div>
                  )}
                </div>

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
            <section className="ui-card">
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
            <section className="ui-card">
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

              {/* Group Mechanics appears directly beneath the group-work selector */}
              {formData.groupWorkPermitted === "Yes" && (
                <div className="mt-5 p-5 rounded-2xl border border-indigo-200 bg-indigo-50 shadow-sm max-w-full overflow-hidden box-border">
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

              <div
                style={{
                  borderTop: "1px solid #f1f5f9",
                  marginTop: 28,
                  paddingTop: 28,
                }}
              >
                <div className="flex items-end justify-between mb-3">
                  <FieldLabel>Employability Skills Assessed</FieldLabel>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-500 bg-indigo-50 px-2.5 py-1 rounded-md mb-1.5 border border-indigo-100/50">
                    {selectedSkills.length} Selected
                  </span>
                </div>

                <div
                  className="max-h-[600px] overflow-y-auto border border-slate-200 rounded-2xl bg-slate-50/50 p-3 shadow-inner"
                  style={{ scrollbarWidth: "thin" }}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
                      const isExpanded = expandedSkills.includes(skillName);

                      return (
                        <div
                          key={skillName}
                          className={`flex flex-col transition-all duration-300 border rounded-xl overflow-hidden ${
                            isExpanded ? "col-span-1 lg:col-span-2" : ""
                          } ${
                            on
                              ? "bg-indigo-50 border-indigo-300 shadow-md shadow-indigo-100/50"
                              : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
                          }`}
                        >
                          <div className="flex items-center justify-between w-full h-14">
                            <label className="flex items-center gap-3 pl-4 py-3 cursor-pointer flex-1 h-full">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleSkill(skillName)}
                                className="w-4 h-4 cursor-pointer accent-indigo-600 transition-all"
                              />
                              <span
                                className={`text-[12px] font-extrabold uppercase tracking-widest ${on ? "text-indigo-900" : "text-slate-700"}`}
                              >
                                {skillName}
                              </span>
                            </label>

                            <button
                              type="button"
                              onClick={() => toggleSkillExpand(skillName)}
                              className={`h-full px-4 flex items-center justify-center transition-colors border-l ${
                                on
                                  ? "border-indigo-200 hover:bg-indigo-100/50 text-indigo-500"
                                  : "border-slate-100 hover:bg-slate-50 text-slate-400"
                              }`}
                              title={
                                isExpanded ? "Hide Details" : "Show Details"
                              }
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                className={`transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="6 9 12 15 18 9"></polyline>
                              </svg>
                            </button>
                          </div>

                          {/* Expanded Level Rubric Box */}
                          {isExpanded && (
                            <div
                              className={`px-4 pb-4 border-t ${on ? "border-indigo-200/60" : "border-slate-100"} cursor-default`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {skillDesc && (
                                <p
                                  className={`text-[13px] mt-3 font-medium leading-relaxed ${on ? "text-indigo-800" : "text-slate-500"}`}
                                >
                                  {skillDesc}
                                </p>
                              )}

                              {skillItem.levels && (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                                  {["3", "4", "5", "6"].map((lvl) => {
                                    const criteria = skillItem.levels[lvl];
                                    if (!criteria || criteria.length === 0)
                                      return null;
                                    return (
                                      <div
                                        key={lvl}
                                        className={`rounded-lg p-3 shadow-sm flex flex-col ${on ? "bg-white/60 border border-indigo-100/50" : "bg-slate-50 border border-slate-200/60"}`}
                                      >
                                        <div
                                          className={`text-[10px] font-bold mb-2 uppercase tracking-wider border-b pb-1.5 ${on ? "text-indigo-500 border-indigo-100/50" : "text-slate-500 border-slate-200"}`}
                                        >
                                          Level {lvl}
                                        </div>
                                        <ul className="list-disc pl-4 m-0 space-y-1.5">
                                          {criteria.map(
                                            (c: string, idx: number) => (
                                              <li
                                                key={idx}
                                                className={`text-[11px] leading-snug ${on ? "text-slate-700" : "text-slate-600"}`}
                                              >
                                                {c}
                                              </li>
                                            ),
                                          )}
                                        </ul>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            {/* 4 — AI Policy */}
            <section className="ui-card">
              <SectionHeading step={4} title="Generative AI Policy" />
              <div className="ai-policy-grid grid grid-cols-3 gap-4 mb-7">
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
            <section className="ui-card overflow-hidden box-border">
              <SectionHeading step={5} title="Content Specifications" />
              <details className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  Formatting help: tables, Markdown and LaTeX
                </summary>
                <div className="mt-3 grid gap-3 leading-5 lg:grid-cols-2">
                  <div>
                    <p className="font-semibold text-slate-700">
                      Markdown table
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[10px] text-slate-100">{`| Item | Value |\n| --- | --- |\n| Duration | 2 hours |`}</pre>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">
                      LaTeX mathematics
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[10px] text-slate-100">{`Inline: $O(n \\log n)$\n\nBlock:\n$$\n\\sum_{i=1}^{n} x_i\n$$`}</pre>
                  </div>
                </div>
              </details>
              <div className="space-y-4 max-w-full">
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
            <section className="ui-card max-w-full overflow-hidden box-border">
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
                      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                        <div>
                          <p className="text-xs font-semibold text-slate-700">
                            Grading framework
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            PGT assessments use a 50% pass threshold.
                          </p>
                        </div>
                        <select
                          className={`${INPUT} w-full sm:w-64`}
                          value={formData.gradingScheme || "UG"}
                          onChange={(event) =>
                            handleChange("gradingScheme", event.target.value)
                          }
                        >
                          <option value="UG">
                            Undergraduate (pass at 40%)
                          </option>
                          <option value="PGT">
                            Postgraduate taught (pass at 50%)
                          </option>
                        </select>
                      </div>
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
                          <div className="rubric-grade-grid grid grid-cols-2 lg:grid-cols-3 gap-4 p-5 bg-slate-50 max-w-full box-border">
                            {gradeBands.map((g) => (
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
          className="panel-divider h-full shrink-0 z-20 print:hidden select-none flex items-center justify-center bg-slate-100 border-l border-r border-slate-200"
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
        <div className="preview-panel flex-1 h-full flex flex-col overflow-hidden print:block print:h-auto print:overflow-visible print:bg-white print:p-0 print:m-0">
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
                onClick={() => setZoom(60)}
                className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-white hover:bg-white/10 rounded-md transition-all duration-150"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Document canvas */}
          <div className="flex-1 overflow-auto bg-slate-700 p-10 flex justify-center items-start print:p-0 print:block print:h-auto print:overflow-visible print:bg-white print:m-0">
            <div
              className="pdf-preview-stage mx-auto shrink-0"
              style={{
                width: `${(210 * zoom) / 100}mm`,
                minHeight: `${(297 * zoom) / 100}mm`,
              }}
            >
              <div
                ref={pdfPageRef}
                className="pdf-page corporate-document relative box-border bg-white text-black shrink-0 w-[210mm] min-h-[297mm] p-[20mm] shadow-[0_25px_60px_rgba(0,0,0,0.45)] print:w-[210mm] print:min-h-auto print:m-0 print:shadow-none print:block"
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: "top left",
                }}
              >
                {!isApprovedForExport && (
                  <>
                    <div className="draft-watermark" aria-hidden="true">
                      <span>DRAFT</span>
                      <small>Approvals outstanding</small>
                    </div>
                    {Array.from({ length: printPageCount }, (_, pageIndex) => (
                      <div
                        key={pageIndex}
                        className="print-page-watermark"
                        style={{ top: `${128.5 + pageIndex * 257}mm` }}
                        aria-hidden="true"
                      >
                        <span>DRAFT</span>
                        <small>Approvals outstanding</small>
                      </div>
                    ))}
                  </>
                )}

                {/* PDF Header */}
                <div className="corporate-masthead mb-8 border-b-[3px] border-black pb-4 text-center print:break-after-avoid">
                  <img
                    src="./UEA_Logo_BLK_MONO_N_A_59244.png"
                    alt="University of East Anglia"
                    className="corporate-document-logo"
                  />
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
                <table className="corporate-meta-table w-full text-left border-collapse border border-black mb-8 text-[11pt] break-inside-avoid print:break-inside-avoid">
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
                    {formData.coTaughtWeightingsEnabled &&
                      (
                        (formData.coTaughtModules || []) as CoTaughtModule[]
                      ).map((item) => (
                        <tr
                          key={item.id}
                          className="border-b border-black print:break-inside-avoid"
                        >
                          <th className="py-2.5 px-4 print-bg-gray-light bg-gray-100 w-[35%] border-r border-black font-semibold">
                            Co-taught module / weighting
                          </th>
                          <td className="py-2.5 px-4">
                            {item.module || "Module not specified"} —{" "}
                            {item.weighting || "Weighting not specified"}
                          </td>
                        </tr>
                      ))}
                    <tr className="border-b border-black print:break-inside-avoid">
                      <th className="py-2.5 px-4 print-bg-gray-light bg-gray-100 w-[35%] border-r border-black font-semibold">
                        Submission / Exam Date(s)
                      </th>
                      <td className="py-2.5 px-4">
                        {formData.submissionDates?.map(
                          (d: any, idx: number) => (
                            <div key={idx} className={idx > 0 ? "mt-1" : ""}>
                              {formatDateTime(d.date, d.description)}
                            </div>
                          ),
                        )}
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
                      className="corporate-section mb-8 break-inside-avoid print:break-inside-avoid"
                    >
                      <h3 className="corporate-section-title text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
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
                        if (!sectionToggles[s.id] || !formData[s.id])
                          return null;
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
                        <div className="mb-3 mt-6 text-[11pt]">
                          <strong>Employability Skills Assessed:</strong>{" "}
                          {selectedSkills.join(", ")}
                        </div>
                      )}

                      {/* Special Injection for Grading Matrix at end of Evaluation block */}
                      {hasGradingMatrix && (
                        <table className="corporate-rubric-table table-fixed w-full text-left border-collapse border border-black text-[8pt] leading-tight mt-4 break-words">
                          <thead className="break-inside-avoid print:break-inside-avoid">
                            <tr className="print-bg-gray bg-gray-100 text-center border-b-2 border-black font-bold">
                              <th className="border-r border-black p-1.5 w-[14%]">
                                Component
                              </th>
                              <th className="border-r border-black p-1.5 w-[7%] text-[7pt]">
                                Weight
                              </th>
                              {gradeBands.map((band, bandIndex) => (
                                <th
                                  key={band.key}
                                  className={`p-1.5 ${
                                    bandIndex < gradeBands.length - 1
                                      ? "border-r border-black"
                                      : ""
                                  }`}
                                >
                                  {band.label} ({band.range})
                                </th>
                              ))}
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
                                {gradeBands.map((band, bandIndex) => (
                                  <td
                                    key={band.key}
                                    className={`p-1.5 break-words ${
                                      bandIndex < gradeBands.length - 1
                                        ? "border-r border-black"
                                        : ""
                                    }`}
                                  >
                                    {row[band.key]}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}

                {/* Academic Integrity */}
                <div className="corporate-integrity mb-8 text-[11pt] leading-relaxed break-inside-avoid print:break-inside-avoid">
                  <p className="corporate-warning font-bold text-center underline mb-4 uppercase tracking-wider print:break-after-avoid">
                    {staticContent.academicIntegrity.warning}
                  </p>
                  <h3 className="corporate-section-title text-[14pt] font-bold border-b-2 border-black mb-3 uppercase tracking-tight print:break-after-avoid">
                    {staticContent.academicIntegrity.title}
                  </h3>
                  <MarkdownRenderer
                    content={staticContent.academicIntegrity.body}
                  />
                  <div className="corporate-notice p-6 sm:p-8 box-border border-2 border-black print-bg-gray-light bg-gray-50 italic mt-4 print:p-6">
                    {staticContent.academicIntegrity.groupWorkPrefix}{" "}
                    <strong className="uppercase font-extrabold">
                      {formData.groupWorkPermitted === "Yes"
                        ? "PERMITTED"
                        : "NOT PERMITTED"}
                    </strong>
                    .{" "}
                    {formData.groupWorkPermitted === "Yes"
                      ? "Collaboration is permitted only within your formally allocated group and must follow the group mechanics stated in this brief."
                      : staticContent.academicIntegrity.individualWarning}
                  </div>
                </div>

                {/* AI Policy */}
                <div className="corporate-ai-section mb-8">
                  <h3 className="corporate-section-title text-[14pt] font-bold border-b-2 border-black mb-4 uppercase tracking-tight print:break-after-avoid">
                    {staticContent.aiPolicy.title}
                  </h3>
                  <p className="mb-4 text-[11pt] leading-relaxed">
                    {staticContent.aiPolicy.preamble}
                  </p>

                  <div className="break-inside-avoid print:break-inside-avoid">
                    <table className="corporate-ai-tiers table-fixed w-full border-collapse border border-black mb-5 font-bold text-center text-[11pt]">
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
                    <div
                      className="corporate-policy-box border-2 border-black p-6 sm:p-8 box-border print-bg-gray-light bg-gray-50/50 leading-relaxed text-[11pt] print:p-6"
                      data-policy={formData.aiPolicy}
                    >
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
    </div>
  );
}
