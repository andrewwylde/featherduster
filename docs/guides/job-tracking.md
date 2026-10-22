# Jobs that need work

The `/jobs` page opens on **Needs work**. Saved jobs, active preparation,
questions, recoverable failures, and ready resumes remain here until you record
an application or archive the job. A ready or approved resume does not imply an
application was submitted.

- **Mark applied** records a submission you made elsewhere. It sends nothing.
  Find these jobs under **Applied**; **Mark not applied** corrects a mistake.
- **Archive job** removes a job from the default list without deleting its
  posting, drafts, PDFs, or history. **Restore from archive** reverses this.
  Archiving preserves whether the job was applied to.
- **All** includes retained history, including imported records with unknown
  application status. **Archived** also includes skipped and cancelled work.
- Queued or running preparation must be cancelled before changing tracking.
  Archived jobs are excluded from automatic preparation and review counts.

Tracking changes use revision checks and idempotency receipts. Errors leave the
card in place and display the failure. Changes to tracking are recorded in job
history. The archive timestamp is optional for compatibility with existing jobs.
