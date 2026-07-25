# Playwright UI verification script executed through mcp_browser_automation on 2026-07-25.
# Scope: Reports frequency/date bucketing + Customer Profile admin/client section visibility.
# Key runtime results recorded in /app/test_reports/bug_verification_14.json.
# This file intentionally stores the relevant assertions rather than product code.

# Assertions performed:
# - Logged in as admin via data-testid login selectors.
# - /customer-profile initial admin profile: Customer details and Representative visible;
#   compliance sections hidden except the page still displayed a note containing "Groundwater NOC".
# - Admin edit profile: NOC/CTO/borewell/RWH inputs hidden.
# - Switched picker to Test Client with seeded flowmeter/DWLR: compliance + instruments sections visible.
# - /reports weekly/monthly/quarterly/yearly without both dates: expected toast shown.
# - Seeded flowmeter daily: 24 Jul consumption 500.00, 25 Jul consumption 250.00 using previous-bucket totaliser deltas.
# - Seeded flowmeter weekly/monthly with bounds: 2 period rows with 750.00 and 500.00 consumption.
# - Seeded DWLR daily in Asia/Kolkata timezone: separate 24 July 2026 and 25 July 2026 rows.
