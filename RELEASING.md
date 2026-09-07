# Releasing

GitHub holds the canonical release; itch.io gets the same build with a page people
can actually find. Both come from one tag push.

---

## One-time setup

Both names are already filled in: GitHub `irfanafifiromzi`, itch `geminivillain`.
The only thing you may want to change is the itch **project slug** — the workflow
assumes the page will live at <https://geminivillain.itch.io/geminivillain>. If you
name it something else, edit `ITCH_TARGET` in `.github/workflows/release.yml`.

### 1. Create the GitHub repo and push

```powershell
git remote add origin https://github.com/irfanafifiromzi/GeminiVillain.git
git branch -M main
git push -u origin main
```

### 2. Create the itch.io page

On itch.io: **Create new project**.

- **Kind of project:** Tools
- **Pricing:** free, or "name your own price"
- **Platforms:** tick Windows
- Leave uploads empty — the workflow pushes them

Nothing else is needed up front; butler creates the upload channels on first push.

### 3. Add your itch API key to GitHub

1. Get a key at <https://itch.io/user/settings/api-keys>
2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**
3. Name it `BUTLER_API_KEY`, paste the key

If you skip this, everything still works — the itch step simply does not run.

---

## Releasing a version

```powershell
npm version 0.1.1        # bumps package.json and creates the tag
git push --follow-tags
```

That pushes tag `v0.1.1`, which triggers the workflow. It will:

1. install, typecheck, and build the Windows installer and portable zip
2. publish them to a GitHub release for that tag
3. push both to itch.io as the `windows` and `windows-installer` channels

The GitHub release starts as a **draft** — write the notes, then publish it.

---

## What gets built

| File | For |
| --- | --- |
| `GeminiVillain Setup <version>.exe` | the installer, per-user, no admin needed |
| `GeminiVillain-<version>-win.zip` | portable — unzip and run, nothing installed |
| `*.blockmap` | lets a future auto-updater download only what changed |

---

## The thing that will bite you

**The build is unsigned.** Windows SmartScreen will warn on first run, and most people
who are not developers will stop there. Nothing about GitHub or itch.io changes this —
it is about the executable itself.

Options, cheapest first:

| | Cost | Notes |
| --- | --- | --- |
| Azure Trusted Signing | ~$10/month | Microsoft's own service; needs identity verification |
| Microsoft Store | $19 once | the Store signs for you, but needs MSIX packaging and review |
| OV certificate | $200–400/year | needs a hardware token or cloud HSM |
| EV certificate | $300–600/year | no warning at all, from day one |

Until then, say so plainly on the itch.io page: *unsigned build, Windows will warn,
click More info → Run anyway.* People trust that far more than a warning they were not
told about.

---

## Before you announce it

- It is **Windows only**. The shell defaults and ConPTY assume it — do not advertise
  cross-platform.
- Remote features need **SSH key auth**. Password-only servers cannot use Compare or
  remote *Wait* steps, by design: those run non-interactively and would otherwise hang
  on a prompt nobody can see.
- A public repo means strangers filing issues. If you would rather not, a private repo
  with releases shared by link works exactly the same.
