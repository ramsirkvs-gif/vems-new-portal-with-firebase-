# Set up shared saving for VEMS

The updated app uses **Firebase Authentication** for staff sign-in and **Firebase Realtime Database** for shared records. Vercel continues to serve the website. There is no application server to install.

The code changes alone do not configure your Firebase project or update your live Vercel website. Complete the steps below before staff use the updated version. Do not share account passwords, Firebase exports, or student records in chat.

## 1. Back up existing data first

1. Open [Firebase Console](https://console.firebase.google.com/) and select **vems-portal**. Check the project name before making changes.
2. Open **Build → Realtime Database → Data**. Use the database menu to **Export JSON**. Save the file privately. Do not import a replacement over your database.
3. Keep the browser profiles where you previously entered teachers, duty assignments, and question-paper tracking. These older records may exist only in that browser. Do not clear website data or uninstall that browser.
4. Save the old `index.html` or keep its Git commit so you have a copy. Do not restore the old insecure login as a workaround after securing database permissions.

## 2. Turn on proper staff sign-in

1. In the same Firebase project, open **Build → Authentication → Get started** (if shown).
2. Open **Sign-in method → Email/Password**, enable **Email/Password**, and save. You do not need email-link sign-in.
3. Open **Users → Add user**. Create an account using the principal's email and a strong new password. Create separate accounts for other staff who need access.
4. Copy each account's **User UID**. This is the identifier Firebase assigns after you create a user; it is not the email address.
5. Under **Authentication → Settings → Authorized domains**, add `vems-new-portal-with-firebase.vercel.app` if it is absent. Enter just the hostname, without `https://` or `/`.

Old shared passwords no longer unlock the app. Passwords are handled by Firebase Authentication; the app never copies them to the database. Password changes apply to that account on every device. Staff can use the password-reset email button; the administrator can also send a reset from Authentication → Users. Existing sessions may remain signed in until their tokens refresh or the user signs out.

## 3. Give each staff account a role

In **Realtime Database → Data**, add a new child named **roles** at the top level. Under it, add each user's actual UID as the key, and one of these exact strings as the value:

```json
{
  "roles": {
    "PASTE_PRINCIPAL_UID_HERE": "principal",
    "PASTE_SECONDARY_IC_UID_HERE": "sec-ic",
    "PASTE_PRIMARY_IC_UID_HERE": "pri-ic"
  }
}
```

This is an illustration of the new child. **Do not import this whole example over the database root.** Add only the `roles` child and replace the example UIDs. Keep existing `students`, `sectionConfigs`, `archivedExams`, and all other records.

| Role | Access |
| --- | --- |
| `principal` | Read shared staff records; edit students, subjects, teachers, assignments, exams, and tracking |
| `sec-ic` | Read shared staff records; edit exams, question-paper tracking, and deadlines |
| `pri-ic` | Read shared staff records; existing Primary IC workspace remains a placeholder |
| Signed out / no role | Public notice page; no access to staff records |

Only someone with Firebase Console administration access can assign roles. Staff cannot promote themselves using the app. This first version grants approved staff read access to all the shared collections; it does not yet split records by school, session, or primary/secondary section. The public notice board remains a placeholder and does not publish private student or faculty records.

## 4. Deploy the updated files to Vercel

The site now needs three application files together at the same directory level:

```text
index.html
sync-store.js
app-sync.js
```

1. Upload/commit those three files to `main` in **ramsirkvs-gif/vems-new-portal-with-firebase-** using your usual GitHub workflow. Keep `database.rules.json`, `firebase.json`, this guide, and `tests/` in the repository for future maintenance.
2. If Vercel is connected to this branch, it should create a deployment automatically. Check the **Vercel → project → Deployments** page and wait for the new deployment to finish.
3. If automatic deployments are disabled, deploy that updated commit from Vercel.
4. Open the deployed site and reload it. Click **Principal**, then sign in with the email/password created in step 2.
5. Wait for **Live sync connected** before editing. A saved record is confirmed only when the saving status finishes. A red error means the change was not confirmed.

No npm installation or build command is needed for this static site. The included `firebase.json` supports local emulator testing and rules deployment; it does not deploy to Vercel. No deployment or production rules update was performed automatically during this coding task.

## 5. Apply the database permissions

1. Keep the exported database backup from step 1.
2. Open **Realtime Database → Rules**.
3. Open this repository's **[database.rules.json](database.rules.json)** and copy the complete contents.
4. Paste those rules into Firebase's rules editor, then choose **Publish**.

These rules cover this app's known collections and block other client access by default. If another app uses the same database, review its paths before replacing its rules. Publishing rules changes access immediately; coordinate this with deploying the updated app. The old version's browser-only passwords will not satisfy the new rules.

Do not use public `".write": true` or `".read": true` rules for this school database. Never add staff passwords to a database node. The Firebase web configuration already in `index.html` identifies the project; database permissions come from Authentication and Rules.

## 6. Bring across records from each old PC

Do this on the **same website address, same PC, and same browser profile** used for the old app. Browser storage from a local file, a Vercel preview address, another browser, or a different domain is separate.

1. Sign into the updated website as the principal.
2. Open **System & Password Settings → Move records from an older browser**.
3. Click **1. Download old browser data** and keep the JSON file privately.
4. If that browser has old QP submission/printing trackers, select which exam they belong to. The old version did not identify an exam in its tracker keys, so the app cannot safely guess.
5. Click **2. Import missing browser records**, read the confirmation, and wait for **Import confirmed by Firebase**.
6. Existing cloud values are kept. Missing fields/records are added. Conflicting local versions remain in your downloaded backup for manual review. Old passwords are excluded.
7. Repeat for other old PCs that hold unique records. Repeating an import is safe; the originals in browser storage are not deleted. A previously unarchived datesheet draft is imported as a shared draft.

Students and existing archived exams already in Firebase load automatically. Existing exam arrays are read compatibly and saved using stable exam IDs. New tracker entries include the exam ID so two exams do not share each other's submission status. If an earlier custom version wrote unscoped trackers directly to Firebase (rather than browser storage), keep the export and migrate those entries separately after identifying their exam.

## 7. Check using two devices

1. Open the deployed app on PC A and a phone/PC B. Sign in with approved staff accounts on both. Each device needs internet access and **Live sync connected**.
2. On A, add a clearly named test teacher. On B, open Faculty Manager. The teacher should appear without reloading.
3. Change that test teacher on B and confirm A updates. Reload B and confirm the record is still there.
4. Create a test exam on A. Open/edit it on B. Check its datesheet and per-exam submission deadline.
5. Change a submission checkbox and printing status for that exam; check the other device updates. Check that another exam's tracking is separate.
6. Delete only the test records you created, and confirm removal on both devices.
7. Disconnect B from the internet. Its banner should say **Offline** and reject new edits. Reconnect and check it catches up.
8. Try editing the same field from stale forms. One confirmed value should be kept and a conflicting save should show an error. Reopen the latest record before retrying. Different records can save concurrently; datesheet lists/allotment lists are treated as one field, so concurrent changes inside the same list can require reopening and retrying.

Updates propagate over an active Firebase connection, usually within seconds; exact simultaneous display is not guaranteed. A field being typed into is not replaced mid-keystroke; the screen refreshes after focus leaves the input. Keep a page open while **Saving** is displayed. If a connection drops during an in-flight save, reconnect and verify confirmation before closing the page. New offline edits are deliberately blocked to avoid pretending they have been saved.

## If something fails

| Message or symptom | What to check |
| --- | --- |
| Sign-in failed | Correct email/password, correct Firebase project, and Email/Password provider enabled |
| Account has no staff role | Exact user's UID exists under `roles` with one of the strings above |
| Permission denied / could not read role | Rules were published in the correct Realtime Database and UID/role matches |
| Firebase could not load | Browser access to `www.gstatic.com`, then reload |
| Offline | Internet connection, browser blockers, or network/firewall policy |
| New JavaScript file returns 404 | All three app files were included in the same Vercel deployment |
| Old records are missing on a new PC | Import them from the original browser profile; do not clear that profile |
| Another device changed the same field | Reopen the record, review the latest saved value, then reapply your change |

For Codex cloud checks, the environment also needs HTTPS access to `cdn.tailwindcss.com`, `www.gstatic.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, the project Firebase auth domain, the database host and its `*.firebaseio.com` connection hosts, and your Vercel hostname. Database-emulator downloads use `storage.googleapis.com`. Changes to the Codex environment network settings do not change Vercel or your users' internet access.

## Developer checks

Run locally from the repository root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
node --test tests/sync-store.test.js
node tests/browser.test.js
```

The browser tests require Playwright and Chromium. They use two isolated browser contexts and a test-only Firebase contract double; they do not contact the production database or prove deployed Firebase rules. The store tests cover concurrent edits, conflicts, deletion, legacy imports, offline handling, and rejected writes.

For actual Firebase integration, use the Auth and Database emulators with project ID `demo-vems-sync`, plus the Firebase JS SDK and rules-unit-testing package. `firebase emulators:start --only auth,database --project demo-vems-sync` uses the ports in `firebase.json`. Emulator startup requires downloading Google's emulator artifact. Never aim integration tests at the production school database. The browser guide in step 7 is still required after deployment.
