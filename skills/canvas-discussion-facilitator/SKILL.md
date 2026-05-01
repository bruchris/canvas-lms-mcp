---
name: canvas-discussion-facilitator
description: Educator skill for browsing, reading, replying to, and creating Canvas discussion topics. Surfaces active threads, unread entries, and announcement activity — then lets you post replies or create new topics without leaving your agent session. Trigger phrases include "discussion board", "course discussions", "reply to discussion", "create a discussion", "what's in the discussion forum", "check announcements", or "post to discussion".
---

# Canvas Discussion Facilitator

Educator skill for managing course discussion boards: browse topics, read threaded entries, post replies, create new topics, and monitor announcement activity — all from your agent session.

## Prerequisites

- Canvas MCP server must be running and connected.
- You must have instructor, TA, or student role in the target course (read access). Creating or updating topics requires instructor or TA role.
- Student names and post content are visible in output — only run this in a private or educator-only session when reviewing discussion entries.

## Tool naming note

`get_discussion` in canvas-lms-mcp returns the full topic details **and inline discussion entries** in a single call. There is no separate `list_discussion_entries` tool — all thread content comes through `get_discussion`. If you search for `list_discussion_entries` you will not find it; use `get_discussion` instead.

## Steps

### 1. Identify the Target Course

Ask the user which course's discussions to work with. Accept a course name, course code, or Canvas ID.

If unclear, call `list_discussions` with the course ID — it will fail with a 404 if the course ID is wrong, which surfaces the issue early.

### 2. Choose a Mode

Ask the user what they want to do:

| Mode | When to use |
|------|-------------|
| **Browse topics** | See all active discussion topics at a glance |
| **Read a thread** | Read the entries in a specific topic |
| **Check announcements** | View instructor announcements |
| **Post a reply** | Add an entry to an existing discussion |
| **Create a topic** | Open a new discussion topic |

### 3A. Browse Topics

Call `list_discussions` with the course ID. This returns all discussion topics in the course with their title, type (`discussion_topic` or `announcement`), reply count, unread count, and posting status.

Present a summary table:

```
Discussions — [Course Name]

OPEN TOPICS
• "Week 3 Reflection" — 34 replies, 5 unread, posted by Prof. Lee
• "Reading Questions Ch. 4" — 12 replies, 0 unread, posted by TA Park
• "Introduce Yourself" — 28 replies, 0 unread

CLOSED / LOCKED
• "Week 1 Check-in" — 19 replies (locked)
```

Ask the user if they want to read a specific topic.

### 3B. Read a Thread

Call `get_discussion` with the course ID and topic ID. The response includes the topic metadata **and all discussion entries inline** — you do not need a separate entries call.

Summarise the thread:
- Topic title, author, and posted date
- Number of entries and unread count
- The most recent 5 entries (or all entries if ≤ 10), showing author, timestamp, and a preview of the message body

If entries are long, offer to show the full text of a specific entry on request.

### 3C. Check Announcements

Call `list_announcements` with the course ID. This returns announcements as a separate list from discussion topics.

Present the most recent 5 announcements:

```
Announcements — [Course Name]

• [Apr 28] "Final Project Rubric Posted" — Prof. Martinez
• [Apr 22] "Office Hours Change This Week" — Prof. Martinez
• [Apr 15] "Midterm Grades Released" — Prof. Martinez
```

### 3D. Post a Reply

**Requires explicit user confirmation before posting.**

1. Identify the target topic (Steps 1–3B if not already done).
2. Draft the reply message with the user. Show them the draft and ask "Post this reply to [topic title]? (yes/no)".
3. Only after confirmation: call `post_discussion_entry` with the course ID, topic ID, and message body.
4. Report the posted entry ID and timestamp.

### 3E. Create a Topic

**Requires explicit user confirmation before creating.**

1. Collect from the user:
   - Title (required)
   - Message body (optional — can be empty for a blank prompt-style topic)
   - Whether the topic is threaded vs. side-comment style (defaults to threaded)
   - Whether to post now or as a delayed-post

2. Show the full topic draft and ask "Create this discussion topic in [course name]? (yes/no)".
3. Only after confirmation: call `create_discussion` with the course ID, title, message, and discussion type.
4. Report the new topic ID and URL.

### 3F. Update a Topic (Instructors Only)

**Requires explicit user confirmation before updating.**

To edit an existing topic's title, message, or settings (lock/unlock, publish/unpublish):

1. Identify the topic to update via Steps 3A–3B.
2. Show the user the current values and proposed changes.
3. Only after confirmation: call `update_discussion` with the course ID, topic ID, and updated fields.
4. Report the updated topic ID.

## Output Format

```
Discussion Facilitator — [Course Name]

TOPIC: "Week 3 Reflection"
Posted: Apr 20 by Prof. Lee  |  Type: Threaded  |  Replies: 34  |  Unread: 5

RECENT ENTRIES
• Alex Doe (Apr 27, 9:14 AM)
  "I found the reading on constructivism really compelling because it reframes
   how I think about student-driven learning..."

• Jordan Park (Apr 26, 11:02 PM)
  "Totally agree with Sam — the Vygotsky section was the most relevant for
   my practicum..."

• Sam Lee (Apr 26, 3:30 PM)
  "The zone of proximal development framework maps really well onto the
   collaborative assignments we've been doing in class."

[31 more entries — ask to see more or a specific entry]
```

## Notes

- **Read-only by default** — browsing topics and reading threads does not modify any Canvas data.
- Write operations (`post_discussion_entry`, `create_discussion`, `update_discussion`) require explicit user confirmation before each call.
- `get_discussion` returns inline entries — there is no separate `list_discussion_entries` tool in canvas-lms-mcp. Do not search for one.
- For courses with very active discussions (100+ entries per topic), the inline entry list from `get_discussion` may be long; summarise and offer to show full text on request rather than dumping the entire thread.
- Announcements are a separate feed from discussion topics — use `list_announcements` for instructor announcements, `list_discussions` for student discussion topics.
