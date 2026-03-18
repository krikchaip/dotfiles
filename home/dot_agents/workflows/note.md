---
description: Create and organize notes in the Obsidian vault
subtask: true
---

# Note Creation Workflow

This workflow provides a complete process for capturing and organizing knowledge within the Obsidian vault

## Note Structure

Every note must follow the required formatting rules below.
The template is an example of the expected shape.

Example template (placeholders such as `Section 1 Title` are illustrative, not literal requirements):

```md
---
aliases:
created_at: YYYYMMDDHHmm
references:
  - "[[Relevant Reference If Applicable]]"
  - https://some-external-reference.com
---
#example-tag

###### Section 1 Title
...some details... [[Relevant Knowledge If Applicable]] ...more details...

###### Section 2 Title
...some details... [[Relevant Quick Idea If Applicable]] ...more details...
```

### 1. Frontmatter (YAML)

- `aliases`: Always YAML null using `aliases:`
- `created_at`: 12-digit timestamp (Year, Month, Day, Hour, Minute)
- `references`: Related sources (internal and/or external). Use YAML null (`references:`) when none exist
  - **Internal Links**: References to notes in the `references/` folder, formatted as `[[Note Name]]` with quotes around the link
  - **External Links**: Web URLs to external sources or documentation

### 2. Tags

Immediately after the frontmatter, provide tags for the note:

- Use **object tags**: tag the specific concepts, objects, or entities the note is actually about
- Avoid broad topic/category tags that make search results noisy
- Keep tags sparse and precise; use links and structure notes for broader themes

### 3. Content Formatting

- **Headings**: Use `######` (H6) as the base for sections. If sections can be grouped under a broader topic, use a higher hierarchy level (e.g., `#####` (H5) for grouping H6 sections, and so on)
- **Definitions**: Use blockquotes for key concepts
  - Example: `> **Atomic Note**: A single idea captured in its simplest form.`
- **Callouts**: Use Obsidian-style callouts for warnings or tips
  - Example: `> [!important] Keep notes atomic.`
- **Internal Links**: References to notes in the `knowledge/` and `quick ideas/` folders, formatted as `[[Note Name]]` or `[[Note Name|Alias]]`

## Execution Guide

### 1. Search for notes related to the user's request

- If **similar** notes already exist, ask the user whether they want to add more information or update the existing notes
  - **similar**: The core meaning/topic of the user's request closely resembles an existing note, as if this topic has been written about before
  - If the user does not want to update an existing note, proceed with creating a new note
- Otherwise, proceed with the next step

### 2. Draft the note content

- Briefly summarize the user's input
- Always prioritize up-to-date web information for factual accuracy before drafting
- If the input is a URL, fetch that URL content first, then supplement/verify via web search

### 3. Apply formatting according to the note structure

#### Frontmatter

- **aliases**: `aliases:` (followed by newline, no array brackets)
- **created_at**: Generate with `date +"%Y%m%d%H%M"` (bash command)
- **references**:
  - Include relevant internal links from `references/` and/or relevant external URLs when available
  - When no related notes or external links exist, use YAML null: `references:` (followed by newline, no array brackets)

#### Tags

- Determine appropriate tags based on content analysis
- Use exactly 1 tag. Only add additional tags when a single tag is insufficient to categorize the note. Maximum 3 tags

#### Content

- Include internal links referencing related notes if they exist

### 4. Verify everything before creating the note

- Ensure the final note strictly follows the structure and formatting rules above

## Constraints

- **Tools**: Always use Obsidian MCP tools for vault operations (search, read, create, update and others).
- **External Info**: Search the internet to gather or verify information.
- **New Notes Path**: Always create new notes in `quick ideas/` using note creation tool.
- **Internal links**: Must not include the folder prefix.
- **Link Scope**: In frontmatter `references`, point to notes in `references/`; in body content, use links relevant to `knowledge/` and `quick ideas/`.
