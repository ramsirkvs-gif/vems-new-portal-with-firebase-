# Deployment storage review

The 10 November screenshot shows Vercel deployment storage usage of 7.04 GB
against a displayed 10 GB allowance for the last 30 days. It does not identify
individual projects or deployments, nor establish when the allowance resets,
how retained deployments contribute, or the consequence of reaching the limit.

This exam portal is a static HTML/JavaScript site with approximately 2.2 MB
of tracked files. There is no application build or server dependency bundle.
The `.vercelignore` excludes tests, internal documentation, Firebase deployment
configuration, generated test output, and spreadsheet/video/archive uploads
from future Vercel deployments. It preserves runtime scripts, assets and the
linked Firebase setup guide. Firebase rules remain in Git and can still be
deployed through the Firebase CLI.

## Account-wide review still required

In the Vercel team shown in the screenshot, inspect Usage for each project and
deployment storage for the relevant period. Confirm the metric's current
definition, reset date and plan limit behavior in the dashboard/documentation.
For each project, record its deployment size, deployment frequency, output
directory, preview retention and production retention settings.

Check larger projects first for uploaded videos, spreadsheets, database exports,
generated reports, caches and development dependencies copied into static
output. Exclude only files unused at runtime; retain source and data backups
outside public deployment output. Build scripts still need their build inputs.

Review deployment retention settings to remove obsolete previews automatically
where supported. Preserve current production, a known-good rollback deployment
and anything still serving a required alias. Do not bulk-delete deployments
without confirming their active aliases and rollback requirements. Verify in
Usage whether deletion changes the particular billed usage metric; do not
assume it resets already-recorded usage.

Daily releases can continue subject to the account's actual plan limits. Avoid
duplicate deployments of the same revision, and batch related edits where
practical. A repository-size check cannot certify account-wide capacity.

No Vercel account credentials or project-list access were available for this
review. Account-wide cleanup and resulting usage reduction remain unverified.
