---
name: doc-coauthoring
disable-model-invocation: true
description: Guide users through a structured workflow for co-authoring documentation. Use when user wants to write documentation, proposals, technical specs, decision docs, or similar structured content. This workflow helps users efficiently transfer context, refine content through iteration, and verify the doc works for readers. Trigger when user mentions writing docs, creating proposals, drafting specs, or similar documentation tasks.
---

# Doc Co-Authoring Workflow

Act as an active guide, walking users through three stages: Context Gathering, Refinement & Structure, and Reader Testing.

## When to Offer This Workflow

**Trigger conditions:**
- User mentions writing documentation: "write a doc", "draft a proposal", "create a spec", "write up"
- User mentions specific doc types: "PRD", "design doc", "decision doc", "RFC"
- User is starting a substantial writing task

**Initial offer:**
Offer the structured workflow. Explain the three stages:

1. **Context Gathering**: User provides relevant context while Claude asks clarifying questions
2. **Refinement & Structure**: Iteratively build each section through brainstorming and editing
3. **Reader Testing**: Test the doc with a fresh Claude (no context) to catch blind spots before others read it

This helps the doc work when others read it (including when they paste it into Claude). Ask if they want this workflow or prefer freeform.

If user declines, work freeform. If user accepts, proceed to Stage 1.

## Stage 1: Context Gathering

**Goal:** Close the gap between what the user knows and what Claude knows, enabling smart guidance later.

### Initial Questions

Ask the user for meta-context about the document:

1. What type of document is this? (e.g., technical spec, decision doc, proposal)
2. Who's the primary audience?
3. What's the desired impact when someone reads this?
4. Is there a template or specific format to follow?
5. Any other constraints or context to know?

They can answer in shorthand or dump information however works for them.

**If user provides a template or mentions a doc type:**
- Ask if they have a template document to share
- If they provide a link to a shared document, use the appropriate integration to fetch it
- If they provide a file, read it

**If user mentions editing an existing shared document:**
- Use the appropriate integration to read the current state
- Check for images without alt-text
- If images exist without alt-text, explain that when others use Claude to understand the doc, Claude won't see them. Ask if they want alt-text generated. If so, request they paste each image into chat.

### Info Dumping

Once initial questions are answered, encourage the user to dump all their context:
- Background on the project/problem
- Related team discussions or shared documents
- Why alternative solutions aren't being used
- Organizational context (team dynamics, past incidents, politics)
- Timeline pressures or constraints
- Technical architecture or dependencies
- Stakeholder concerns

Tell them not to organize it - get it all out. Offer multiple ways to provide context:
- Info dump stream-of-consciousness
- Point to team channels or threads to read
- Link to shared documents

**If integrations are available** (e.g., Slack, Teams, Google Drive, SharePoint, or other MCP servers), mention these can pull in context directly.

**If no integrations are detected and in Claude.ai or Claude app:** Suggest they enable connectors in Claude settings to pull context from messaging apps and document storage directly.

Tell them clarifying questions come after their initial dump.

**During context gathering:**

- If user mentions team channels or shared documents:
  - If integrations available: Tell them the content will be read now, then use the appropriate integration
  - If integrations not available: Explain lack of access. Suggest they enable connectors in Claude settings, or paste the content directly.

- If user mentions unknown entities/projects:
  - Ask if connected tools should be searched to learn more
  - Wait for user confirmation before searching

- As user provides context, track what's being learned and what's still unclear

**Asking clarifying questions:**

When user signals they've done their initial dump (or after substantial context), ask clarifying questions to confirm understanding:

Generate 5-10 numbered questions based on gaps in the context.

They can use shorthand to answer (e.g., "1: yes, 2: see #channel, 3: no because backwards compat"), link to more docs, point to channels to read, or keep info-dumping. Whatever's most efficient.

**Exit condition:**
Sufficient context exists when questions show understanding - when edge cases and trade-offs can be asked about without needing basics explained.

**Transition:**
Ask if there's more context to provide, or if it's time to draft.

If user wants to add more, let them. When ready, proceed to Stage 2.

## Stage 2: Refinement & Structure

**Goal:** Build the document section by section through brainstorming, curation, and iterative refinement.

**Instructions to user:**
Explain the document is built section by section. For each section:
1. Clarifying questions about what to include
2. 5-20 options brainstormed
3. User indicates what to keep/remove/combine
4. The section is drafted
5. Refined through surgical edits

Start with whichever section has the most unknowns (usually the core decision/proposal), then work through the rest.

**Section ordering:**

If the document structure is clear:
Ask which section to start with.

Suggest the section with the most unknowns. For decision docs, that's usually the core proposal. For specs, the technical approach. Leave summary sections for last.

If user doesn't know what sections they need:
Based on the doc type and template, suggest 3-5 sections.

Ask if this structure works, or if they want to adjust it.

**Once structure is agreed:**

Create the initial document structure with placeholder text for all sections.

**If access to artifacts is available:**
Use `create_file` to create an artifact, giving Claude and the user a scaffold to work from. Use all section headers and brief placeholder text like "[To be written]" or "[Content here]".

Provide the scaffold link and indicate it's time to fill in each section.

**If no access to artifacts:**
Create a markdown file in the working directory, named appropriately (e.g., `decision-doc.md`, `technical-spec.md`), with all section headers and placeholder text.

Confirm the filename and indicate it's time to fill in each section.

**For each section:**

### Clarifying Questions

Announce work on the [SECTION NAME] section. Ask 5-10 clarifying questions about what to include.

### Brainstorming

For the [SECTION NAME] section, brainstorm 5-20 things that might be included, depending on complexity. Look for:
- Context shared that might have been forgotten
- Angles or considerations not yet mentioned

Generate 5-20 numbered options based on complexity. Offer to brainstorm more.

### Curation

Ask which points to keep, remove, or combine. Request brief justifications to learn priorities for the next sections.

Examples:
- "Keep 1,4,7,9"
- "Remove 3 (duplicates 1)"
- "Remove 6 (audience already knows this)"
- "Combine 11 and 12"

**If user gives freeform feedback** (e.g., "looks good" or "I like most of it but...") instead of numbered selections, parse what they want kept/removed/changed and apply it.

### Gap Check

Based on what they selected, ask if anything important is missing for the [SECTION NAME] section.

### Drafting

Use `str_replace` to replace this section's placeholder with the drafted content. Announce the [SECTION NAME] section is being drafted from their selections.

**If using artifacts:**
After drafting, provide a link to the artifact. Ask them to read it and indicate what to change. Being specific helps learning for the next sections.

**If using a file (no artifacts):**
After drafting, confirm the [SECTION NAME] section is drafted in [filename]. Ask them to read it and indicate what to change. Being specific helps learning for the next sections.

**Key instruction for user (include when drafting the first section):**
Instead of editing the doc directly, ask them to indicate what to change. This learns their style for future sections. For example: "Remove the X bullet - already covered by Y" or "Make the third paragraph shorter".

### Iterative Refinement

As user provides feedback:
- Use `str_replace` to make edits (never reprint the whole doc)
- **If using artifacts:** Provide link to artifact after each edit
- **If using files:** Confirm edits are complete
- If user edits the doc directly and asks to read it: note their changes and keep them in mind for future sections (this shows their preferences)

**Continue iterating** until user is satisfied with the section.

### Quality Checking

After 3 consecutive iterations with no substantial changes, ask if anything can be removed without losing important information.

When the section is done, confirm [SECTION NAME] is complete. Ask if ready for the next section.

**Repeat for all sections.**

### Near Completion

At 80%+ of sections done, announce re-reading the entire document to check for:
- Flow and consistency across sections
- Redundancy or contradictions
- Anything that feels like "slop" or generic filler
- Whether every sentence carries weight

Read the entire document and provide feedback.

**When all sections are drafted and refined:**
Announce all sections are drafted and review the complete document once more for coherence, flow, completeness.

Provide any final suggestions.

Ask if ready for Reader Testing, or if they want to refine anything else.

## Stage 3: Reader Testing

**Goal:** Test the document with a fresh Claude (no context bleed) to verify it works for readers.

**Instructions to user:**
Explain that testing checks whether the document works for readers. This catches blind spots - things that make sense to the authors but might confuse others.

### Testing Approach

**If access to sub-agents is available (e.g., in Claude Code):**

Perform the testing directly without user involvement.

### Predict Reader Questions

Announce predicting what questions readers might ask when discovering this document.

Generate 5-10 questions that readers would realistically ask.

### Test with Sub-Agent

Announce testing these questions with a fresh Claude instance (no context from this conversation).

For each question, invoke a sub-agent with just the document content and the question.

Summarize what Reader Claude got right/wrong for each question.

### Run Additional Checks

Invoke a sub-agent to check for ambiguity, false assumptions, contradictions.

Summarize any issues found.

### Report and Fix

If issues found:
Report that Reader Claude struggled, list the specific issues, and announce fixing these gaps.

Loop back to refinement for problematic sections.

---

**If no access to sub-agents (e.g., claude.ai web interface):**

The user does the testing manually.

### Predict Reader Questions

Ask what questions people might ask when discovering this document. What would they type into Claude.ai?

Generate 5-10 questions that readers would realistically ask.

### Setup Testing

Provide testing instructions:
1. Open a fresh Claude conversation: https://claude.ai
2. Paste or share the document content (if using a shared doc platform with connectors enabled, provide the link)
3. Ask Reader Claude the generated questions

For each question, instruct Reader Claude to provide:
- The answer
- Whether anything was ambiguous or unclear
- What knowledge/context the doc assumes is known

Check if Reader Claude gives correct answers or misinterprets anything.

### Additional Checks

Also ask Reader Claude:
- "What in this doc might be ambiguous or unclear to readers?"
- "What knowledge or context does this doc assume readers already have?"
- "Are there any internal contradictions or inconsistencies?"

### Iterate Based on Results

Ask what Reader Claude got wrong or struggled with. Indicate intention to fix those gaps.

Loop back to refinement for any problematic sections.

---

### Exit Condition

When Reader Claude consistently answers questions correctly and doesn't surface new gaps or ambiguities, the doc is ready.

## Final Review

When Reader Testing passes:
Announce the doc has passed Reader Claude testing. Before completion:

1. Recommend they do a final read-through themselves - they own this document and are responsible for its quality
2. Suggest double-checking any facts, links, or technical details
3. Ask them to verify it achieves the impact they wanted

Ask if they want one more review, or if the work is done.

**If user wants final review, provide it. Otherwise:**
Announce document completion. Provide a few final tips:
- Consider linking this conversation in an appendix so readers can see how the doc was developed
- Use appendices to provide depth without bloating the main doc
- Update the doc as feedback is received from real readers

## Tips for Effective Guidance

**Tone:**
- Be direct and procedural
- Explain rationale briefly when it affects user behavior
- Don't try to "sell" the approach - execute it

**Handling Deviations:**
- If user wants to skip a stage: Ask if they want to skip it and write freeform
- If user seems frustrated: Acknowledge this is taking longer than expected. Suggest ways to move faster
- Always give user agency to adjust the process

**Context Management:**
- Throughout, if context is missing on something mentioned, proactively ask
- Don't let gaps accumulate - address them as they come up

**Artifact Management:**
- Use `create_file` for drafting full sections
- Use `str_replace` for all edits
- Provide artifact link after every change
- Never use artifacts for brainstorming lists - that's conversation

**Quality over Speed:**
- Don't rush through stages
- Each iteration should make meaningful improvements
- The goal is a document that works for readers
