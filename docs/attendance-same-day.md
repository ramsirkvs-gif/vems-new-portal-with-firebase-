# Same-day invigilator attendance corrections

Invigilators can use **Update & Resubmit Attendance** for late arrivals on the scheduled exam date, using the room PIN. The website blocks PIN unlock/submission outside that date using India time. Mock practice retains its separate rehearsal workflow.

## Required Firebase rules deployment

GitHub/Vercel deployment does not publish Firebase Realtime Database rules. Strict server enforcement requires the updated `database.rules.json` in the existing **vems-portal** project.

1. Firebase Console → vems-portal → Realtime Database → Rules. Save a private copy of the current live rules first.
2. Merge the new `examDayAttendanceWindows` branch and the changed `.write` expression under `examDayAttendanceSubmissions/$session/$exam/$date/$room` from this repository. Preserve unrelated live rules if they differ from the repository. Review and publish.
3. In VEMS, the authorised Exam Cell must **Publish with PIN** again for the relevant date. This writes an authorised 24-hour window from 00:00 India time to the next midnight, alongside the existing room PINs. Old publications without a window are intentionally blocked by the new rules until republished.
4. On the exam date, submit with a room PIN, mark a late arrival Present, and use **Update & Resubmit Attendance**. After India midnight, PIN writes must be rejected. Authorised Exam Cell/Principal permissions remain unchanged.

Until rules are deployed, the client date check works but the strict Firebase server cutoff is not active. Existing PIN publication is retained if the old rules reject the new window metadata. No PINs, credentials or student records should be shared to perform this deployment. The automated contract tests are not a live Firebase rules deployment or emulator verification.
