"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import SKILLS_LIST from "../skills.json";
import ASSESSMENT_METHODS from "../assessments.json";
import TEMPLATE from "../template.json";
import MODULE_CATALOG from "../module-catalog.json";
import { AppHeader } from "@/app/components/app-header";
import {
  ACADEMIC_YEAR_OPTIONS,
  BriefDocument,
  UG_GRADE_BANDS,
  WORKFLOW_STAGES,
  briefDocumentDataFromContent,
  getDefaultState,
  gradeBandsFor,
  measurePrintPageCount,
  type CoTaughtModule,
  type RubricRow,
} from "@/app/components/brief-document";
import { backend, isBackendConfigured, type User } from "@/lib/backend";
import type {
  Assessment,
  BriefRoles,
  CheckerCandidate,
  Database,
  Json,
} from "@/lib/database.types";

// ─── Constants & Extracted Text ───────────────────────────────────────────────
const DRAFT_STORAGE_KEY = "uea_brief_draft_v2";

type ReviewStatusRow =
  Database["public"]["Functions"]["assessment_review_status"]["Returns"][number];


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


const createRubricRow = (): RubricRow => ({
  id: Date.now(),
  component: "New Component",
  weight: "10%",
  fail: "",
  pass: "",
  twoTwo: "",
  twoOne: "",
  first: "",
  excelled: "",
});

const AI_OPTIONS = [
  { value: "RED", emoji: "🔴", label: "RED", desc: "No AI Permitted" },
  { value: "AMBER", emoji: "🟡", label: "AMBER", desc: "Restricted Use" },
  { value: "GREEN", emoji: "🟢", label: "GREEN", desc: "Full Integration" },
];

// Approval runs setter -> checker -> cluster lead, in that order.
const stageLabel = (stage: string) =>
  WORKFLOW_STAGES.find((item) => item.id === stage)?.label ??
  stage.replaceAll("_", " ");

// An administrator can force-approve both stages so a brief blocked on an
// unavailable reviewer can still be exported. Say so plainly rather than
// letting it read as a genuine sign-off.
const overrideNotice = (reviews: ReviewStatusRow[]) => {
  const overridden = reviews.find((review) => review.overridden_by);
  if (!overridden) return null;
  const name = overridden.overridden_by_name || "an administrator";
  return `Approvals were overridden by ${name}. Editing this brief will void the override.`;
};

type ModuleCode = keyof typeof MODULE_CATALOG.modules;

const moduleValue = (code: string) => {
  const title = MODULE_CATALOG.modules[code as ModuleCode];
  return title ? `${code} ${title}` : code;
};

// ─── Helper Formatting Functions ──────────────────────────────────────────────



// ─── Sub-components ───────────────────────────────────────────────────────────


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

  // Marking-site session and persistence state
  const [briefsList, setBriefsList] = useState<Assessment[]>([]);
  const [currentBriefId, setCurrentBriefId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profileName, setProfileName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(isBackendConfigured);
  const [isBriefsLoading, setIsBriefsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmittingForReview, setIsSubmittingForReview] = useState(false);
  const [savedSignature, setSavedSignature] = useState("");
  const [exportApprovalOverride, setExportApprovalOverride] = useState<
    boolean | null
  >(null);
  const [reviewStatuses, setReviewStatuses] = useState<ReviewStatusRow[]>([]);
  const [checkerId, setCheckerId] = useState<string>("");
  const [checkerCandidates, setCheckerCandidates] = useState<CheckerCandidate[]>(
    [],
  );
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
  const gradeBands = gradeBandsFor(formData.gradingScheme);
  const coTaughtModules = (formData.coTaughtModules ||
    []) as CoTaughtModule[];
  const currentEditorSignature = JSON.stringify({
    formData,
    sectionToggles,
    selectedSkills,
    rubricRows,
    uploadedImages,
    checkerId,
  });
  const currentSavedAssessment = briefsList.find(
    (brief) => brief.id === currentBriefId,
  );
  const hasUnsavedChanges =
    !currentBriefId || currentEditorSignature !== savedSignature;
  const isApprovedForExport =
    !hasUnsavedChanges &&
    (exportApprovalOverride ?? currentSavedAssessment?.status === "approved");

  const refreshBriefs = useCallback(async () => {
    setIsBriefsLoading(true);
    setPersistenceError(null);

    const { data, error } = await backend.rpc<Assessment[]>("my_assessments");

    if (error) {
      setPersistenceError(error.message);
      setBriefsList([]);
    } else {
      setBriefsList(data ?? []);
    }
    setIsBriefsLoading(false);
  }, []);

  // Any registered user other than the setter can be nominated as the checker.
  const refreshCheckerCandidates = useCallback(async () => {
    const { data, error } =
      await backend.rpc<CheckerCandidate[]>("checker_candidates");

    if (error) {
      setPersistenceError(error.message);
      setCheckerCandidates([]);
      return;
    }
    setCheckerCandidates(data ?? []);
  }, []);

  const refreshReviewStatus = useCallback(
    async (assessmentId: string): Promise<ReviewStatusRow[]> => {
      const { data, error } = await backend.rpc<ReviewStatusRow[]>(
        "assessment_review_status",
        { target_assessment_id: assessmentId },
      );
      if (error) {
        setPersistenceError(error.message);
        setReviewStatuses([]);
        return [];
      }
      const rows = data ?? [];
      setReviewStatuses(rows);
      return rows;
    },
    [],
  );

  const refreshAdminStatus = useCallback(async () => {
    const { data } = await backend.rpc<BriefRoles>("my_roles");
    setIsAdmin(Boolean(data?.has_oversight));
  }, []);

  // Load the local draft and pick up the marking-site session.
  useEffect(() => {
    setIsClient(true);

    const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        const loaded = briefDocumentDataFromContent(parsed);
        setFormData(loaded.formData);
        setSectionToggles(loaded.sectionToggles);
        setSelectedSkills(loaded.selectedSkills);
        setRubricRows(loaded.rubricRows);
        setUploadedImages(loaded.uploadedImages);
        setCheckerId(parsed.checkerId || "");
        setCurrentBriefId(parsed.currentBriefId || null);
      } catch (error) {
        console.error("Failed to parse draft:", error);
      }
    }

    const syncSession = async () => {
      const {
        data: { session },
      } = await backend.auth.getSession();
      const user = session?.user ?? null;
      setCurrentUser(user);
      setIsAuthLoading(false);
      if (!user) {
        setBriefsList([]);
        setCheckerCandidates([]);
        setProfileName("");
        setIsAdmin(false);
        return;
      }
      // Supervisor.dn is always set, so there is no display name to collect.
      setProfileName(String(user.user_metadata.full_name ?? ""));
      await Promise.all([
        refreshBriefs(),
        refreshAdminStatus(),
        refreshCheckerCandidates(),
      ]);
    };
    void syncSession();
  }, [refreshAdminStatus, refreshBriefs, refreshCheckerCandidates]);

  // Auto-save draft
  useEffect(() => {
    if (!isClient) return;
    const draft = {
      formData,
      sectionToggles,
      selectedSkills,
      rubricRows,
      uploadedImages,
      checkerId,
      currentBriefId,
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [
    formData,
    sectionToggles,
    selectedSkills,
    rubricRows,
    uploadedImages,
    checkerId,
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

    const {
      formData: loadedFormData,
      sectionToggles: loadedSectionToggles,
      selectedSkills: loadedSkills,
      rubricRows: loadedRubrics,
      uploadedImages: loadedImages,
    } = briefDocumentDataFromContent(brief.content);
    const loadedCheckerId = brief.checker_id || "";

    hasHandledBriefLink.current = true;
    setFormData(loadedFormData);
    setSectionToggles(loadedSectionToggles);
    setSelectedSkills(loadedSkills);
    setRubricRows(loadedRubrics);
    setUploadedImages(loadedImages);
    setCheckerId(loadedCheckerId);
    setCurrentBriefId(brief.id);
    setExportApprovalOverride(null);
    setSavedSignature(
      JSON.stringify({
        formData: loadedFormData,
        sectionToggles: loadedSectionToggles,
        selectedSkills: loadedSkills,
        rubricRows: loadedRubrics,
        uploadedImages: loadedImages,
        checkerId: loadedCheckerId,
      }),
    );
    void refreshReviewStatus(brief.id).then((reviews) =>
      setWorkflowMessage(overrideNotice(reviews)),
    );
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
    setCheckerId("");
    setCurrentBriefId(null);
    setSavedSignature("");
    setExportApprovalOverride(null);
    setReviewStatuses([]);
    setWorkflowMessage(null);
    if (typeof window !== "undefined" && window.innerWidth < 768)
      setIsSidebarOpen(false);
  };

  const handleSignIn = async () => {
    setPersistenceError(null);
    const { error } = await backend.auth.signInWithOAuth();
    if (error) setPersistenceError(error.message);
  };

  const handleSignOut = async () => {
    await backend.auth.signOut();
  };

  const handleLoadBrief = (briefId: string) => {
    const brief = briefsList.find((item) => item.id === briefId);
    if (!brief) return;
    const {
      formData: loadedFormData,
      sectionToggles: loadedSectionToggles,
      selectedSkills: loadedSkills,
      rubricRows: loadedRubrics,
      uploadedImages: loadedImages,
    } = briefDocumentDataFromContent(brief.content);
    const loadedCheckerId = brief.checker_id || "";

    setFormData(loadedFormData);
    setSectionToggles(loadedSectionToggles);
    setSelectedSkills(loadedSkills);
    setExpandedSkills([]);
    setRubricRows(loadedRubrics);
    setUploadedImages(loadedImages);
    setCheckerId(loadedCheckerId);
    setCurrentBriefId(brief.id);
    setExportApprovalOverride(null);
    setSavedSignature(
      JSON.stringify({
        formData: loadedFormData,
        sectionToggles: loadedSectionToggles,
        selectedSkills: loadedSkills,
        rubricRows: loadedRubrics,
        uploadedImages: loadedImages,
        checkerId: loadedCheckerId,
      }),
    );
    setWorkflowMessage(null);
    void refreshReviewStatus(brief.id).then((reviews) =>
      setWorkflowMessage(overrideNotice(reviews)),
    );
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleDeleteBrief = async (
    event: React.MouseEvent,
    briefId: string,
  ) => {
    event.stopPropagation();
    if (!window.confirm("Delete this saved brief forever?")) return;

    const { error } = await backend.rpc("delete_assessment", { id: briefId });

    if (error) {
      setPersistenceError(error.message);
      return;
    }

    setBriefsList((current) => current.filter((brief) => brief.id !== briefId));
    if (currentBriefId === briefId) loadDefault();
  };

  const handleSaveToDatabase = async () => {
    if (!currentUser) {
      setPersistenceError("Sign in to the marking site to save assessments.");
      return;
    }

    setIsSaving(true);
    setPersistenceError(null);

    const module = String(formData.module || "").trim();
    const assessmentName = String(formData.assessmentName || "").trim();
    const title = assessmentName || module || "Untitled Assessment";
    const moduleCode = module.split(/\s+/)[0] || "Unspecified";
    const moduleLevelMatch = moduleCode.match(/\d/);
    const moduleLevel = moduleLevelMatch ? Number(moduleLevelMatch[0]) : null;
    const programme = String(formData.programme || "").trim() || null;
    const selectedAcademicYear = String(formData.academicYear || "");
    const academicYear = ACADEMIC_YEAR_OPTIONS.includes(selectedAcademicYear)
      ? selectedAcademicYear
      : "Unspecified";
    const persistedFormData: Record<string, unknown> = { ...formData };
    delete persistedFormData.submissionDates;
    delete persistedFormData.returnOfFeedback;

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
    } else {
      persistedFormData.coTaughtModules = coTaughtModules.map((item) => {
        const keepMatrix =
          !!item.gradingMatrixEnabled && !!sectionToggles.gradingMatrix;
        return {
          ...item,
          markingScheme: item.markingSchemeEnabled
            ? item.markingScheme || null
            : null,
          rubricRows: keepMatrix
            ? (item.rubricRows || []).map((row) =>
                (item.gradingScheme || formData.gradingScheme) === "PGT"
                  ? { ...row, pass: null }
                  : row,
              )
            : null,
        };
      });
    }

    if (formData.assessmentType !== "Other") {
      persistedFormData.customAssessmentName = null;
      persistedFormData.customAssessmentDesc = null;
    }

    if (formData.aiPolicy !== "RED") {
      persistedFormData.aiRedRationale = null;
    }
    if (formData.aiPolicy !== "AMBER") {
      persistedFormData.aiAmberPermitted = null;
      persistedFormData.aiAmberProhibited = null;
      persistedFormData.aiAmberRationale = null;
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
      checker_id: checkerId || null,
      content,
    };

    const existingId =
      currentBriefId && briefsList.some((brief) => brief.id === currentBriefId)
        ? currentBriefId
        : null;

    const { data, error } = await backend.rpc<Assessment>("save_assessment", {
      id: existingId,
      record,
    });
    setIsSaving(false);

    if (error || !data) {
      setPersistenceError(error?.message ?? "The brief could not be saved.");
      return;
    }

    setCurrentBriefId(data.id);
    setExportApprovalOverride(null);
    setSavedSignature(currentEditorSignature);
    setWorkflowMessage(
      data.status === "draft"
        ? "Draft saved. Nominate a checker, then submit it for approval."
        : "Assessment saved.",
    );
    await Promise.all([refreshBriefs(), refreshReviewStatus(data.id)]);
  };

  const handleSubmitForReview = async () => {
    if (!currentUser || !currentBriefId) {
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
    const { error } = await backend.rpc("submit_assessment_for_review", {
      target_assessment_id: currentBriefId,
    });
    setIsSubmittingForReview(false);

    if (error) {
      setPersistenceError(error.message);
      return;
    }

    setWorkflowMessage(
      "Submitted to your checker. It passes to the cluster lead once they approve.",
    );
    await Promise.all([refreshBriefs(), refreshReviewStatus(currentBriefId)]);
  };

  const prepareWatermarksForPrint = () => {
    setPrintPageCount(measurePrintPageCount(pdfPageRef.current));
  };

  const openPrintDialog = () => {
    prepareWatermarksForPrint();
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => window.print()),
    );
  };

  const handleExportPdf = async () => {
    if (!currentBriefId || hasUnsavedChanges) {
      openPrintDialog();
      return;
    }

    setPersistenceError(null);
    const { data: fullyApproved, error } = await backend.rpc<boolean>(
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
      // Re-read the stages before printing: the approval block goes onto the
      // document, so it must name whoever actually signed off, and an
      // administrator may have overridden since this page was loaded.
      const reviews = await refreshReviewStatus(currentBriefId);
      setWorkflowMessage(overrideNotice(reviews));
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

  const addRubricRow = () => setRubricRows([...rubricRows, createRubricRow()]);
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
    patch: Partial<CoTaughtModule>,
  ) =>
    setFormData((current) => ({
      ...current,
      coTaughtModules: (
        (current.coTaughtModules || []) as CoTaughtModule[]
      ).map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  const removeCoTaughtModule = (id: number) =>
    setFormData((current) => ({
      ...current,
      coTaughtModules: (
        (current.coTaughtModules || []) as CoTaughtModule[]
      ).filter((item) => item.id !== id),
    }));

  // Per-module marking scheme / grading matrix overrides.
  const toggleCoTaughtMarkingScheme = (id: number) => {
    const item = coTaughtModules.find((entry) => entry.id === id);
    if (!item) return;
    updateCoTaughtModule(id, {
      markingSchemeEnabled: !item.markingSchemeEnabled,
    });
  };

  const toggleCoTaughtGradingMatrix = (id: number) => {
    const item = coTaughtModules.find((entry) => entry.id === id);
    if (!item) return;
    const enabled = !item.gradingMatrixEnabled;
    updateCoTaughtModule(id, {
      gradingMatrixEnabled: enabled,
      gradingScheme: item.gradingScheme || String(formData.gradingScheme || "UG"),
      rubricRows: enabled && !item.rubricRows?.length
        ? rubricRows.map((row, index) => ({ ...row, id: Date.now() + index }))
        : item.rubricRows,
    });
  };

  const addCoTaughtRubricRow = (id: number) => {
    const item = coTaughtModules.find((entry) => entry.id === id);
    if (!item) return;
    updateCoTaughtModule(id, {
      rubricRows: [...(item.rubricRows || []), createRubricRow()],
    });
  };

  const updateCoTaughtRubricRow = (
    id: number,
    rowId: number,
    field: string,
    value: string,
  ) => {
    const item = coTaughtModules.find((entry) => entry.id === id);
    if (!item) return;
    updateCoTaughtModule(id, {
      rubricRows: (item.rubricRows || []).map((row) =>
        row.id === rowId ? { ...row, [field]: value } : row,
      ),
    });
  };

  const removeCoTaughtRubricRow = (id: number, rowId: number) => {
    const item = coTaughtModules.find((entry) => entry.id === id);
    if (!item) return;
    updateCoTaughtModule(id, {
      rubricRows: (item.rubricRows || []).filter((row) => row.id !== rowId),
    });
  };

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: string | ((markdown: string) => void),
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
        const markdown = `\n\n![Image | 100% | center](attachment:${imgId})\n`;
        if (typeof target === "function") {
          target(markdown);
        } else {
          setFormData((prev) => ({
            ...prev,
            [target]: (prev[target] || "") + markdown,
          }));
        }
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

  const renderContentEditorField = (fieldId: string, label: string) => {
    const isVisible = sectionToggles[fieldId] !== false;

    return (
      <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm max-w-full overflow-hidden box-border">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              {label}
            </label>
            <label className="cursor-pointer text-[9px] font-extrabold uppercase tracking-wider rounded px-2 py-1 bg-white hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 border border-slate-200 flex items-center gap-1 shadow-sm">
              Add Image
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleImageUpload(event, fieldId)}
              />
            </label>
          </div>
          <VisibilityToggle
            checked={isVisible}
            onChange={() => toggleSection(fieldId)}
          />
        </div>
        <textarea
          className={`${INPUT} font-mono h-32 leading-relaxed resize-y ${isVisible ? "" : "opacity-60"}`}
          value={(formData[fieldId] as string) || ""}
          onChange={(event) => handleChange(fieldId, event.target.value)}
          onKeyDown={(event) =>
            handleTab(event, (value) => handleChange(fieldId, value))
          }
          aria-describedby={`${fieldId}-visibility-note`}
        />
        {!isVisible && (
          <p
            id={`${fieldId}-visibility-note`}
            className="mt-2 text-[11px] text-slate-500"
          >
            This content remains editable but is currently hidden from the PDF.
          </p>
        )}
      </div>
    );
  };

  const renderRubricEditor = (
    rows: RubricRow[],
    bands: typeof UG_GRADE_BANDS,
    handlers: {
      update: (rowId: number, field: string, value: string) => void;
      remove: (rowId: number) => void;
      add: () => void;
    },
  ) => (
    <>
      {rows.map((row) => (
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
              onClick={() => handlers.remove(row.id)}
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
                  handlers.update(row.id, "component", e.target.value)
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
                  handlers.update(row.id, "weight", e.target.value)
                }
              />
            </div>
          </div>
          <div className="rubric-grade-grid grid grid-cols-2 lg:grid-cols-3 gap-4 p-5 bg-slate-50 max-w-full box-border">
            {bands.map((g) => (
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
                  className="w-full max-w-full box-border bg-white border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/10 px-3 py-2 rounded-lg text-xs h-24 outline-none resize-none text-slate-700 transition-all"
                  value={(row[g.key] as string) || ""}
                  onChange={(e) =>
                    handlers.update(row.id, g.key, e.target.value)
                  }
                  onKeyDown={(e) =>
                    handleTab(e, (val) => handlers.update(row.id, g.key, val))
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={handlers.add}
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
    </>
  );

  const renderGradingSchemeSelect = (
    value: string,
    onChange: (value: string) => void,
  ) => (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <p className="text-xs font-semibold text-slate-700">Grading framework</p>
        <p className="mt-1 text-[11px] text-slate-500">
          PGT assessments use a 50% pass threshold.
        </p>
      </div>
      <select
        className={`${INPUT} w-full sm:w-64`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="UG">Undergraduate (pass at 40%)</option>
        <option value="PGT">Postgraduate taught (pass at 50%)</option>
      </select>
    </div>
  );


  const renderSkillGroup = (category: "Transferable" | "Technical") => {
    const skills = SKILLS_LIST.filter((skill) => skill.category === category);

    return (
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {category} Skills
          </h3>
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-600">
            {
              skills.filter((skill) => selectedSkills.includes(skill.name))
                .length
            }{" "}
            selected
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {skills.map((skill) => {
            const selected = selectedSkills.includes(skill.name);
            const expanded = expandedSkills.includes(skill.name);
            const levels = skill.levels as Record<string, string[]>;

            return (
              <div
                key={skill.name}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  selected
                    ? "border-indigo-300 bg-indigo-50"
                    : "border-slate-200 bg-white"
                } ${expanded ? "lg:col-span-2" : ""}`}
              >
                <div className="flex min-h-14 items-center">
                  <label className="flex flex-1 cursor-pointer items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSkill(skill.name)}
                      className="h-4 w-4 rounded accent-indigo-600"
                    />
                    <span className="text-xs font-semibold text-slate-800">
                      {skill.name}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleSkillExpand(skill.name)}
                    className="self-stretch border-l border-slate-200 px-4 text-xs font-semibold text-slate-500 hover:bg-white/70 hover:text-indigo-600"
                    aria-expanded={expanded}
                  >
                    {expanded ? "Hide" : "Details"}
                  </button>
                </div>
                {expanded && (
                  <div className="border-t border-slate-200 px-4 py-4">
                    <p className="text-xs leading-5 text-slate-600">
                      {skill.description}
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {["3", "4", "5", "6"].map((level) => (
                        <div
                          key={level}
                          className="rounded-lg border border-slate-200 bg-white p-3"
                        >
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                            Level {level}
                          </p>
                          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-4 text-slate-600">
                            {(levels[level] || []).map((criterion) => (
                              <li key={criterion}>{criterion}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
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
            {!isBackendConfigured && (
              <div className="text-xs text-amber-300/80 text-center p-5 border border-dashed border-amber-500/30 rounded-xl mt-2">
                Shared storage is unavailable. Reload the page to try again.
              </div>
            )}
            {isBackendConfigured && isAuthLoading && (
              <div className="text-xs text-slate-500 text-center p-6">
                Checking your session…
              </div>
            )}
            {isBackendConfigured && !isAuthLoading && !currentUser && (
              <div className="text-xs text-slate-400 text-center p-5 border border-dashed border-slate-700 rounded-xl mt-2">
                <p className="mb-3">
                  Sign in to the marking site to access saved briefs.
                </p>
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="px-4 py-2 rounded-full bg-indigo-600 text-white font-semibold hover:bg-indigo-500"
                >
                  Sign in
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
                  {(profileName || "U")
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {profileName || "Signed-in user"}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    Signed in via the marking site
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
            subtitle={formData.assessmentName || formData.module || "New brief"}
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
                {!isBackendConfigured && (
                  <span className="hidden 2xl:inline text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
                    Storage unavailable
                  </span>
                )}
                {isBackendConfigured && !isAuthLoading && !currentUser && (
                  <button
                    type="button"
                    onClick={handleSignIn}
                    className="toolbar-action toolbar-action-muted flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
                  >
                    Sign in
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
                  {WORKFLOW_STAGES.map((stage) => {
                    const review = reviewStatuses.find(
                      (item) => item.stage === stage.id,
                    );
                    const isBlocked =
                      review?.awaiting_previous_stage &&
                      review.state !== "approved";
                    const isOverridden = Boolean(review?.overridden_by);
                    return (
                      <span
                        key={stage.id}
                        className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${
                          isOverridden
                            ? "border-amber-400 bg-emerald-50 text-emerald-800"
                            : review?.state === "approved"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : review?.state === "changes_requested"
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : isBlocked
                                  ? "border-slate-200 bg-slate-50 text-slate-500"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                        title={
                          isOverridden
                            ? `Overridden by ${review?.overridden_by_name || "an administrator"}`
                            : review?.reviewer_name ||
                              (stage.id === "checker"
                                ? "No checker nominated yet"
                                : "Awaiting a scoped cluster lead")
                        }
                      >
                        {stage.shortLabel}:{" "}
                        {isOverridden
                          ? "overridden"
                          : review?.state === "pending" && isBlocked
                            ? "waiting on checker"
                            : review?.state?.replaceAll("_", " ") || "pending"}
                      </span>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={handleSubmitForReview}
                  disabled={
                    isSubmittingForReview ||
                    hasUnsavedChanges ||
                    !checkerId ||
                    currentSavedAssessment.status !== "draft"
                  }
                  className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSubmittingForReview
                    ? "Submitting…"
                    : hasUnsavedChanges
                      ? "Save before submitting"
                      : currentSavedAssessment.status === "draft"
                        ? checkerId
                          ? "Submit for approval"
                          : "Select a checker first"
                        : currentSavedAssessment.status === "approved"
                          ? "Fully approved"
                          : "Review in progress"}
                </button>
              </div>

              {/* Stage 1 of the workflow: the setter nominates their checker. */}
              <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                <div className="min-w-0 flex-1">
                  <FieldLabel>
                    Checker — reviews this brief before the cluster lead
                  </FieldLabel>
                  <select
                    className={`${INPUT} sm:max-w-md`}
                    value={checkerId}
                    onChange={(event) => setCheckerId(event.target.value)}
                    disabled={currentSavedAssessment.status !== "draft"}
                  >
                    <option value="">Select a registered user…</option>
                    {checkerCandidates.map((candidate) => (
                      <option
                        key={candidate.user_id}
                        value={candidate.user_id}
                      >
                        {candidate.display_name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-slate-500 sm:max-w-xs">
                  {currentSavedAssessment.status === "draft"
                    ? checkerCandidates.length === 0
                      ? "No other registered users are available to check this brief yet."
                      : "Save the brief after choosing, then submit for approval."
                    : "The checker is fixed until the brief returns to draft."}
                </p>
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
                        key={review.stage}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                      >
                        <p className="font-semibold">
                          {stageLabel(review.stage)} requested changes
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
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                  <FieldLabel>Programme filter</FieldLabel>
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
                            <option key={programme.name} value={programme.name}>
                              {programme.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null;
                    })}
                  </select>
                  <p className="mt-2 text-[11px] leading-5 text-indigo-700/80">
                    Used to filter the module catalogue and route reviews; it is
                    not shown in the assessment brief.
                  </p>
                </div>

                {/* Official header fields from the template */}
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
                        Co-taught modules
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Add another module when the same brief is assessed on
                        more than one module. Each module can carry its own
                        weighting, and its own marking scheme or grading matrix
                        in step 7.
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
                      {coTaughtModules.map((item) => (
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
                              updateCoTaughtModule(item.id, {
                                module: event.target.value,
                              })
                            }
                          />
                          <input
                            type="text"
                            className={INPUT}
                            placeholder="Weighting, e.g. 50%"
                            value={item.weighting}
                            onChange={(event) =>
                              updateCoTaughtModule(item.id, {
                                weighting: event.target.value,
                              })
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
              </div>
            </section>

            {/* 2 — Overview & Learning Outcomes */}
            <section className="ui-card">
              <SectionHeading step={2} title="Overview & Learning Outcomes" />
              <details className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  Formatting help: tables, Markdown and LaTeX
                </summary>
                <p className="mt-2 leading-5">
                  These editors support Markdown tables, images, and inline or
                  block LaTeX mathematics.
                </p>
                <div className="mt-3 grid gap-3 leading-5 lg:grid-cols-2">
                  <div>
                    <p className="font-semibold text-slate-700">
                      Markdown table
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[10px] text-slate-100">{`| Item | Value |
| --- | --- |
| Duration | 2 hours |`}</pre>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">
                      LaTeX mathematics
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[10px] text-slate-100">{`Inline: $O(n \\log n)$

Block:
$$
\\sum_{i=1}^{n} x_i
$$`}</pre>
                  </div>
                </div>
              </details>
              <div className="space-y-4">
                {renderContentEditorField(
                  "contextScenario",
                  "Context & Scenario",
                )}
                {renderContentEditorField(
                  "learningOutcomes",
                  "Learning Outcomes Assessed",
                )}
              </div>
            </section>

            {/* 3 — Employability Skills */}
            <section className="ui-card">
              <SectionHeading step={3} title="Employability Skills" />
              <div className="space-y-8">
                {renderSkillGroup("Transferable")}
                {renderSkillGroup("Technical")}
              </div>
            </section>

            {/* 4 — Task Specification */}
            <section className="ui-card">
              <SectionHeading step={4} title="Task Specification" />
              <div className="space-y-4">
                {renderContentEditorField(
                  "coreObjectives",
                  "Task Spec / Core Objectives",
                )}
                {renderContentEditorField(
                  "architectureConstraints",
                  "Architecture & Technical Constraints",
                )}
              </div>
            </section>

            {/* 5 — Deliverables */}
            <section className="ui-card">
              <SectionHeading step={5} title="Deliverables" />
              <div className="space-y-4">
                {renderContentEditorField("deliverables", "Deliverables")}
                {renderContentEditorField(
                  "submissionInstructions",
                  "Submission Instructions",
                )}
              </div>
            </section>

            {/* 6 — Resources & Contact */}
            <section className="ui-card">
              <SectionHeading step={6} title="Resources & Contact" />
              <div className="space-y-4">
                {renderContentEditorField(
                  "resourcesHints",
                  "Resources & Hints",
                )}
                {renderContentEditorField("contactInfo", "Contact Information")}
              </div>
            </section>

            {/* 7 — Evaluation & Grading */}
            <section className="ui-card max-w-full overflow-hidden box-border">
              <SectionHeading step={7} title="Evaluation & Grading" />
              <div className="space-y-4 max-w-full">
                {renderContentEditorField("markingScheme", "Marking Scheme")}

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
                      {renderGradingSchemeSelect(
                        String(formData.gradingScheme || "UG"),
                        (value) => handleChange("gradingScheme", value),
                      )}
                      {renderRubricEditor(rubricRows, gradeBands, {
                        update: updateRubricRow,
                        remove: removeRubricRow,
                        add: addRubricRow,
                      })}
                    </div>
                  )}
                </div>

                {/* Per-module marking schemes and grading matrices */}
                {formData.coTaughtWeightingsEnabled &&
                  coTaughtModules.length > 0 && (
                    <div className="space-y-4 max-w-full">
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                        <p className="text-xs font-semibold text-slate-700">
                          Co-taught module overrides
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Where a co-taught module is marked differently, add its
                          own marking scheme or grading matrix. Anything left off
                          falls back to the shared version above.
                        </p>
                      </div>

                      {coTaughtModules.map((item, index) => {
                        const moduleLabel =
                          item.module || `Co-taught module ${index + 1}`;
                        const moduleBands = gradeBandsFor(
                          item.gradingScheme || String(formData.gradingScheme || "UG"),
                        );
                        const moduleRubricRows = item.rubricRows || [];

                        return (
                          <div
                            key={item.id}
                            className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-sm max-w-full overflow-hidden box-border space-y-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                                {moduleLabel}
                              </label>
                              {item.weighting && (
                                <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                                  {item.weighting}
                                </span>
                              )}
                            </div>

                            {/* Module-specific marking scheme */}
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-semibold text-slate-700">
                                    Module-specific marking scheme
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    Printed after the shared marking scheme,
                                    under this module&apos;s heading.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleCoTaughtMarkingScheme(item.id)
                                  }
                                  aria-pressed={!!item.markingSchemeEnabled}
                                  className={`rounded-full px-4 py-2 text-xs font-semibold ${
                                    item.markingSchemeEnabled
                                      ? "bg-indigo-600 text-white"
                                      : "border border-slate-300 bg-white text-slate-600"
                                  }`}
                                >
                                  {item.markingSchemeEnabled ? "Added" : "Add"}
                                </button>
                              </div>
                              {item.markingSchemeEnabled && (
                                <div className="mt-4 border-t border-slate-100 pt-4">
                                  <div className="mb-2 flex items-center gap-3">
                                    <label className="cursor-pointer text-[9px] font-extrabold uppercase tracking-wider rounded px-2 py-1 bg-white hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 border border-slate-200 flex items-center gap-1 shadow-sm">
                                      Add Image
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(event) =>
                                          handleImageUpload(
                                            event,
                                            (markdown) =>
                                              updateCoTaughtModule(item.id, {
                                                markingScheme:
                                                  (item.markingScheme || "") +
                                                  markdown,
                                              }),
                                          )
                                        }
                                      />
                                    </label>
                                  </div>
                                  <textarea
                                    className={`${INPUT} font-mono h-32 leading-relaxed resize-y`}
                                    value={item.markingScheme || ""}
                                    onChange={(event) =>
                                      updateCoTaughtModule(item.id, {
                                        markingScheme: event.target.value,
                                      })
                                    }
                                    onKeyDown={(event) =>
                                      handleTab(event, (value) =>
                                        updateCoTaughtModule(item.id, {
                                          markingScheme: value,
                                        }),
                                      )
                                    }
                                  />
                                </div>
                              )}
                            </div>

                            {/* Module-specific grading matrix */}
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-semibold text-slate-700">
                                    Module-specific grading matrix
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    Printed as an extra table for this module.
                                    Starts as a copy of the shared matrix so you
                                    only edit what differs.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleCoTaughtGradingMatrix(item.id)
                                  }
                                  aria-pressed={!!item.gradingMatrixEnabled}
                                  className={`rounded-full px-4 py-2 text-xs font-semibold ${
                                    item.gradingMatrixEnabled
                                      ? "bg-indigo-600 text-white"
                                      : "border border-slate-300 bg-white text-slate-600"
                                  }`}
                                >
                                  {item.gradingMatrixEnabled ? "Added" : "Add"}
                                </button>
                              </div>
                              {item.gradingMatrixEnabled && (
                                <div className="mt-4 space-y-5 border-t border-slate-100 pt-4 max-w-full">
                                  {renderGradingSchemeSelect(
                                    item.gradingScheme ||
                                      String(formData.gradingScheme || "UG"),
                                    (value) =>
                                      updateCoTaughtModule(item.id, {
                                        gradingScheme: value,
                                      }),
                                  )}
                                  {renderRubricEditor(
                                    moduleRubricRows,
                                    moduleBands,
                                    {
                                      update: (rowId, field, value) =>
                                        updateCoTaughtRubricRow(
                                          item.id,
                                          rowId,
                                          field,
                                          value,
                                        ),
                                      remove: (rowId) =>
                                        removeCoTaughtRubricRow(item.id, rowId),
                                      add: () => addCoTaughtRubricRow(item.id),
                                    },
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
            </section>
            {/* 8 — Assessment Method */}
            <section className="ui-card">
              <SectionHeading step={8} title="Assessment Method" />
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

            {/* 9 — Group Work & Academic Integrity */}
            <section className="ui-card">
              <SectionHeading
                step={9}
                title="Group Work & Academic Integrity"
              />
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
            </section>

            {/* 10 — Generative AI Policy */}
            <section className="ui-card">
              <SectionHeading step={10} title="Generative AI Policy" />
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

              {formData.aiPolicy === "RED" && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200">
                  <label className="block text-xs font-bold text-red-700 uppercase tracking-wide mb-1.5">
                    Why AI cannot be used
                  </label>
                  <p className="mb-2 text-xs leading-5 text-red-700/80">
                    Printed on the brief so students understand the reason for
                    the ban rather than only being told about it.
                  </p>
                  <textarea
                    className="w-full max-w-full box-border bg-white border border-red-200 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 rounded-lg px-3.5 py-2.5 text-sm outline-none h-24 resize-y transition-all"
                    placeholder="e.g. This assessment measures your own ability to design and write algorithms from first principles, so any AI-generated work would not evidence the learning outcomes it is marked against."
                    value={formData.aiRedRationale || ""}
                    onChange={(e) =>
                      handleChange("aiRedRationale", e.target.value)
                    }
                    onKeyDown={(e) =>
                      handleTab(e, (val) => handleChange("aiRedRationale", val))
                    }
                  />
                </div>
              )}
              {formData.aiPolicy === "AMBER" && (
                <div className="space-y-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
                  {[
                    { label: "Permitted Uses", field: "aiAmberPermitted" },
                    { label: "Prohibited Uses", field: "aiAmberProhibited" },
                    {
                      label: "Why these restrictions apply",
                      field: "aiAmberRationale",
                      hint: "Printed on the brief so students understand the reason for the limits rather than only being told about them.",
                      placeholder:
                        "e.g. Debugging help is allowed because it mirrors professional practice, but the design work is prohibited because it is exactly what this assessment marks.",
                    },
                  ].map(({ label, field, hint, placeholder }) => (
                    <div key={field}>
                      <label className="block text-xs font-bold text-amber-700 uppercase tracking-wide mb-1.5">
                        {label}
                      </label>
                      {hint && (
                        <p className="mb-2 text-xs leading-5 text-amber-700/80">
                          {hint}
                        </p>
                      )}
                      <textarea
                        className="w-full max-w-full box-border bg-white border border-amber-200 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 rounded-lg px-3.5 py-2.5 text-sm outline-none h-24 resize-y transition-all"
                        placeholder={placeholder}
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
              <BriefDocument
                pageRef={pdfPageRef}
                zoom={zoom}
                formData={formData}
                sectionToggles={sectionToggles}
                selectedSkills={selectedSkills}
                rubricRows={rubricRows}
                uploadedImages={uploadedImages}
                reviewStatuses={reviewStatuses}
                isApproved={isApprovedForExport}
                printPageCount={printPageCount}
                version={currentSavedAssessment?.version}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
