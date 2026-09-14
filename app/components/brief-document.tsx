"use client";

// The A4 assessment brief document, shared by the builder's live preview and
// the read-only review panel. Both must render byte-for-byte the same thing: a
// reviewer signs off on what the student will actually receive, so there is
// exactly one implementation of it here.

import type { RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

import SKILLS_LIST from "../skills.json";
import TEMPLATE from "../template.json";
import type { Database, Json } from "@/lib/database.types";

type ReviewStatusRow =
  Database["public"]["Functions"]["assessment_review_status"]["Returns"][number];


export type RubricRow = Record<string, any> & { id: number };

// A co-taught module can optionally carry its own marking scheme and/or grading
// matrix when the same brief is assessed differently on each module.
export type CoTaughtModule = {
  id: number;
  module: string;
  weighting: string;
  markingSchemeEnabled?: boolean;
  markingScheme?: string;
  gradingMatrixEnabled?: boolean;
  gradingScheme?: string;
  rubricRows?: RubricRow[];
};

export type SavedBriefContent = {
  formData?: Record<string, unknown>;
  sectionToggles?: Record<string, boolean>;
  selectedSkills?: string[];
  rubricRows?: Record<string, unknown>[];
  uploadedImages?: Record<string, string>;
};

export const DEFAULT_STATIC_CONTENT = {
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
    rationaleTitle: "Why this restriction applies",
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
export const staticContent = TEMPLATE.staticContent || DEFAULT_STATIC_CONTENT;

export const UG_GRADE_BANDS = [
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

export const PGT_GRADE_BANDS = [
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

export const gradeBandsFor = (scheme?: string) =>
  scheme === "PGT" ? PGT_GRADE_BANDS : UG_GRADE_BANDS;

export const ACADEMIC_YEAR_OPTIONS = ["2025-2026", "2026-2027", "2027-2028"];

// Approval runs setter -> checker -> cluster lead, in that order.
export const WORKFLOW_STAGES = [
  { id: "checker", label: "Checker", shortLabel: "Checker" },
  { id: "cluster_lead", label: "Cluster lead", shortLabel: "Cluster lead" },
] as const;

export const formatDateOnly = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

export const formatDateTime = (dateString?: string, description?: string) => {
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

export const normaliseLoadedFormData = (
  saved: unknown,
  defaults: Record<string, unknown>,
) => {
  const source =
    typeof saved === "object" && saved !== null
      ? (saved as Record<string, unknown>)
      : {};
  const merged = { ...defaults, ...source };

  if (!source.checkedBy && typeof source.setBy === "string") {
    const [setBy, ...checkedByParts] = source.setBy.split(" / ");
    if (checkedByParts.length > 0) {
      merged.setBy = setBy.trim();
      merged.checkedBy = checkedByParts.join(" / ").trim();
    }
  }

  if (!source.submissionDate && Array.isArray(source.submissionDates)) {
    const firstSubmission = source.submissionDates[0];
    if (typeof firstSubmission === "object" && firstSubmission !== null) {
      merged.submissionDate = String(
        (firstSubmission as Record<string, unknown>).date || "",
      );
    }
  }

  if (!source.returnDate && typeof source.returnOfFeedback === "string") {
    const parsedReturnDate = new Date(source.returnOfFeedback);
    if (!Number.isNaN(parsedReturnDate.getTime())) {
      merged.returnDate = parsedReturnDate.toISOString().slice(0, 10);
    }
  }

  delete merged.submissionDates;
  delete merged.returnOfFeedback;

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

export const getDefaultState = () => {
  const data: Record<string, any> = {
    assessmentType: "Prompt Portfolio",
    gradingScheme: "UG",
    coTaughtWeightingsEnabled: false,
    coTaughtModules: [] as CoTaughtModule[],
    groupWorkPermitted: "No",
    groupSize: TEMPLATE.groupWorkDefault.size,
    groupMechanics: TEMPLATE.groupWorkDefault.mechanics,
    programme: "Computing Science BSc",
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

// The browser will not repeat a fixed watermark across fragmented print pages,
// so the document renders one absolutely positioned watermark per A4 page. That
// needs a page count, which only the laid-out DOM can give us: walk the
// document's children and accumulate their heights against the printable area.
export type BriefDocumentData = {
  formData: Record<string, any>;
  sectionToggles: Record<string, boolean>;
  selectedSkills: string[];
  rubricRows: RubricRow[];
  uploadedImages: Record<string, string>;
};

// A saved brief stores only what the setter touched, so it has to be merged
// over the same defaults the builder starts from — otherwise a brief saved
// before a template field existed renders blank where its owner sees text.
export const briefDocumentDataFromContent = (
  content: Json,
): BriefDocumentData => {
  const defaults = getDefaultState();

  // Older rows double-encoded the JSON, so unwrap up to twice.
  let parsed: unknown = content;
  for (
    let attempt = 0;
    attempt < 2 && typeof parsed === "string";
    attempt += 1
  ) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  const saved = (
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : {}
  ) as SavedBriefContent;

  return {
    formData: normaliseLoadedFormData(saved.formData, defaults.formData),
    sectionToggles: {
      ...defaults.sectionToggles,
      ...(saved.sectionToggles || {}),
    },
    selectedSkills: saved.selectedSkills || defaults.selectedSkills,
    rubricRows: (saved.rubricRows?.length
      ? saved.rubricRows
      : defaults.rubricRows) as RubricRow[],
    uploadedImages: saved.uploadedImages || defaults.uploadedImages,
  };
};

export const measurePrintPageCount = (page: HTMLElement | null) => {
  if (!page) return 1;

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

  return Math.max(1, pageCount);
};

export const MarkdownRenderer = ({
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

const renderPdfRubricTable = (
rows: RubricRow[],
bands: typeof UG_GRADE_BANDS,
) => (
  <table className="corporate-rubric-table table-fixed w-full text-left border-collapse border border-black text-[8pt] leading-tight mt-4 break-words">
    <thead className="break-inside-avoid print:break-inside-avoid">
      <tr className="print-bg-gray bg-gray-100 text-center border-b-2 border-black font-bold">
        <th className="border-r border-black p-1.5 w-[14%]">Component</th>
        <th className="border-r border-black p-1.5 w-[7%] text-[7pt]">
          Weight
        </th>
        {bands.map((band, bandIndex) => (
          <th
            key={band.key}
            className={`p-1.5 ${
              bandIndex < bands.length - 1 ? "border-r border-black" : ""
            }`}
          >
            {band.label} ({band.range})
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
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
          {bands.map((band, bandIndex) => (
            <td
              key={band.key}
              className={`p-1.5 break-words ${
                bandIndex < bands.length - 1 ? "border-r border-black" : ""
              }`}
            >
              {row[band.key]}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

export type BriefDocumentProps = {
  formData: Record<string, any>;
  sectionToggles: Record<string, boolean>;
  selectedSkills: string[];
  rubricRows: RubricRow[];
  uploadedImages: Record<string, string>;
  /** Review stages, for the approval block printed on a final export. */
  reviewStatuses: ReviewStatusRow[];
  /** False renders the DRAFT watermark and suppresses the approval block. */
  isApproved: boolean;
  /** How many A4 pages to stamp with a watermark; see measurePrintPageCount. */
  printPageCount: number;
  version?: number;
  /** On-screen preview scale as a percentage; print always renders at 100. */
  zoom?: number;
  pageRef?: RefObject<HTMLDivElement | null>;
};

export function BriefDocument({
  formData,
  sectionToggles,
  selectedSkills,
  rubricRows,
  uploadedImages,
  reviewStatuses,
  isApproved,
  printPageCount,
  version,
  zoom = 100,
  pageRef,
}: BriefDocumentProps) {
  const gradeBands = gradeBandsFor(formData.gradingScheme);
  const coTaughtModules = (formData.coTaughtModules || []) as CoTaughtModule[];
  const activeCoTaughtModules = formData.coTaughtWeightingsEnabled
    ? coTaughtModules
    : [];
  const coTaughtMarkingSchemes = activeCoTaughtModules.filter(
    (item) =>
      item.markingSchemeEnabled && String(item.markingScheme || "").trim(),
  );
  const coTaughtGradingMatrices = activeCoTaughtModules.filter(
    (item) => item.gradingMatrixEnabled && (item.rubricRows || []).length > 0,
  );
  const aiRestrictionRationale = String(
    (formData.aiPolicy === "RED"
      ? formData.aiRedRationale
      : formData.aiAmberRationale) || "",
  ).trim();

  return (

    <div
      ref={pageRef}
      className="pdf-page corporate-document relative box-border bg-white text-black shrink-0 w-[210mm] min-h-[297mm] p-[20mm] shadow-[0_25px_60px_rgba(0,0,0,0.45)] print:w-[210mm] print:min-h-auto print:m-0 print:shadow-none print:block"
      style={{
        transform: `scale(${zoom / 100})`,
        transformOrigin: "top left",
      }}
    >
      {!isApproved && (
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
                    : field.type === "datetime-local"
                      ? formatDateTime(formData[field.id] as string)
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
        </tbody>
      </table>

      {/* Dynamic Content Sections Mapping */}
      {TEMPLATE.pdfGroupOrder.map((groupTitle) => {
        const sectionsInGroup = TEMPLATE.contentSections.filter(
          (s) => s.pdfGroup === groupTitle,
        );
        const isEmployability = groupTitle === "Employability Skills";
        const isTaskSpec = groupTitle === "Task Specification";
        const isEvalGroup = groupTitle === "Evaluation & Grading";

        const hasVisibleDynamic = sectionsInGroup.some(
          (s) => sectionToggles[s.id] && formData[s.id],
        );
        const hasSkills =
          isEmployability && selectedSkills.length > 0;
        const hasGroupWork =
          isTaskSpec && formData.groupWorkPermitted === "Yes";
        const hasGradingMatrix =
          isEvalGroup &&
          sectionToggles.gradingMatrix &&
          rubricRows.length > 0;
        const hasModuleOverrides =
          isEvalGroup &&
          (coTaughtMarkingSchemes.length > 0 ||
            (sectionToggles.gradingMatrix &&
              coTaughtGradingMatrices.length > 0));

        if (
          !hasVisibleDynamic &&
          !hasSkills &&
          !hasGroupWork &&
          !hasGradingMatrix &&
          !hasModuleOverrides
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

            {isEmployability && hasSkills && (
              <div className="space-y-4 text-[11pt]">
                {(["Technical", "Transferable"] as const).map(
                  (category) => {
                    const skills = SKILLS_LIST.filter(
                      (skill) =>
                        skill.category === category &&
                        selectedSkills.includes(skill.name),
                    );
                    if (skills.length === 0) return null;
                    return (
                      <div key={category}>
                        <h4 className="mb-1 font-bold">
                          {category} Skills
                        </h4>
                        <p>
                          {skills
                            .map((skill) => skill.name)
                            .join(", ")}
                        </p>
                      </div>
                    );
                  },
                )}
              </div>
            )}

            {/* Special Injection for Grading Matrix at end of Evaluation block */}
            {hasGradingMatrix &&
              renderPdfRubricTable(rubricRows, gradeBands)}

            {/* Per-module marking schemes and grading matrices */}
            {isEvalGroup &&
              activeCoTaughtModules.map((item, index) => {
                const moduleMarkingScheme =
                  item.markingSchemeEnabled &&
                  String(item.markingScheme || "").trim()
                    ? String(item.markingScheme)
                    : "";
                const moduleRubricRows =
                  sectionToggles.gradingMatrix &&
                  item.gradingMatrixEnabled
                    ? item.rubricRows || []
                    : [];

                if (!moduleMarkingScheme && moduleRubricRows.length === 0)
                  return null;

                const moduleLabel =
                  item.module || `Co-taught module ${index + 1}`;

                return (
                  <div
                    key={item.id}
                    className="mt-6 break-inside-avoid print:break-inside-avoid"
                  >
                    <h4 className="font-bold mt-5 mb-2 print:break-after-avoid">
                      {moduleLabel}
                      {item.weighting ? ` — ${item.weighting}` : ""}
                    </h4>
                    {moduleMarkingScheme && (
                      <MarkdownRenderer
                        content={moduleMarkingScheme}
                        images={uploadedImages}
                      />
                    )}
                    {moduleRubricRows.length > 0 &&
                      renderPdfRubricTable(
                        moduleRubricRows,
                        gradeBandsFor(
                          item.gradingScheme ||
                            String(formData.gradingScheme || "UG"),
                        ),
                      )}
                  </div>
                );
              })}
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
                {aiRestrictionRationale && (
                  <p className="mt-3">
                    <strong>{staticContent.aiPolicy.rationaleTitle}:</strong>{" "}
                    {aiRestrictionRationale}
                  </p>
                )}
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
                {aiRestrictionRationale && (
                  <p className="mb-3">
                    <strong>{staticContent.aiPolicy.rationaleTitle}:</strong>{" "}
                    {aiRestrictionRationale}
                  </p>
                )}
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

      {/* Approval record. Only on a final export — a watermarked
          draft has nothing approved to attest to. */}
      {isApproved && reviewStatuses.length > 0 && (
        <div className="mt-8 border border-black p-4 text-[10pt] break-inside-avoid print:break-inside-avoid">
          <h3 className="font-bold uppercase tracking-wide text-[12pt] mb-2">
            Approval
          </h3>
          <p className="mb-3">
            Signed off at version {version} of
            this brief.
          </p>
          {WORKFLOW_STAGES.map((stage) => {
            const review = reviewStatuses.find(
              (item) => item.stage === stage.id,
            );
            if (!review) return null;
            const when = review.reviewed_at
              ? formatDateOnly(review.reviewed_at)
              : "date not recorded";
            return (
              <div key={stage.id} className="mb-2 last:mb-0">
                <strong>{stage.label}:</strong>{" "}
                {review.overridden_by
                  ? `Authorised by administrator override — ${
                      review.overridden_by_name || "administrator"
                    }, ${when}`
                  : `${review.reviewer_name || "Reviewer"}, ${when}`}
                {review.overridden_by && review.comment && (
                  <div className="italic">
                    Reason: {review.comment}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
