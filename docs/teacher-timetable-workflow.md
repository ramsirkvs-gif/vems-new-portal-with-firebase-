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
- TT IC vault, Public View and landscape PDF/print reports use separate Invigilation and Relieving tables with only SN, Name & Designation, and Periods on Exam Duty / On Task. Each employee appears once per duty type; numeric period labels are deduplicated and sorted P-1, P-2, P-3, etc. Times, rooms, lesson text and arrangement explanations are excluded from these tables, including legacy snapshots. Saved snapshots and morning-change history are retained.
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

### TT IC daywise report and morning revisions

The full daywise report includes invigilators and relievers only. Duty starts at the saved reporting time, not the paper start. Missing reporting times or timetable links require review. Partial-period overlaps count. Free periods overlapping duty are protected against other arrangements.

For all sections, Classes X and XII are suspended on 12–13 November 2026; Classes X, XI and XII are suspended on 16–21 November 2026 inclusive. Other classes remain running. Additional explicitly saved class suspensions may be supplied as `exam.ttSuspendedClasses[ISO-date]`, an array of class numbers. Suspended lessons need no replacement; overlapping running lessons need cover. Mixed class entries are separated conservatively; unrecognised entries require review.

Publish the complete TT IC report first to establish a versioned baseline. Older reports without a revision need a fresh complete publication. Under During Exam → invigilation update due to absence, save replacements, then use **TT IC — Morning Changes**. Preview, PDF/Print and WhatsApp export do not advance the baseline. Publishing records a notice with exam/date, revision, issue time and baseline version, and advances the baseline to the confirmed saved assignments. Subsequent notices compare against that latest publication. Earlier notices remain available in the same public TT IC segment. Concurrent revision changes reject the save rather than overwrite a newer baseline.

Outgoing and incoming teachers are both included. Earlier requests for changed teachers are superseded and restated for their revised duties. Only saved faculty absence marks create an absence-cover request; removal alone does not mark a teacher absent. Unchanged staff are omitted. A failed save does not establish a new baseline.

Staff attendance reminders stop exactly one hour after the earliest saved paper start on examination day (not reporting time). Without a valid saved start, no attendance window is invented. Next scheduled day invigilation reminders run from today's final paper end until midnight IST that same day, including when the next scheduled day follows a weekend. They do not carry into intervening days, and already published next-day duty suppresses them. Public invigilation duty hides at its saved duty end, including later relief completion. Missing legacy end times fall back to Indian midnight. Internal duty history and attendance remain saved. Expired duty and completed old PIN publication days do not block the next day's duty; PIN validation and same-day server restrictions are unchanged.
