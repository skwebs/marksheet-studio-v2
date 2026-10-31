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
