---
description: Create and organize notes in the Obsidian vault
subtask: true
---

# Note Creation Workflow

This workflow provides a complete process for capturing and organizing knowledge within the Obsidian vault

## Note Structure

Every note must follow this structure **EXACTLY**:

```md
---
aliases:
created_at: YYYYMMDDHHmm
references:
  - "[[Relevant Reference If Applicable]]"
  - https://some-external-reference.com
---
#tag1 #tag2

###### Section 1 Title
...some details... [[Relevant Knowledge If Applicable]] ...more details...

###### Section 2 Title
...some details... [[Relevant Quick Idea If Applicable]] ...more details...
```

### 1. Frontmatter (YAML)

- `aliases`: List of alternative titles. Leave this field empty
- `created_at`: 12-digit timestamp (Year, Month, Day, Hour, Minute)
- `references`: Links to external sources or related materials
  - **Internal Links**: References to notes in the `references/` folder, formatted as `[[Note Name]]` with quotes around the link
  - **External Links**: Web URLs to external sources or documentation

### 2. Tags

Immediately after the frontmatter, provide object tags:

- Format: `#tag1 #tag2`
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
- Otherwise, proceed with the next step

### 2. Draft the note content

- Briefly summarize the user's input. If the input is a URL, fetch the URL content to extract the relevant information before drafting

### 3. Apply formatting according to the note structure

#### Frontmatter

- **aliases**: `aliases:` (followed by newline, no array brackets)
- **created_at**: Generate with `date +"%Y%m%d%H%M"` (bash command)
- **references**: When no related notes or external links exist, use empty format
  - `references:` (followed by newline, no array brackets)

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
