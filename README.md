# Marksheet Studio V2

A local-first React + TypeScript + Vite application. Student data, marks, settings and class workspaces are stored in the browser using IndexedDB; no backend server is required. V2 uses its own IndexedDB database (`marksheet-studio-v2`) and does not overwrite the V1 browser database.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm ci
npm run dev
```

Build and preview the static application:

```bash
npm run build
npm run preview
```

Deploy the generated `dist/` directory to static hosting.

## Examination configuration

- Select a six-exam, four-exam, two-exam or custom examination structure.
- Custom structures support adding, removing, renaming and reordering exams.
- Each exam has a raw maximum mark and a weightage contribution.
- Reports convert each exam independently using `(obtained marks / raw maximum) × weightage`, then sum the converted contributions.
- Missing marks are excluded from both obtained and available weightage. An explicitly entered zero is a valid mark.
- The marksheet report-exam selection controls which examinations contribute to the annual/combined report.

## Students, imports and workspaces

- Student IDs are generated internally; spreadsheets do not need a Student ID column.
- Student import accepts Roll and Name as required columns. Father, Mother, DOB, Gender, Session, Class and Section are supported.
- Class/session values in the file take priority over the currently selected workspace after mismatch confirmation.
- The `Allowed multiple class import` setting is unchecked by default. When enabled, a multi-class file can be split into separate saved class/session workspaces after confirmation.
- Class/session/section identity is locked while student records exist. Use the reset workflow after creating and saving a backup before starting a different class/session in the active workspace.
- The student grid supports Tab / Shift+Tab, Enter, arrow navigation and Ctrl+S / Cmd+S. Local auto-save is debounced at 500 ms.

## Results and validation

- Result files support one or multiple examinations. With an `Exam` column, exam names and short names are resolved against the configured exam list. Without an `Exam` column, exactly one exam must be selected.
- Import validation checks roll matching, class/session, duplicate result rows, subject values and configured maximum marks.
- Student fields and examination marks can be classified as Required, Recommended or Optional.
- Required missing data blocks marksheet preview/printing. Recommended missing data prompts for confirmation. Optional data does not block output.
- Promotion ranking can use a configurable subset of exams and uses converted weightage, attendance and previous roll as tie-breakers. Promotion preview defaults to all students but supports individual selection and select-all.
- A `promote_` ZIP contains selected student details, photos, destination class/session and newly assigned roll numbers. Previous marks and attendance are excluded.

## Marksheet, attendance and assets

- Existing supplied HTML marksheet templates are retained. ZIP backups include both the multi-exam and single-exam templates.
- Existing school logos, watermark controls, photo cropping, QR generation, grading, remarks, attendance, issue-date and signature settings remain available.
- Marks precision supports integer, one decimal or two decimal places.
- The marksheet report exam selection, table orientation and display options remain configurable.

## Backup and restore

- Export a complete ZIP regularly. It includes the class data, exam configuration, validation and promotion settings, student photos, school image assets and both marksheet templates.
- Restore previews the class/session, student/exam/subject counts, included templates and whether a matching workspace already exists.
- Confirming a restore replaces only the matching class/session workspace; other saved workspaces are retained.
- Reset Marks and Reset Students create a verified pre-reset ZIP and require explicit confirmation before clearing data.
- Browser site-data clearing can remove local IndexedDB records. Keep ZIP backups outside the browser.

## Supported import examples

### Students

```csv
Session,Class,Roll,Name,Father,Mother
2026-2027,6,1,Aarav Kumar,Rajesh Kumar,Sunita Devi
2026-2027,6,2,Priya Kumari,Sanjay Kumar,Meena Devi
```

Add `Section` when Sections are enabled. Gender and DOB are optional unless configured otherwise.

### Results

```csv
Session,Exam,Class,Roll,Hindi,English,Maths
2026-2027,PA-I,6,1,32,35,38
2026-2027,PA-II,6,1,34,36,37
```

Use the configured exam name or short name in the `Exam` column. Download the current sample files from Help & Guides for the active class and examination structure.

## Verification note

Source syntax and targeted calculation/promotion tests were checked for this update. A full Vite production build could not be verified in this environment because `npm ci` timed out while installing dependencies. Run `npm ci` and `npm run build` locally before using the updated package with production student records.
