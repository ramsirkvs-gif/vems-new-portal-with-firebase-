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

- Invigilation dropdowns show the selected examination date's TT summary. Selected teachers have all eight periods available beside the assignment, with affected classes and protected free periods.
- Full invigilation uses reporting time through the latest finish time for the day. Relief uses that room's exact entered relief interval. Any partial overlap requires cover; an interval ending at a period's start does not overlap it.
- TT IC is requested to allocate replacement/on-task cover for affected classes, protect free periods within duty windows, and avoid additional arrangements for exam-duty staff for the entire day.
- The TT IC PDF and on-screen report include invigilation, relief, core-team and recorded bundle-collection requests. Other core/collection duties have no entered time interval, so only the whole-day request is shown for those roles.
- Teaching allotments, assigned evaluators and emergency evaluator overrides are matched to actual dated class/section/subject papers. A paper held today produces a request to avoid arrangements on the following **calendar date** for bundle evaluation, even when no examination is held on that date. This is a request, not confirmation of a completed duty or received bundle.
- The report is a working copy of current assignments. Save duties before sharing. Replacement teachers are allocated by TT IC, not automatically by this feature.
- Name matching removes honorifics and punctuation only. Never equate different names using serial numbers. Changed names include source row 36 (`MS. GOCHAM YAGOM`) and 48 (`MS. BAMANG MEHA`). On-task computer-instructor names also differ from some configured portal names. Exam-team users can explicitly link them in the name-links panel; links persist by portal teacher ID, source record ID, source name and workbook hash in `circularSettings._teacherTimetableMatches` with conflict baselines.
- Editing a linked portal name or replacing its source workbook invalidates the previous explicit link until reviewed. Blank selection restores exact-name matching; “keep unlinked” prevents automatic matching.
- No TT report is published to public boards. The bundled source is a static application asset; this feature does not introduce a new private database collection.

Checks:

```
node --test tests/teacher-timetable.test.js tests/holiday-export.test.js tests/qp-arrangement.test.js tests/workflow-sync.test.js tests/offline-attendance.test.js tests/sync-store.test.js
VEMS_TIMETABLE_ONLY=1 node tests/browser.test.js
```

Future timetable updates should replace the source asset from a newly supplied workbook, preserving original cell text and verifying period times with the user. Do not invent class allocations or equate unmatched identities.
