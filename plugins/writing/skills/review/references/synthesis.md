# Synthesis

Merge findings from all agents into a single report.

- Deduplicate: when multiple agents flag the same issue, keep the more detailed description
- Group by severity (Blocking > Important > Suggestions), not by agent
- Order by document position within each severity level
- For each finding, include section reference, issue, suggested fix, and which agent(s) flagged it
