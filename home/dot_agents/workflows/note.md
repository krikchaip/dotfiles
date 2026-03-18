---
description: Create and organize Zettelkasten notes in the Obsidian vault
subtask: true
---

# Zettelkasten Note Creation Workflow

This workflow provides a complete process for capturing and organizing knowledge within the Obsidian vault.

## Capabilities & Constraints

- **Tools**: Always use Obsidian MCP tools for vault operations (search, read, create, update and others).
- **External Info**: Search the internet to gather or verify information.
- **New Notes Path**: Always create new notes in `quick ideas/` using note creation tool.

## Organizational Logic

### 1. Document Structure

Every note must follow this structure **EXACTLY**:

```md
---
aliases:
created_at: YYYYMMDDHHmm
references:
  - "[[Relevant Reference Page If Applicable]]"
  - https://some-external-reference.com
---
#tag1 #tag2

###### Section 1 Title
...some details

###### Section 2 Title
...some details
```

#### 1.1 Frontmatter (YAML)

- **aliases**: List of alternative titles. Leave this empty.
- **created_at**: 12-digit timestamp (Year, Month, Day, Hour, Minute).
  - Generate with: `date +"%Y%m%d%H%M"` (bash command).
- **references**: Links to sources or related materials. **Strictly limited to these two categories only**:
  - **Internal Links**: Point to pages **within the `references` folder only** using the format `[[Page Name]]` without including the folder prefix. No internal links from other folders are allowed.
  - **External Links**: Web URLs to external sources or documentation.

**Note**: When `aliases` or `references` have no content, use the field name followed by a colon and new line (e.g., `aliases:` or `references:`). Do not use empty arrays.

#### 1.2 Tags

Immediately after the frontmatter, provide category tags.

- Format: `#tag1 #tag2`
- Use **object tags**: tag the specific concepts, objects, or entities the note is actually about.
- Avoid broad topic tags that make search results noisy.
- Keep tags sparse and precise; use links and structure notes for broader themes.
- Apply no more than 3 tags, preferably 1.

#### 1.3 Content Formatting

- **Headings**: Use `######` (H6) as the base for sections. If sections can be grouped under a broader topic, use a higher hierarchy level (e.g., `#####` (H5) for grouping H6 sections, and so on).
- **Definitions**: Use blockquotes for key concepts.
  - Example: `> **Atomic Note**: A single idea captured in its simplest form.`
- **Callouts**: Use Obsidian-style callouts for warnings or tips.
  - Example: `> [!important] Keep notes atomic.`
- **Links**: Use internal links `[[Note Name]]` or `[[Note Name|Alias]]`.
  - Internal links in the body must come from the `knowledge` and `quick ideas` folders only, without needing to include the folder prefix.

## Execution Guide

1. **Initial Search**: When a note request is provided, search the vault first using Obsidian MCP tools to avoid duplicate notes and connect related knowledge.
  - If similar notes already exist, ask the user whether they want to add more information, edit the existing notes, or create a new note.
  - If the user decides to create a new note that is related to the existing notes found in the search, include internal links in the new note referencing those notes.
  - Optionally, the related existing notes can also link back to the new note.
2. **Synthesis**: Briefly summarize the user's input. If the input is a URL, fetch the URL content to extract the relevant information before drafting.
3. **Note Preparation**:
  - Use the frontmatter and structure as specified in the Organizational Logic section above.
  - Set `created_at` to the current 12-digit timestamp.
  - Add precise object tags that directly match the note's content.
  - Use `#wip` only when the note is still in progress.
  - If the idea is broad, rely on links and structure notes instead of broad topic tags.
4. **Cross-Referencing**: Proactively suggest internal links to existing notes found during your search.
5. **Creation**: Save the note to the `quick ideas/` directory (using note creation tool).
6. **Verification**: Ensure the final note follows the H6-based heading structure, frontmatter requirements, and precise object-tag rules.
