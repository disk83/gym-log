# Gym Log — MVP spec

Personal gym logging app for one user, used on an iPhone 17 in Safari. It is a proof of concept. Priorities: fast to use between sets, works with no signal, data stays on the phone.

## 1. Decisions (final for the MVP)

- Single user, no login, no backend. All data is local on the phone.
- PWA installed with "Add to Home Screen", served over HTTPS from GitHub Pages.
- Storage: IndexedDB through Dexie. There is no Notion integration and no sync.
- UI in English. Numbers are typed by hand, with no +/- buttons.
- Gym exercises only. No cardio or stretching.
- One log per exercise per session, with a uniform number of sets and reps. No per-set values.
- No timer, no skipping, no RPE, no muscle groups, no images, no progression suggestions, no import from Notion.
- "Next routine" is only a suggestion, never enforced.
- Stack: TypeScript, React, Vite, Dexie, vite-plugin-pwa, SheetJS (xlsx export).

## 2. Data model

All ids are UUID strings. Dates are ISO strings.

**Exercise**
- `name`
- `machine` (optional text)
- `remarks` (free text, e.g. suggested ranges "3-4 x 8-10")
- `type`: `strength` or `timed`
- `loadType`: `total`, `per_dumbbell` or `bodyweight`
- `defaultSets`, `defaultReps` (reps for strength, seconds for timed), `defaultWeight` (optional)
- `archived` (boolean)

**Routine**: `name`, `remarks`, `exerciseIds` (ordered list).

**Cycle**: `name`, `remarks`, `routineIds` (ordered list), `active` (boolean). Exactly one cycle can be active.

**Session**: `startedAt`, `finishedAt` (null while open), `routineId` (null for a free session), `cycleId`.

**Log**: `sessionId`, `exerciseId`, `sets`, `repsOrSeconds`, `weight` (optional), `remarks`, `loggedAt`.

Rules:
- An exercise can appear in several routines, and a routine in several cycles.
- Deleting an exercise, routine or cycle that has history archives it instead. History keeps pointing to it.
- Renaming or editing an exercise never changes past logs.

## 3. Behaviour rules

**Suggested next routine**
- Find the most recent finished session whose routine belongs to the active cycle. The suggestion is the routine after it in the cycle, wrapping from the last to the first.
- If there is no such session, suggest the first routine of the active cycle.
- Nothing is stored for this. It is always derived from history, so it cannot drift.

**Starting a session**
- The home screen shows the suggested routine and a "Start session" button.
- The user can pick any other routine or "No routine" (a free session) before starting.
- Only one open session can exist at a time. If one is open when the app launches, the home screen shows "Resume" and "Discard" instead.

**During a session**
- The routine's exercises are shown in the suggested order, with a marker on the next one (the first not yet logged). Any exercise can be opened in any order.
- The user can add an exercise that is not in the routine, either from the exercise list or by creating a new one on the spot.
- Exercise screen:
  - Fields: sets, reps or seconds, weight (only if the load type is not bodyweight, or optional), and remarks.
  - Prefill: the values of the most recent log of this exercise, from any routine or session. If there is none, use the exercise defaults.
  - "Last time" is always shown on screen: date, sets × reps @ weight, remarks.
  - All fields are editable before saving. Saving writes to the local database straight away.
- Re-opening an already logged exercise in the same session edits that log.

**Finishing a session**
- "Finish" sets `finishedAt`.
- The end screen shows "Routine complete, next: <routine name>" if every exercise of the routine was logged, or "Session finished, next suggested: <routine name>" if not.

**Editing history**
- Past sessions and logs can be edited and deleted.
- Deleting a session deletes its logs, after a confirmation.

## 4. Screens

1. **Home**: suggested routine, "Start session" or "Resume", last session summary.
2. **Session**: routine exercise list, next marker, add exercise, "Finish".
3. **Exercise log**: fields, last time, save.
4. **History**: sessions by date, with session detail and edit.
5. **Manage**: lists with create, edit and archive for exercises, routines (ordered exercises, drag to reorder) and cycles (ordered routines, set active).
6. **Report and backup**: date range picker, "Generate Excel" and "Share" (section 5), "Generate progress PDF" (section 5b), "Export backup", "Import backup".

## 5. Trainer report

- Choose a start and end date. The report includes all logs of sessions started in that range.
- Output: a single `.xlsx` file, one row per log, sorted by date.
- Columns: Date, Session, Routine, Exercise, Machine, Sets, Reps or seconds, Weight, Load type, Remarks.
- Sharing: use the Web Share API with the file (iOS share sheet). If it is not available or fails, fall back to a normal download.

## 5b. Progress report (PDF)

A readable companion to the Excel report, which stays as it is (full detail, one row per log). One button builds a single PDF with a cover page and one page per exercise, so anyone can see at a glance how training is going.

**Trigger**
- On the Report screen, below the Excel button: "Generate progress PDF". It uses the same date range picker, plus shortcuts "3 months", "6 months" and "All".
- Shows progress while building ("Page 3 of 18"). It runs entirely on the phone, offline, from local data.
- Output is shared with `shareOrDownload` (same as the Excel report), MIME `application/pdf`, file name `gym-progress_<start>_<end>.pdf`.
- If there are no logs in the range, show a message and create no file.

**Which exercises, in what order**
- Every exercise with at least one log in the range, archived ones included.
- Order: follow the active cycle (routines in order, exercises in each routine's order, first appearance wins). Exercises not in the active cycle go at the end, alphabetically.

**Cover page**
- Title, date range, generation date.
- Totals: finished sessions in the range, exercises with data, and how many are rising, flat, stalled or falling (using `trendOf` from `progress.ts`).
- A table with one row per exercise: name, latest value, trend arrow, so the cover works as an index.

**Exercise page** (one per exercise, always one page)
- Header: name, machine, type and load type (so "20 kg" is clearly per dumbbell or total), the routines it belongs to, remarks.
- Key numbers: sessions in range, first and latest date, first to latest weight with the change, best weight, best progress value (estimated 1RM for strength, reps for bodyweight, seconds for timed; same definitions as `progress.ts`), and the trend in words (e.g. "Stalled for 4 sessions").
- Chart: the full range, not only the last 8 sessions. One point per session. Strength exercises with weight draw weight and estimated 1RM as two lines with a legend. Other exercises draw their single progress value. Axes use `niceScale` and `labelIndices`, with the value printed at each point. Drawn as vector graphics.
- Table of the last 8 sessions: date, sets × reps or seconds, weight, estimated 1RM, remarks.
- An exercise with a single session in the range still gets a page, with one point and the trend shown as "Not enough data".

**Implementation rules**
- Data model in `src/progressReport.ts`, a pure function over the same inputs as `buildReport`, reusing `progress.ts` so the PDF and the in-app chart always agree. Unit-tested.
- PDF writing in `src/pdf.ts`, a minimal writer with no new dependency (like `xlsx.ts`): A4 portrait, built-in Helvetica, lines, rectangles and text. Characters outside the standard Latin set are replaced by "?". If this proves too limiting, fall back to jsPDF.
- Nothing is stored. The PDF is always generated from history.

## 6. Backup

- "Export backup" downloads or shares one JSON file with all tables and a version number.
- "Import backup" replaces all data after a clear confirmation. Reject files with an unknown version.
- Store the date of the last export. Show a banner on the home screen if it is older than 30 days.
- On first run, request persistent storage with `navigator.storage.persist()`.

## 7. PWA and hosting

- Web app manifest with standalone display, app name and icons. Service worker that caches the whole app for offline use.
- Repo: `disk83/gym-log`, public (code only, no data). Deploy with GitHub Pages through a GitHub Actions workflow. Set the Vite `base` to `/gym-log/`.
- Keep the address stable. IndexedDB belongs to the origin, so a new domain starts empty (the answer is export, then import).
- The installed home-screen app and Safari tabs have separate storage. Always open the app from the home-screen icon.

## 8. Build order

1. Project setup, PWA basics, Dexie schema.
2. Manage screens: exercises, routines, cycles.
3. Session flow: home, start, log, finish, next-routine suggestion.
4. History and editing.
5. Report (xlsx), progress report (PDF) and backup (JSON).
6. Deploy to GitHub Pages, install on the iPhone, test at the gym, fix what shows up.

## 9. Acceptance checks

- With airplane mode on, the whole app works: start a session, log exercises, finish.
- After closing and reopening the app, data and any open session are still there.
- Logging an exercise a second time prefills the previous values and shows "last time".
- Finishing the last routine of the cycle suggests the first routine again.
- The Excel report for a date range opens in Excel and Numbers with the right rows.
- The progress PDF for a date range opens in the iOS file viewer with one cover page plus one page per exercise that has logs, in cycle order.
- The numbers and trend on each PDF page match the in-app progress chart for the same exercise.
- The PDF generates in airplane mode, and in a few seconds for about 30 exercises over 6 months.
- Export backup, wipe, import backup: everything is restored.

## 10. Later (not in the MVP)

Per-set values, supersets and circuits, skipping exercises, rest timer, per-routine targets, rep and set ranges as fields, progression suggestions, muscle groups and muscle images, RPE, Notion export, Notion import of history, sync across devices, cardio and stretching.

## 11. Assumptions to check

- Exercises have a `loadType` so the trainer knows whether 20 kg means per dumbbell or total.
- One log per exercise per session.
- A free session (no routine) does not move the suggestion forward.
- Archiving instead of deleting when history exists.
