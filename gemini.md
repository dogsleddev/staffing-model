# 📜 gemini.md — Project Constitution
> **Law Document** — Update ONLY when: a schema changes, a rule is added, or architecture is modified.

---

## 🗓️ Initialized
- Date: 2026-04-12
- Status: `BLUEPRINT_APPROVED` — Schema defined. Phase 1 complete. Coding UNLOCKED.

---

## 🎯 North Star
> Build a **dynamic, browser-based Staffing Budget Model** that:
> - Ingests an employee dataset (CSV upload or manual entry)
> - Calculates **monthly payroll expenses** per employee across a fiscal year
> - Supports **scenario planning** (salary edits, date changes, type changes)
> - Outputs a clean monthly budget grid that integrates into an overall company budget
> - Exposes a **right-click context menu** on each employee row for inline edits

---

## 📐 Data Schema

### Input Schema — Employee Record
```json
{
  "id": "uuid-string",
  "name": "string",
  "position": "string",
  "department": "string",
  "employeeType": "salary | hourly",
  "annualSalary": "number",      // used when employeeType === 'salary'
  "hourlyRate": "number",        // used when employeeType === 'hourly'
  "hoursPerWeek": "number",      // used when employeeType === 'hourly' (default: 40)
  "startDate": "YYYY-MM-DD",
  "termDate": "YYYY-MM-DD | null",
  "status": "active | termed | planned",
  "billRate": "number",          // hourly client bill rate ($ / hr)
  "utilizationRate": "number",   // 0.0 – 1.0 (e.g., 0.80 = 80% billable)
  "vacationDays": "number | null", // days/year for benefit forecasting
  "bonusAmount": "number | null",  // flat bonus ($) — excluded from expense calcs for now
  "bonusPct": "number | null",     // bonus (% of salary) — excluded from expense calcs for now
  "notes": "string"
}
```

### Output (Payload) Schema — Monthly Expense Grid
```json
{
  "budgetYear": 2026,
  "employees": [
    {
      "id": "uuid",
      "name": "string",
      "position": "string",
      "department": "string",
      "employeeType": "salary | hourly",
      "monthlyExpenses": {
        "2026-01": 5000.00,
        "2026-02": 5000.00,
        "...": "..."
      },
      "annualTotal": 60000.00
    }
  ],
  "summary": {
    "totalHeadcount": 10,
    "totalAnnualBudget": 600000.00,
    "byMonth": {
      "2026-01": 50000.00,
      "...": "..."
    }
  }
}
```

### CSV Upload Format (Expected Headers)
```
name, position, department, employeeType, annualSalary, hourlyRate, hoursPerWeek, startDate, termDate, billRate, utilizationRate, status, notes
```

### Reference Files
- `employee_template.csv` — blank template with correct headers
- `employees_dummy_250.csv` — 250-employee architecture firm dataset for testing

> ✅ **Schema approved by user on 2026-04-12. Coding is UNLOCKED.**

---

## 🔌 Integrations
| Service | Purpose | Status |
|---------|---------|--------|
| CSV File Upload | Ingest employee dataset | ✅ Web native (no API key needed) |
| Browser LocalStorage | Persist model state between sessions | ✅ Web native |
| Supabase | Database backend — persist employees & scenarios | 🔒 Phase 5 |
| Vercel | Hosting & deployment | 🔒 Phase 5 |

## 📱 Platform Requirements
- **Primary**: Desktop browser (wide table grid)
- **Secondary**: Mobile-accessible (touch-friendly modals, scrollable grid)
- Responsive breakpoints required at 640px and 900px

---

## 🧠 Behavioral Rules

1. **Pro-rate first and last months**: If `startDate` is mid-month, only count working days in that month. Same for `termDate`.
2. **Monthly billable revenue**: `billRate × (hoursPerWeek × utilizationRate) × 4.3333`, pro-rated same as expense. For salaried employees, `hoursPerWeek` defaults to 40 unless overridden. Displayed as a separate column alongside monthly expense.
3. **Termed employees = $0 after termDate**: Once `termDate` has passed in a given month, their expense is $0.
4. **Hourly calculation**: `monthlyExpense = hourlyRate × hoursPerWeek × weeksInMonth` (use 4.33 weeks/month average).
5. **Salary calculation**: `monthlyExpense = annualSalary / 12`.
6. **Scenarios are non-destructive**: Edits in the model do NOT overwrite the original uploaded data. Original is preserved for reset.
7. **Interactions & Menus**: Right-click context menu appears on every employee row for edits. Column headers are sortable (click to toggle asc/desc).
8. **No hardcoded data**: All values come from the uploaded dataset or user input. No dummy data in production.
9. **Planned hires**: Employees with `status: "planned"` are visually distinguished but calculated identically.
10. **Change History & Effective Dates**: Every compensation-related field (salary, hourly rate, hours/week, bill rate, utilization, vacation accrual) is tracked in an immutable `compensationHistory` array with an `effectiveDate`. The calculation engine dynamically splits monthly expenses when rates change mid-month.
11. **Financial Display**: Monetary figures in the UI are rounded to the nearest whole dollar (no pennies).

---

## 🏗️ Architectural Invariants
1. LLMs handle reasoning. Deterministic JS functions handle all calculations.
2. All intermediate/temp state goes to `localStorage` or `.tmp/`. Never to root.
3. All secrets (future API keys) live in `.env`. Never hardcoded.
4. If logic changes, update the SOP in `architecture/` BEFORE updating code in `tools/`.
5. A project is only "Complete" when the payload reaches its final cloud destination.
6. The app is a **single-file HTML** artifact for v1. No build step required.

---

## 🔧 Maintenance Log
| Date | Change | Author |
|------|--------|--------|
| 2026-04-12 | Initial constitution created | System Pilot |
| 2026-04-12 | Schema defined from Discovery answers. Status → BLUEPRINT_APPROVED | System Pilot |
| 2026-04-12 | v3.2: Implemented Change History Engine. Added effectiveDate tracking for all comp-related logic. | System Pilot |
| 2026-04-12 | v3.3: Added vacationDays and bonus fields. Clarified effective date scope. UI updates for sorting and integer rounding. | System Pilot |
