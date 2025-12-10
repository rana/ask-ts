# ask

AI conversations through Markdown files.

Write thoughts in a markdown file, reference files `[[path]]` and URLs [[url]], run `ask`, and Claude AI responds directly in the file. Markdown is the conversation — editable, searchable, flexible.

---

## Example

A `session.md` file before running `ask`:

```markdown
# [1] Human

I'm refactoring the authentication module.

[[src/auth/]]

What approaches would you suggest for adding OAuth support?
```

After running `ask`, your files expand and Claude responds:

```markdown
# [1] Human

I'm refactoring the authentication module.

<!-- dir: src/auth/ -->
### src/auth/login.ts
...
### src/auth/session.ts
...
<!-- /dir -->

What approaches would you suggest for adding OAuth support?

# [2] AI

Looking at your current implementation, I'd suggest...

# [3] Human

```

Add your next thought to `# [3] Human` and run `ask` again.

---

## Workflow

Edit `session.md` in your editor. Run `ask` in the terminal. The response streams into the file.

<img width="2170" height="2096" alt="ask-workflow" src="https://github.com/user-attachments/assets/32284b2a-186d-4cfa-86c1-b09f8ecf7531" />

```
$ ask
  Model: claude-opus-4-5 (us-west-2)
  Input: 54,131 tokens  ·  Turns: 9 turns

✓ Done · 219 tokens
```

That's the whole loop: think, write, ask, continue.

---

## Install

**macOS:**
```bash
curl -L https://github.com/rana/ask/releases/latest/download/ask-darwin-arm64.tar.xz | tar xJ
sudo mv ask /usr/local/bin/
```

**Linux:**
```bash
curl -L https://github.com/rana/ask/releases/latest/download/ask-linux-amd64.tar.xz | tar xJ
sudo mv ask /usr/local/bin/
```

**Windows:** Download from [releases](https://github.com/rana/ask/releases), extract, add to PATH.

---

## Quick Start

```bash
aws configure       # Setup AWS credentials (needs Bedrock access)
ask init            # Create session.md
                    # Edit session.md with your question
ask                 # Run the conversation
```

---

## File & URL References

Reference files and URLs with `[[path]]`. They expand inline when you run `ask`.

| Pattern               | Expands to                |
|-----------------------|---------------------------|
| `[[file.ts]]`         | Single file               |
| `[[src/]]`            | Directory (non-recursive) |
| `[[src/**/]]`         | Directory (recursive)     |
| `[[https://...]]`     | Web page content          |

```markdown
Explain this function:
[[src/lib/parser.ts]]

Review the entire module:
[[src/auth/**/]]

Based on this documentation:
[[https://docs.example.com/api]]
```

Comments and headers are stripped by default to reduce tokens. Disable with `ask cfg filter off`.

To refresh expanded content: `ask refresh`

---

## Configuration

```bash
ask cfg                   # View current settings
ask cfg model sonnet      # Switch model (opus/sonnet/haiku)
ask cfg temperature 0.7   # Adjust creativity (0.0-1.0)
ask cfg filter off        # Keep comments in expanded files
ask cfg web off           # Disable URL fetching
```

Run `ask help cfg` for all options.

---

## AWS Setup

`ask` uses Claude through AWS Bedrock. You need:

1. AWS account with Bedrock access enabled
2. Claude models activated in your region
3. Credentials configured

```bash
aws configure
# Enter: Access Key ID, Secret Access Key, region (e.g., us-west-2)
```

---

## Commands

```bash
$ ask help

ask — AI conversations through Markdown

Usage
  ask [command] [options]

Commands
  chat     Continue the conversation in a session file (default)
  init     Initialize a new session file
  cfg      View or update configuration
  refresh  Refresh all expanded file, directory, and URL references
  version  Show version information
  help     Show help information

Examples
  $ ask                     Continue conversation
  $ ask init                Start new session
  $ ask -m sonnet           Use specific model
  $ ask help cfg            Command help

Run ask help <command> for details
```

---

## Philosophy

The session file is a source of truth — not a database, not a chat window. Thinking lives in markdown where you work.

`ask` stays out of your way. Write naturally, reference what matters, let Claude respond in the same file. Different conversations save to different files. Keep it simple.
