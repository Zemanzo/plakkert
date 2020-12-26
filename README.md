# Another note web-app because I don't like the ones that already exist

Made with React & TypeScript for learning experience.

## Goals:

- Automatically log-in after first authentication
- Notes can be created / deleted
- Notes can be archived (moved to another section / "page")
- Notes can be given a color
- Notes are placed on a grid
  - Notes can be moved around
  - Layout is saved
  - Layout automatically adjusts when adding new notes
- Notes can be assigned a category
- A search can be performed:
  - All irrelevant notes will be hidden
  - Can be based on content, date created, date modified, color and category
  - Searches are AND based for different properties, OR based for values of the same property
- Notes are saved automatically after changing them
- Notes are stored on a server
- Notes are also stored locally, as a backup and fast initial load
- Notes can contain several elements
  - Regular text
  - Header
  - List
  - Checkbox list
  - Two-column layout
  - Code block
