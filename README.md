# Marksheet Studio V2

A separate V2 iteration of the supplied Marksheet Studio React + TypeScript + Vite application. V2 uses a separate IndexedDB database (`marksheet-studio-v2`) so it does not overwrite the V1 browser database.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Build static files with:

```bash
npm run build
npm run preview
```

Deploy the generated `dist/` directory to static hosting.

## V2 changes

- Student IDs are generated internally; users do not need to put Student IDs in the student spreadsheet.
- Student CSV template download uses this simple format by default:
  `Session,Class,Roll,Name,Father,Mother`
- Optional Section support can be enabled in School Profile > Student data settings. When enabled, Section is included in the student template and shown in the class UI/marksheet output. When disabled, Section is omitted from the template and ignored during imports.
- Student import validates required Roll and Name values, duplicate roll numbers, and mixed session/class/section groups before asking for confirmation.
- Student import shows a review summary and preserves internal Student IDs and photos for existing roll matches.
- Student grid supports Tab / Shift+Tab natively, Enter to move down, Shift+Enter and ArrowUp to move up, ArrowDown to move down, and Ctrl+S / Cmd+S to save immediately.
- Local auto-save is debounced at 500 ms and displays editing/saving/saved/failure status.
- Result import has PA-I, PA-II, and Half-Yearly checkboxes. Only selected exams can be changed. If a file contains an `Exam` column, supported values include PA1, PA-I, PA2, PA-II, HY, Half Yearly, and Half-Yearly Examination. Without an Exam column, exactly one exam must be selected.
- Result import validates student rolls, optional session/class/section columns, subject marks, duplicate result rows, and existing result updates. It displays a review summary before committing changes.
- Existing student photo cropping, school logo/watermark, marks entry, attendance/remarks, marksheet preview/print, QR codes, and ZIP/JSON backup workflows are retained from the supplied source.
- Subject lists can be renamed, added, removed, and are saved per class. Subject IDs remain stable when names change.
- Grading rules are user-configurable: grade label, `>=`, `>`, `<=`, `<` operator, percentage threshold, priority order, and add/remove controls.
- Signature footer supports 1–4 configurable blocks, optional names and uploaded signature images, enabled/hidden state, custom labels, and left-to-right ordering. All signature areas use aligned rows for image/name, divider, and designation. Transparent PNG signature assets are stored as data URLs.
- Marksheet settings support selecting report exams, automatic or manual table orientation, Total/Grade visibility, Marks/Grade rows, and overall summary visibility. Automatic layout uses subjects-as-columns for one exam and subjects-as-rows for multiple exams.
- Cropper modal sizing has been tightened for small screens; preview size is constrained independently from the final crop output resolution.

## Supported import examples

### Students

When Sections are disabled:

```csv
Session,Class,Roll,Name,Father,Mother
2026-2027,6,1,Aarav Kumar,Rajesh Kumar,Sunita Devi
2026-2027,6,2,Priya Kumari,Sanjay Kumar,Meena Devi
```

When Sections are enabled:

```csv
Session,Class,Section,Roll,Name,Father,Mother
2026-2027,6,A,1,Aarav Kumar,Rajesh Kumar,Sunita Devi
2026-2027,6,A,2,Priya Kumari,Sanjay Kumar,Meena Devi
```

Import one session/class/section group at a time. If a file contains multiple groups, split it into separate files before import. This version retains the original V1 single-class workspace architecture; multi-class-at-once management is not yet implemented.

### Results

Single-exam file (select exactly one exam checkbox):

```csv
Session,Class,Roll,Hindi,English,Maths
2026-2027,6,1,4,5,4
2026-2027,6,2,5,4,5
```

Multi-exam file (select the exams that may be changed):

```csv
Session,Exam,Class,Roll,Hindi,English,Maths
2026-2027,PA1,6,1,4,5,4
2026-2027,PA2,6,1,5,4,5
```

The file's exam value and the checked exams are both used as safeguards. Rows from unchecked exams are ignored and reported. A selected exam without rows in the file is reported during review.

## Data storage and backups

- Data is stored locally in the browser using IndexedDB; no backend server is required.
- Export ZIP backups regularly. Clearing browser site data may remove local records.
- V2's local database is intentionally separate from V1. To move V1 data into V2, export a V1 ZIP backup and restore it in V2; check the restored data before continuing.

## Known limitations to test

- The underlying marksheet workspace remains single-class-at-a-time. A student import file must contain one session/class/section group.
- Built-in exams remain PA1, PA2, and Half-Yearly. Arbitrary new exam types still require a deliberate data-model/import change.
- Custom grading operators are evaluated in the configured top-to-bottom priority order. Review rule order and coverage before issuing marksheets.
- Dynamic marksheet layouts and signature placement require testing with the school's real template, especially when many subjects or grade bands are configured.
- Imported student matching uses the current class group's roll number. Verify the import review carefully before confirming updates.
- This source package has been updated, but a production build could not be verified in this environment because npm dependency installation timed out. Run `npm install` and `npm run build` locally before relying on it for school records.
