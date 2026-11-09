# Teacher timetable and exam-duty coordination

Source supplied by the user: `Master_Teacher_Timetable_2026-11-08 (3).xlsx`, sheet `Teacher-wise Master TT`.
The normalized asset retains all 58 staff records and 348 Monday–Saturday rows, including the full combined-class notes. Its SHA-256 identifies the source workbook. There are no formula cells in the supplied sheet. This source does not modify the portal's staff roster.

User-supplied default times (IST):

| Period | Start | Finish |
| --- | --- | --- |
| I | 08:20 | 09:00 |
| II | 09:00 | 09:40 |
| III | 09:40 | 10:20 |
| IV | 10:20 | 11:00 |
| V | 11:30 | 12:10 |
| VI | 12:10 | 12:50 |
| VII | 12:50 | 13:30 |
| VIII | 13:30 | 14:10 |

Break: 11:00–11:30. Source is a recurring weekly timetable, not a daily substitution register. No Sunday timetable is supplied. An empty supplied cell is labelled free (blank TT entry); an unlinked teacher or missing day is unknown, never inferred free.

Requested behavior:

- Duty dropdowns show only the TT teaching-period count. Each selected invigilator or reliever has a compact “Today’s TT” tap target with an overlap count or a brief unknown/timing warning. Tapping opens a touch-friendly horizontal Day / I–VIII / Load table outside the assignment columns, with exact period times, subject labels, class-cover highlights and free periods during duty marked. Combined classes can expand to show the original source note. Close, Escape and backdrop dismiss the preview; role/session changes clear it. Background planner refreshes keep it open and refresh its duty markers; removing that teacher from the duty closes it.
- Full invigilation uses reporting time through the latest finish time for the day. Relief uses that room's exact entered relief interval. Any partial overlap requires cover; an interval ending at a period's start does not overlap it.
- TT IC is requested to allocate replacement/on-task cover and protect free periods only within the actual invigilation/relieving window. Partial overlaps show the exact affected minutes; no whole-day exemption is added.
- Revised TT report scope: only assigned invigilators and relievers from occupied rooms. Core-team membership, bundle collection and evaluation-only assignments never create a report entry. A core-team member explicitly assigned invigilation/relief remains listed for that actual timed duty.
- Report dates are actual datesheet dates. The TT report does not add next-day evaluation requests. Existing legacy public copies are filtered in Public View, PDF and sharing to remove core/bundle/evaluation blocks and whole-day recommendations; retained relief-period protection is clipped to its duty window.
- TT reports use a seven-column table: S.No., employee name/designation, duty, exam room, duty time (IST), affected classes/cover, protected free periods. Multiple slots retain the same employee serial and grouped identity. Public/private tables keep employee identity columns fixed while scrolling; landscape PDFs repeat column headers and employee identity on continuation pages. The same published PDF is used for printing and sharing.
- The report is a working copy of current assignments. Save duties before sharing. Replacement teachers are allocated by TT IC, not automatically by this feature.
- Name matching removes honorifics and punctuation only. Never equate different names using serial numbers. Changed names include source row 36 (`MS. GOCHAM YAGOM`) and 48 (`MS. BAMANG MEHA`). On-task computer-instructor names also differ from some configured portal names. Exam-team users can explicitly link them in the name-links panel; links persist by portal teacher ID, source record ID, source name and workbook hash in `circularSettings._teacherTimetableMatches` with conflict baselines.
- Editing a linked portal name or replacing its source workbook invalidates the previous explicit link until reviewed. Blank selection restores exact-name matching; “keep unlinked” prevents automatic matching.
- The report panel now provides Publish / Update Published Copy / Stop Publishing This Date. Confirmed saved sources must match the working report before publication; unsaved duty/evaluator/timetable changes are blocked. Each chosen date is stored as a self-contained snapshot in `publicPortalBoards.ttIcReports.days`; other dates remain when one date is stopped.
- Public View reserves numbered slot 8 immediately after Invigilation and Relieving Duty. It includes date selection, teacher requests, PDF/Print and PDF file sharing to WhatsApp via the device share menu, with download-and-attach fallback. Public rendering and PDFs never read private staff data or name-link controls. Published copies change only after an explicit update.
- Public snapshots contain teacher ID/name/designation and the intended request lines, period timings and source filename, not raw timetable mappings or entire teacher records. The bundled source remains a static application asset; this feature does not introduce a new private database collection.

Checks:

```
node --test tests/teacher-timetable.test.js tests/holiday-export.test.js tests/qp-arrangement.test.js tests/workflow-sync.test.js tests/offline-attendance.test.js tests/sync-store.test.js
VEMS_TIMETABLE_ONLY=1 node tests/browser.test.js
node --test tests/tt-ic-publication.test.js
VEMS_TT_PUBLICATION_ONLY=1 node tests/browser.test.js
```

Future timetable updates should replace the source asset from a newly supplied workbook, preserving original cell text and verifying period times with the user. Do not invent class allocations or equate unmatched identities.
