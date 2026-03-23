---
description: Create, update, and organize notes in the Obsidian vault
subtask: true
---

# Note Capture and Revision Workflow

This workflow defines how to capture, revise, and organize knowledge in the Obsidian vault

## Core Principle

- Follow Zettelkasten principles: one note must represent one atomic idea that cannot be meaningfully divided further
- If input/source material contains multiple ideas, split it into multiple atomic notes and connect them with internal links
- When decomposing a broad existing note, keep the original note unchanged
- When decomposition happens, also create one new structure note that links the newly created atomic notes

## Note Structure

Every note must follow the required formatting rules below. The template is an example of the expected shape

Example template (placeholders such as `Section 1 Title` are illustrative, not literal requirements):

```md
---
aliases:
created_at: YYYYMMDDHHmm
updated_at: YYYYMMDDHHmm
references:
  - "[[Relevant Note in References Folder If Applicable]]"
  - https://some-external-reference.com
---
#example-tag

###### Section 1 Title
...some details... [[Relevant Note in Knowledge Folder If Applicable]] ...more details...

**Example**
...a codeblock showing example code...

...example explanation...

###### Section 2 Title
...some details... [[Relevant Note in Quick Ideas Folder If Applicable]] ...more details...
```

### 1. Frontmatter (YAML)

- `aliases`: Always YAML null using `aliases:`
- `created_at`: 12-digit timestamp (Year, Month, Day, Hour, Minute). Set when creating a new note
- `updated_at`: 12-digit timestamp (Year, Month, Day, Hour, Minute). Update when revising an existing note
- `references`: Include related internal links (notes in `references/`) and/or external URLs. Use YAML null (`references:`) when none exist

### 2. Tags

Immediately after the frontmatter, provide tags for the note:

- Use **object tags**: tag the specific concepts, objects, or entities the note is actually about
- Avoid broad topic/category tags that make search results noisy
- Keep tags sparse and precise; use links and structure notes for broader themes

### 3. Content Formatting

- **Headings**: Use `######` (H6) as the default section level. Use higher levels only to group related H6 sections
- **Definitions**: Use blockquotes for key concepts
  - Example: `> **Atomic Note**: A single idea captured in its simplest form.`
- **Callouts**: Use Obsidian-style callouts for warnings or tips
  - Example: `> [!important] Keep notes atomic.`
- **Internal Links**: In content, link related notes from `knowledge/` and `quick ideas/` as `[[Note Name]]` or `[[Note Name|Alias]]`
- **Working Examples**: Include at least one practical, working example (e.g., code snippet, mathematical formula, or concrete scenario) followed by a brief explanation of how it works when the note covers technical concepts, code, or procedures

## Execution Guide

### 1. Search for notes related to the user's request

- Search for notes similar to the user's request
- If a similar note exists, ask the user to choose one path: update existing, decompose into linked atomic notes, or create a new note
  - **similar**: The request's core meaning closely matches an existing note
  - If updating, revise the existing note in place
  - If decomposing, create smaller linked atomic notes, keep the original note unchanged, and create a new structure note linking the split atomic notes
  - If creating new, proceed with a new note in `quick ideas/`
- If no similar note exists, proceed to drafting

### 2. Draft the note content

- Briefly summarize the user's input and map it to one or more atomic notes
- For technical topics, code, or procedures, draft a concrete working example and a clear explanation. If the user didn't provide one, generate a relevant, functional example
- If multiple ideas exist, separate them into multiple notes and connect them with internal links
- Prioritize up-to-date web information for factual accuracy. If input is a URL, fetch it first, then supplement/verify via web search

### 3. Apply formatting according to the note structure

#### Frontmatter

- **aliases**: `aliases:` (followed by newline, no array brackets)
- **created_at**: Generate with `date +"%Y%m%d%H%M"` (bash command) when creating a new note
- **updated_at**: Generate with `date +"%Y%m%d%H%M"` (bash command) when creating or revising a note
- **references**:
  - Include relevant internal links from `references/` and/or relevant external URLs
  - If none exist, use YAML null: `references:` (followed by newline, no array brackets)

#### Tags

- Determine appropriate tags based on content analysis
- Use exactly 1 tag. Only add additional tags when a single tag is insufficient to categorize the note. Maximum 3 tags
- Canonical format examples:
  - Default: `#atomic-note`
  - Optional multi-tag: `#atomic-note #zettelkasten` (maximum 3 tags)

#### Content

- Include internal links referencing related notes if they exist

#### Structure Note (for decomposition)

- When a note is decomposed, create one new structure note as a table-of-contents-style map for the split notes
- The structure note should include:
  - A clear title for the parent topic
  - A short overview sentence describing scope
  - Grouped and/or ordered links to the newly created atomic notes
  - Optional one-line context per link to explain why each note is in that group
- Follow the general structure-note pattern; double-hashtag conventions are not required

### 4. Verify everything before finalizing the note

- Ensure the final note strictly follows the structure and formatting rules above
- For revised notes, ensure atomicity and link integrity are preserved

## Constraints

- **Tools**: Always use Obsidian MCP tools for vault operations (search, read, create, update and others)
- **External Info**: Search the internet to gather or verify information
- **New Notes Path**: Always create new notes in `quick ideas/` using note creation tool
- **Existing Notes**: Revise in place when requested. If decomposition is needed, create split-off atomic notes, keep the original unchanged, and create one new structure note linking the split notes
- **Internal links**: Must not include folder prefixes. In frontmatter `references`, link notes ONLY from `references/`; in content, link notes ONLY from `knowledge/` and `quick ideas/`
