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
6. **Report and backup**: date range picker, "Generate Excel" and "Share" (section 5), "Export backup", "Import backup".

## 5. Trainer report

- Choose a start and end date. The report includes all logs of sessions started in that range.
- Output: a single `.xlsx` file, one row per log, sorted by date.
- Columns: Date, Session, Routine, Exercise, Machine, Sets, Reps or seconds, Weight, Load type, Remarks.
- Sharing: use the Web Share API with the file (iOS share sheet). If it is not available or fails, fall back to a normal download.

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
5. Report (xlsx) and backup (JSON).
6. Deploy to GitHub Pages, install on the iPhone, test at the gym, fix what shows up.

## 9. Acceptance checks

- With airplane mode on, the whole app works: start a session, log exercises, finish.
- After closing and reopening the app, data and any open session are still there.
- Logging an exercise a second time prefills the previous values and shows "last time".
- Finishing the last routine of the cycle suggests the first routine again.
- The Excel report for a date range opens in Excel and Numbers with the right rows.
- Export backup, wipe, import backup: everything is restored.

## 10. Later (not in the MVP)

Per-set values, supersets and circuits, skipping exercises, rest timer, per-routine targets, rep and set ranges as fields, progression suggestions, muscle groups and muscle images, RPE, Notion export, Notion import of history, sync across devices, cardio and stretching.

## 11. Assumptions to check

- Exercises have a `loadType` so the trainer knows whether 20 kg means per dumbbell or total.
- One log per exercise per session.
- A free session (no routine) does not move the suggestion forward.
- Archiving instead of deleting when history exists.
