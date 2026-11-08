# Seating publication expiry and next-day reminder

Each published seating plan contains `publicSeatingExpiresAt`, calculated from the last paper's finish time on that date in **Asia/Kolkata (IST, UTC+05:30)**. Student/subject/seating updates regenerate this metadata from the current datesheet. Publication of an already-ended day is blocked.

Public display, selectors and seating PDF context read the expiry-filtered board. Cached publications are filtered too. A monitor checks every 10 seconds and on focus/visibility changes, so an already-open page clears expired seating. Firebase's `.info/serverTimeOffset` adjusts the device clock when available. A legacy plan can use a matching public datesheet; absent complete end times, it expires at the following midnight IST. A connected exam-team session upgrades legacy metadata from its saved datesheet.

The application is static and has no scheduled backend worker. Public clients enforce expiry without staff login. A connected, authorized exam-team client also removes the expired public publication from Firebase, retaining `_seatingExpiredDays` metadata for reminders. It never deletes private `seatingPlans`, seats, attendance or exam archives. Cleanup uses the confirmed public-board and exam records from the shared store, never unsaved UI drafts. It uses the confirmed store baseline, preserves unrelated publications and rejects conflicting updates, including a next-day publication made on another device. It skips offline, pending, unloaded, frozen and inactive sessions and retries later after conflicts.

After an expired publication, signed-in Principal/Exam IC accounts in an editable private workspace see **Please publish Day N Seating Arrangement**. The next date comes from the exam's actual ordered datesheet, skipping already-ended dates and calendar gaps. The prompt appears when the next day is not already public. It provides **Open Day N Seating** and **Remind me in 15 minutes**. Opening only navigates; the Exam IC still reviews, saves and manually presses Publish. No reminder is shown to anonymous visitors, on a frozen vault, or after the final exam day.

Reminder snooze is per user/session/exam/date in local storage with an in-memory fallback. Expiry history is retained in the shared board so another device or a later login can remind the Exam IC after the original expired publication has been removed.

Checks:

```
node --test tests/seating-expiry.test.js tests/workflow-sync.test.js
VEMS_SEATING_EXPIRY_ONLY=1 node tests/browser.test.js
```

The focused browser scenario verifies the real timer clears an anonymous visitor's already-open display, database cleanup reaches a second staff device, internal plans survive, the prompt snoozes and opens the correct day, and publishing remains manual. Browser fixtures use a controlled, advancing clock before their scheduled dates to keep ordinary publication tests independent of the machine date.
