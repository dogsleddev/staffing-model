# 🔍 findings.md — Research & Discoveries

## Status: `BLUEPRINT_APPROVED — Phase 2 Ready`

---

## 💡 Discovery Answers

| Question | Answer |
|----------|--------|
| North Star | Dynamic staffing budget model: upload employee CSV → monthly payroll grid → scenario planning |
| Integrations | CSV upload (web native). Future: Google Sheets export |
| Source of Truth | User-uploaded CSV file with employee records |
| Delivery Payload | Interactive browser-based monthly expense grid (single HTML file) |
| Behavioral Rules | Pro-rate partial months, $0 after term date, salary ÷12, hourly ×4.33wks, right-click context menu |

---

## 📐 Schema Decisions
- Employee types: `salary` and `hourly`
- Pro-ration: by calendar days in partial months
- Weeks/month constant: `4.3333` (52 weeks ÷ 12)
- Employee statuses: `active`, `termed`, `planned`
- Fiscal year: calendar year 2026 (TBC with user)

---

## 🏗️ Architecture Decision: Single-File HTML
- **Reasoning**: No server needed. Portable. Shareable. Opens in any browser.
- **State**: `localStorage` for persistence between sessions
- **No build step** required for v1

---

## 📚 Research Notes
- CSV parsing: Native `FileReader` API (no library needed)
- Date math: Native `Date` object (no library needed for v1)
- Table virtualization: Not needed for typical staffing lists (<500 rows)
- Rich context menus: Pure CSS + JS (no library needed)

---

## ⚠️ Constraints & Gotchas
- February has 28/29 days — pro-ration must handle this correctly
- Hourly employees with variable hours: v1 uses fixed `hoursPerWeek`
- CSV encoding: Must handle UTF-8 with BOM (common Excel export issue)

---

## 🔗 Useful References
- [MDN FileReader API](https://developer.mozilla.org/en-US/docs/Web/API/FileReader)
- [MDN Date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date)
