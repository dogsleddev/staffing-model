# Conversation & Session History

This file maintains a running log of our development sessions. Each entry captures the primary objectives, key features implemented, context/roadblocks, and final state of the session for future recall.

---

## Session Date: 2026-04-13

### Primary Objectives
- **Data Fidelity**: Implement "Effective Date" logic to apply changes retroactively or to future dates across all metric-affecting fields.
- **Reporting Architecture**: Build a completely new visual dashboard capable of summarizing Departmental and Fiscal Year constraints.
- **UI & Analytics**: Inject real data-viz charts without adding bloated dependencies or losing the SPA speed.

### Key Features Implemented
1. **Change History Engine & Effective Dates**
   - Ripped out static comp changes and introduced a dynamic, immutable `compensationHistory` array.
   - Any compensation, bill rate, or utilization change can now be scheduled with an "Effective Date".
   - Created a timeline split engine that correctly pro-rates expenses and revenues automatically if a rate takes effect mid-month. 
   - Brought vacation days and bonus fields into the data schema mapping.
2. **Tabbed Reporting Dashboard**
   - Injected a tab structure into the header ("Data Grid" vs "Reporting"), handled via global state toggles to prevent wiping active edits.
   - Built an aggregation engine in `renderReport()` to synthesize Q1-Q4 snapshot cards aggregating Cost, Revenue, and Margin.
   - Department-level rollups were added calculating *Active Headcount*, *Average Utilization Percentage*, and *Annual Net Margin*.
3. **Visual Analytics (Chart.js & Bullet Charts)**
   - Added CDN-linked `Chart.js` rendering a wide "Fiscal Year Trajectory" line chart (burn vs revenue pacing) and an "Economics" margins bar chart grouped by department.
   - Because standard library bullet charts are clunky, we hand-engineered a pure CSS/HTML Bullet Chart to calculate and display target pacing (e.g. Projected Cost vs a theoretical "Budget Target" line).
4. **General QoL (Quality of Life)**
   - Wiped purely decimal visuals (pennies) by rounding to nearest dollar metrics on bill rates and aggregated margins.
   - Added dynamic `<th onclick>` header sorting across the main Grid for alphabetical, chronological, and monetary sorts.
   - Rescaled max-chart ratios (`maxBarThickness: 48`) to cap element stretching on large screen layouts.

### Context & Roadblocks
- **Tab Layout Interference**: Initially experienced an event-bubbling overlay issue where the Reporting tab did not acknowledge clicks properly when executed on the DOM tree. Resolved by stripping constraints and modifying how the HTML block swapped inside `container.innerHTML`.
- **Chart Resizing**: When first rendering the Reporting tab on widescreen resolutions (1600px+), the grouped Department bar charts stretched aggressively. Scaled containers from 240px to 380px fixed the warped aspect ratios instantly.

### Session Outcome
Project is currently sitting at a highly stable Phase 4 feature set. The browser-hosted SPA is fully responsive, interactive, and correctly persists the most granular effective-date splits.

**Next Pipeline Focus**: Preparing integration with actuals (CSV upload overlap logic for the bullet charts) or moving toward Cloud Persistence / Server-side saves (Supabase + Vercel Phase).

---

## Session Date: 2026-04-13 (Phase 5: Cloud Persistence)

### Primary Objectives
- **Cloud Persistence**: Move away from `localStorage` constraints by wiring the application directly into a Supabase PostgreSQL database.
- **Vercel Automation**: Ensure Vercel securely hosts the Supabase credentials and builds correctly mapped API deployments.
- **Workflow Testing**: Allow for easy external user testing by hosting reference dataset CSVs via GitHub and exposing them directly inside the app.

### Key Features Implemented
1. **Supabase Integration & RLS Migration**
   - Configured `staffing_employees` scheme on the live Supabase cloud instance.
   - Wired Row-Level Security (RLS) policies allowing for anonymous browser CRUD operations.
   - Pushed environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Vercel project via the Vercel API.
2. **Clear Dataset Logic**
   - Adjusted the "Clear Dataset" function to successfully wipe both `State` objects AND flush the `staffing_employees` rows in Supabase, preventing ghost data loops upon refresh.
3. **Differential Remote File Loader**
   - Replaced the hardcoded 'Load Sample' javascript dataset with a dynamic dropdown menu (`<select id="sample-dropdown">`).
   - Sourced the dropdown payloads directly from the public GitHub raw URLs (bypassing local file downloads).
   - Hooked the remote loader into the *Differential Upload* engine (`diffCSV`); loading a sample while existing employees are populated now successfully displays the "Import Review" modal instead of destructively overwriting.

### Context & Roadblocks
- **Disabled Billing Tools**: Because the autonomous cost-confirmation tools were disabled, the user manually provisioned the Supabase project in the dashboard and passed the anon keys back manually, which securely bridged the gap.
- **Vercel Deploy Triggering**: The redeploy tool occasionally yields a 404 error through Vercel's REST API endpoint; circumvented smoothly by pushing an empty git commit (`git commit --allow-empty`) to leverage Vercel's native Git integration to fetch the new env variables.

### Session Outcome
Project cleanly graduated to Phase 5. Data changes dynamically stream to Supabase, solving the "data trap" inside a single local machine. The reference datasets exist independently on GitHub, making testing across devices zero-friction.
