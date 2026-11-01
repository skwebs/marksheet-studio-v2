# Marksheet Studio V2 — Class workflow additions

Base project: `marksheet-studio-v2-issue-date-picker.zip` (latest available project archive in this conversation).

## Added
- Persisted `Allowed multiple class import` setting; default is unchecked.
- Multi-class student/result imports are blocked by default and require explicit confirmation when enabled.
- Class/session-specific IndexedDB workspaces with a workspace selector.
- File class/session values take priority; missing values fall back to the active workspace.
- Excel header-row detection supports introductory title/blank rows.
- Student identity collision checks use session + class + roll.
- Class/session identity fields are locked while student records exist.
- Reset Marks: verified pre-reset ZIP, then clears exam result arrays only.
- Reset Students: verified pre-reset ZIP, then clears student records, results and embedded attendance.
- Promotion ZIP (`promote_` prefix) with destination class/session, new roll numbers, student details and photos; previous marks and attendance values are excluded.
- Promotion ranking: final marks descending, attendance percentage descending, previous roll ascending.
- ZIP generation reopens the archive and verifies required files and student count before download.

## Preserved
- Existing templates, marksheet rendering, QR generation, issue-date settings, signature settings, exam configuration, grading, student photo cropper and existing UI sections were not intentionally redesigned.

## Verification
- ZIP integrity checked.
- TypeScript parser/type pass could not be fully verified because dependency installation timed out in this environment. `tsc` reported missing installed packages (`react`, `dexie`, `jszip`, `xlsx`, etc.); no additional syntax/type diagnostics remained after filtering those missing-dependency cascades.
- Run `npm ci` and `npm run build` locally before using with production student data.


## Weightage calculation correction (2026-10-31)

### Corrected
- Every selected examination is converted independently using `(actual marks / actual maximum marks) * configured weightage`, including single-exam reports.
- Report-card tables, subject totals, grand totals, percentages, grades, remarks, performance charts and QR summaries now use converted weightage values rather than raw marks.
- Missing/blank marks are excluded from both obtained weightage and available maximum weightage. An explicitly entered zero remains a valid mark and contributes its configured maximum weightage.
- Per-exam contributions are rounded to the configured marks precision before summing, so the visible exam contributions reconcile with the displayed total.
- Totals show obtained weightage against the available weightage when some exam marks are missing.
- Report labels now identify weightage rather than raw marks.

### Scope preserved
- No changes were made to student imports, exam configuration, promotion, backup/restore, reset workflows, IndexedDB schema, school settings, photo cropping, signatures, issue-date handling or the existing marksheet layout structure.

### Verification
- TypeScript transpilation/syntax check passed for `src/templateRenderer.ts`.
- Full `npm run build` could not be completed in this environment because npm registry DNS resolution failed (`EAI_AGAIN registry.npmjs.org`) while installing the ZIP's existing dependencies. Run `npm ci` and `npm run build` locally before production use.

## Remaining workflow implementation (2026-10-31)

Source archive: `marksheet-studio-v2-weightage-calculation-fix(1).zip` (the user-provided archive for this implementation). Existing HTML marksheet templates and visual layout were preserved.

### Examination configuration
- Added six-exam, four-exam, two-exam and custom examination structures.
- Added custom examination creation, deletion, renaming, short names, raw maximum marks, weightage contribution and display-order controls.
- Switching presets retains stored marks/configuration for examinations that are temporarily inactive; removed built-in exams can be restored by selecting a standard preset.
- Result import and sample files resolve configurable exam names/short names, including custom exams.

### Centralized results and promotion
- Added `src/calculations.ts` as the shared calculation layer for per-exam weightage conversion, subject totals, percentages, promotion scores and readiness checks.
- Added configurable promotion examination selection. Promotion ranking uses converted weightage percentage, obtained weightage, attendance percentage and previous roll as tie-breakers.
- Added promotion preview with all students selected by default, individual selection, select-all/indeterminate state, destination class/session and selected-student ZIP generation.
- Promotion packages assign new rolls in ranked order and exclude examination marks and attendance values.

### Data readiness and validation
- Added Required / Recommended / Optional rules for student fields and examination marks.
- Required missing data blocks marksheet preview/printing; recommended missing data requires confirmation; optional data does not block output.
- Added a class-level readiness summary.

### Backup, restore and reset
- ZIP backups now include both multi-exam and single-exam HTML templates, all examination configuration, validation/promotion settings and existing image assets.
- Restore now previews class/session, student/exam/subject counts, included templates and workspace conflicts before applying data. A matching workspace is replaced only after confirmation; other workspaces remain.
- Reset Marks and Reset Students continue to require a verified pre-reset ZIP and explicit confirmation; resets now clear data across active and inactive exam keys.

### Verification
- TypeScript syntax/transpilation checks passed for all source TypeScript files.
- Strict type checks passed for the data, calculation, backup and renderer modules. A whole-project check using temporary ambient dependency stubs reported no source type errors.
- Runtime tests passed for weightage conversion, missing-versus-zero handling, custom exam normalization, readiness validation, promotion ranking, selected-student promotion, and exclusion of marks/attendance from promotion data.
- `npm ci` timed out in this environment because dependencies could not be installed. Therefore the full Vite production build has **not** been verified here. Run `npm ci` followed by `npm run build` locally before using the updated archive with live student data.


## Phase 1 — Marksheet design refresh (2026-11-01)

### Design updates
- Adopted the supplied `nps-multi-exam-ms-typed(1).html` as the visual reference for both existing marksheet templates.
- Added a three-column school metadata strip with independently configurable labels, values and visibility. Existing Established, Affiliation and Registration Number profile values are reused dynamically.
- Kept the two-logo school banner and school name/address lines; added a configurable third management/foundation line with show/hide control.
- Moved examination title and academic session into a separate strip below the school banner.
- Adopted the reference's light, printer-friendly table, summary, chart, and typewriter typography treatments.
- Applied Courier Prime styling to dynamic marks, summary values and other numeric data.
- Removed hardcoded sample contact details from the printed template.
- Updated print overflow handling to reduce the risk of clipping the bottom border.

### Printed terminology
- Removed user-facing `Weightage` terminology from generated marksheets.
- Printed labels use `Full Marks`, `Obtained Marks`, `Total`, `Percentage`, and `Marks obtained / total marks`.
- Weightage remains internal to calculations and configuration only.

### Preserved
- Existing exam calculation and selection logic, QR payload generation, grading, student information, photos, attendance, remarks, charts, watermark controls, issue date, signature configuration, and backup/restore workflows.
- Promotion ranking and roll assignment were not changed in Phase 1. Added a synchronous re-entry guard to prevent rapid repeated clicks from starting multiple promotion ZIP downloads.

### Verification
- HTML parsing passed for both updated templates.
- TypeScript/TSX syntax transpilation passed for `main.tsx`, `templateRenderer.ts`, `data.ts`, and `types.ts`.
- Full TypeScript project check and Vite production build could not complete because dependencies were unavailable; `npm ci` timed out. Run `npm ci` and `npm run build` locally before production use.


## Follow-up correction — first-row metadata layout

- Removed the extra metadata strip that had been inserted before the original header row.
- Replaced the original first header row in-place with three configurable columns (left, center, right).
- Used three equal-width grid tracks so the center column is centered on the full marksheet width, independent of side content.
- Kept row height content-driven; no fixed/minimum height is reserved for empty metadata. The whole row is hidden when all enabled values are blank.
- Removed fixed label text from the HTML templates and renderer fallbacks. Labels are supplied by the saved school header settings and remain editable in School Profile.
- Applied the same correction to both single-exam and multi-exam templates.


## Phase 2 — Promotion workflow and roll assignment (2026-11-01)

### Promotion roll assignment
- Added **Dynamic** assignment: selected students receive consecutive new roll numbers from 1 in ranking order.
- Added **Static** assignment: new roll numbers retain each student's position in the full-class ranking; unselected students leave gaps.
- Added a live New Roll column to the promotion preview. Unselected students display `—` because they are not included in the promotion package.
- The preview updates immediately when the selection or assignment mode changes.

### Promotion package and traceability
- Promotion ZIP manifest now records the assignment mode and an old-roll → new-roll mapping for every exported student, including student ID, name and full-class rank.
- Promotion README identifies the assignment mode and explains the roll mapping.
- Promotion package continues to exclude previous examination marks and attendance values, while retaining selected student details and photos.

### Duplicate-download protection
- Kept the synchronous UI re-entry guard and added a module-level promotion export lock so concurrent calls cannot trigger another promotion ZIP while one is being generated.
- The download link is removed immediately after its single click, and its object URL is revoked after the browser has had time to begin downloading.

### First-row layout follow-up
- When the center metadata value is blank, the remaining left and right columns now use the full available row width as a two-column layout, eliminating the visually empty center track.
- If only one side value remains, it uses the full row width while preserving its left/right text alignment.
- When the center value exists, it remains centered on the full marksheet width regardless of side content.
- The same behavior is applied to single-exam and multi-exam templates.

### Verification
- TypeScript transpilation/syntax checks passed for `main.tsx`, `backup.ts`, `templateRenderer.ts`, `data.ts` and `types.ts`.
- Promotion logic tests passed for static ranking gaps, dynamic consecutive rolls, removal of prior marks, and reset of attendance.
- Both HTML templates passed parser checks and have unique IDs; each contains exactly one first-row metadata container.
- Full `tsc -b` / Vite production build could not complete because project dependencies are not installed in this environment (`react`, `jszip`, `dexie`, `vite`, etc.). Install dependencies and run `npm ci` followed by `npm run build` locally before production use.


## Single-exam original marks display correction

- Single-exam marksheets now display the configured original maximum marks and original obtained marks (for example, 32 / 40).
- Multi-exam marksheets continue to display converted weightage contributions (for example, 4 / 5).
- The same mode-specific values feed totals, percentages, grades, charts, and QR summaries so the displayed result remains internally consistent.
- The mode is determined by the number of selected report exams; calculation and promotion scoring logic is unchanged.


## Result table display correction

- Multi-exam reports now display the combined column header as `Total (configured combined maximum)` (for example, `Total (50)`).
- Combined total cells and the combined grand-total cell show obtained marks only, not `obtained / maximum` fractions.
- Single-exam reports use the original exam maximum and original obtained marks. The `Full Marks`, `Obtained Marks`, and `Grade` rows are retained in the subject-column layout; full marks remain preprinted even when an individual subject mark is missing.
- Grade cells in the single-exam layout use the same print scaling class as marks cells.
- Multi-exam contribution calculations, grade calculations, and promotion scoring are unchanged.

## Follow-up — result typography and compact score formatting (2026-11-01)

- Multi-exam subject grade values and the overall grade in the Grand Total row now use the same typed-data typography as the other generated result values.
- Removed whitespace around fraction separators in the multi-exam Grand Total row and the Obtained Marks / Attendance summary values (`x/y`, not `x / y`).
- Single-exam Full Marks values now use the pre-printed Lato/static typography instead of the Courier Prime typed-data style. Obtained Marks and Grade remain in the typed-data style.
- No calculation, grading, promotion, import, or persistence logic was changed in this correction.


## Grand Total fraction removal (2026-11-01)

- Removed denominator/fraction display from every exam total cell in the multi-exam Grand Total row. Each cell now displays only the obtained total, matching the regular exam result cells.
- Removed the fraction from the combined Total cell as well; it continues to show obtained marks only.
- Applied the same behavior in the primary TypeScript renderer and both standalone HTML template fallbacks.
- This is a display-only change. Maximum marks remain available in the exam column headers and `Total (maximum)` header; calculations, percentages, grades and QR result calculations are unchanged.


## Global data validation & existing-class configuration permission (2026-11-01)

### Unified field-level validation
- Extended the Required / Recommended / Optional model beyond student details to school identity and header labels, exam metadata, academic configuration, attendance, additional information, and enabled signature blocks.
- Existing per-exam marks completeness remains independently configurable for each active examination.
- Readiness checks now evaluate only report-selected exams for exam names and maximum marks, and only check conditional content when the corresponding marksheet section is enabled.
- Required missing global fields block preview/print; recommended missing fields prompt for confirmation; optional fields do not block or warn.
- The student validation UI continues to use the same three levels. Legacy `requiredStudentFields` and `recommendedStudentFields` arrays are kept synchronized for backward compatibility.
- Older backups without `validationLevels` are migrated from their existing student validation arrays; the new settings are included automatically in ZIP/JSON backups.

### Existing-class configuration permission
- Added **Enable editing for existing classes**, default OFF.
- When the active workspace contains students and the option is OFF, the class-configuration controls in the School Profile panel are disabled, including validation rules, section configuration, exam setup, subjects, grading, marksheet layout, issue date and signature configuration.
- Enabling the option unlocks configuration only. Student records, examination marks and attendance entry remain outside the lock and retain their existing editing workflows.
- The permission is stored per class workspace. Empty/new workspaces remain configurable even while the permission is OFF.
- Automatic remark rule configuration is also protected while attendance data entry remains editable.

### Scope notes
- The current data model does not contain examination-date or student-achievement fields. No fictitious fields were added solely for validation; these can be added to validation once those data features exist.

### Verification
- Strict TypeScript check passed for `types.ts`, `data.ts` and `calculations.ts`.
- TypeScript/TSX syntax transpilation passed for `main.tsx`, `calculations.ts`, `data.ts` and `types.ts`.
- Readiness tests passed for default data, required school data, recommended school data, optional fields, required student data, and migration from legacy validation arrays.
- Confirmed JSX fieldset tags are balanced.
- Full application build remains unverified because project dependencies are not installed and npm cache does not contain the required packages. `npm ci --offline` could not resolve uncached packages. Run `npm ci` and `npm run build` in a network-enabled development environment.


## 2026-11-01 — Exam header ordering and existing-class change permission

### Implemented
- Added selected-exam order numbers to Marksheet Layout. Unselected exams show no order number; selected exams are numbered sequentially.
- Added move-up/move-down controls for the selected marksheet header sequence. The order stored in `marksheetSettings.reportExams` is the exact order used by both renderers.
- Newly selected exams are inserted according to the configured examination order, while existing manually rearranged selections retain their relative order.
- Added a separate `calculationExams` setting for marksheet totals, percentage, subject grades, overall grade, summary and remarks. Hiding a header column no longer removes that examination from calculations. Newly selected display exams are added to calculations by default; hiding them does not remove them from calculations. Calculation inclusion can be changed independently.
- Legacy backups without `calculationExams` migrate by copying their previous `reportExams` selection, preserving prior calculation behavior.
- Added `Allow changing class of existing students` (default OFF), separate from `Enable editing for existing classes`.
- When enabled, a Move class action appears on each existing student row. It moves only the selected student to another class workspace in the same academic session, including the student profile, photo, attendance, remarks and matching examination result rows.
- Previous academic-session workspaces remain unchanged. Destination roll/student-ID conflicts are rejected. The move is persisted across source and destination workspaces in one IndexedDB transaction, with a destination snapshot version check to prevent stale overwrites.
- The active workspace Class/Section/Session identity remains protected; this permission does not unlock the whole workspace class field. Updated the Help guide and row-action tooltip.

### Verification notes
- TypeScript transpilation syntax checks passed for all six modified TypeScript/TSX modules.
- Default configuration and legacy backup migration checks passed.
- Static assertions passed for hidden-column calculation preservation, destination workspace conflict protection and the per-student move action.
- Both marksheet HTML templates parsed successfully with unique IDs.
- ZIP integrity passed after packaging.
- Full Vite production build and browser interaction tests remain unverified because `node_modules` is not installed in this environment.


## Follow-up correction — Active class editing and QR exam type

- Added a separate `allowEditActiveClass` permission, OFF by default, to control the Class field in the left sidebar. This is distinct from class-configuration editing and individual student class transfers.
- When enabled, the active workspace Class field can be edited. Committing the change renames the current class/session workspace while preserving its students, marks, attendance, subjects and settings.
- Workspace rename is transactional and refuses to overwrite an existing destination class/session workspace. The old workspace key is removed only after the destination snapshot is written successfully.
- The `Exam type (shown in QR code)` setting was already used by the single-exam QR renderer; the multi-exam QR renderer previously derived its label from selected exam keys and ignored the setting. It now uses the configured exam type, falling back to the selected exam labels only when the field is blank.
- Legacy data migration defaults the new active-class editing permission to OFF.
- Validation: source-level assertions, TypeScript/TSX transpilation syntax checks and ZIP integrity. Full dependency-backed production build and browser workflow testing remain unverified in this environment.


## Follow-up correction — Conditional active class editing and collapsible settings

### Implemented
- Restored the original conditional class-editing behavior: when the active workspace has no student records, the sidebar Class field is editable by default, regardless of the permission checkbox.
- When student records exist, the sidebar Class field is locked by default. Enabling `Allow editing class when student records exist` unlocks it for that populated workspace.
- The commit handler enforces the same rule as the UI, so a disabled field cannot be bypassed by stale input state. Existing destination-workspace collision protection remains in place.
- Reorganized School Profile settings into native collapsible groups: School identity & header; School images & watermark; Class permissions & import; Student data & validation; Examination configuration; Subjects & grading; Marksheet layout & columns; Issue date & signatures. Groups are collapsed initially and can be expanded independently.
- Updated sidebar helper text and the Help guide to explain the empty/populated class behavior.

### Verification
- TypeScript/TSX transpilation diagnostics: 0.
- Confirmed eight collapsible groups have matching opening/closing tags.
- Confirmed class-field disabled state and commit guard both use `students.length > 0 && !allowEditActiveClass`.
- Both HTML templates parsed successfully.
- Full Vite build and browser interaction testing remain unverified because project dependencies are not installed in this environment.


## Collapsible settings close controls
- Added a visible **Close** control to the header of every expanded School Profile settings group.
- Activating Close collapses only that group; other groups retain their current open/closed state.
- The control is hidden while a group is collapsed and is keyboard-focusable when visible.
