# Design Document: LaTeX Resume Compilation Workflow

- **Date:** 2026-09-10
- **Status:** Approved
- **Target Branch:** `latex`

## 1. Overview & Objectives

This project establishes a standardized, automated LaTeX compilation pipeline for Andrew Wylde's resume engineering system.

### Objectives:
1. **Single & Batch Compilation:** Provide a PowerShell build script (`scripts/build-resumes.ps1`) to compile either a single resume or all master templates and tailored variants at once.
2. **Unified Release Naming:** Standardize all release PDFs in `resumes/compiled/<Year>/` to follow `resume_wylde_${org_short}_${position_short}.pdf` (and `resume_wylde.pdf` for base, `resume_wylde_${variant}.pdf` for general template variants).
3. **Automated 1-Page Fit Verification:** Enforce the repository's strict 1-page rule by parsing compiler logs and flagging any resume that spills over to page 2.
4. **Clean Workspace Hygiene:** Automatically clean intermediate LaTeX artifacts (`*.aux`, `*.log`, `*.out`, `*.fls`, etc.) so only final release PDFs remain.
5. **Robust Diagnostics:** Detect installed native TeX toolchain (MiKTeX `pdflatex` / `latexmk`), check common install paths, and provide clear installation commands if missing.

---

## 2. Directory Structure & Naming Conventions

### 2.1 File System Organization
```
resumes/
├── README.md                      # Updated pipeline documentation
├── templates/                     # Base and generic templates
│   ├── main.tex                   -> resumes/compiled/<Year>/resume_wylde.pdf
│   └── main_personal_website.tex  -> resumes/compiled/<Year>/resume_wylde_personal_website.pdf
├── tailored/                      # Company- and role-specific assets
│   ├── briefs/                    # Role briefs & specs
│   └── tex/                       # Tailored LaTeX source files
│       ├── main_netflix_agent_platform.tex -> resumes/compiled/<Year>/resume_wylde_netflix_agent_platform.pdf
│       ├── main_maven_backend.tex          -> resumes/compiled/<Year>/resume_wylde_maven_backend.pdf
│       ├── main_tailscale_frontend.tex     -> resumes/compiled/<Year>/resume_wylde_tailscale_frontend.pdf
│       └── main_tailscale_strategic.tex    -> resumes/compiled/<Year>/resume_wylde_tailscale_strategic.pdf
└── compiled/
    └── 2026/                      # Release output folder
```

### 2.2 Output Naming Rule
All compiled PDFs follow a predictable convention:
- **Base resume:** `resumes/templates/main.tex` $\rightarrow$ `resume_wylde.pdf`
- **Tailored resumes:** `resumes/tailored/tex/main_${org}_${position}.tex` $\rightarrow$ `resume_wylde_${org}_${position}.pdf`
- **Other templates:** `resumes/templates/main_${variant}.tex` $\rightarrow$ `resume_wylde_${variant}.pdf`

Existing inconsistent filenames in `resumes/compiled/2026/` (e.g. `resume_wylde-netflix.pdf`, `resume_wylde_frontend.pdf`, `resume_wylde_strategic.pdf`) will be re-compiled and migrated to this convention.

---

## 3. Toolchain & Prerequisite Resolution

- **Primary Compiler:** Native `pdflatex` (MiKTeX distribution).
- **Auto-detection Logic:**
  1. Check if `pdflatex` is present on `$env:PATH`.
  2. If not found, inspect known MiKTeX installation locations:
     - User path: `$env:LOCALAPPDATA\Programs\MiKTeX\miktex\bin\x64\pdflatex.exe`
     - System path: `$env:ProgramFiles\MiKTeX\miktex\bin\x64\pdflatex.exe`
  3. If found in a known location, prepend the directory to `$env:PATH` for the current PowerShell process.
  4. If not found anywhere, halt with actionable setup instructions:
     ```powershell
     winget install MiKTeX.MiKTeX --accept-package-agreements --accept-source-agreements
     ```
- **Flags:** `-interaction=nonstopmode -halt-on-error` to prevent hanging on interactive prompts.

---

## 4. Build Script Specification (`scripts/build-resumes.ps1`)

### 4.1 CLI Arguments
- `-Target <string>` (Default: `"all"`)
  - `"all"`: Builds all templates and tailored resumes.
  - `"templates"`: Builds all `.tex` files in `resumes/templates/`.
  - `"tailored"`: Builds all `.tex` files in `resumes/tailored/tex/`.
  - Filter / Substring: Matches against source filenames (e.g., `netflix`, `maven`, `frontend`, `strategic`, `main`).
  - File path: Directly compiles a specified `.tex` file path.
- `-Year <int>` (Default: Current Year `2026`)
  - Specifies output directory `resumes/compiled/<Year>/`.
- `-Clean` (Switch)
  - Removes intermediate LaTeX build artifacts without compiling.
- `-KeepAux` (Switch)
  - Retains auxiliary files (`.aux`, `.log`, `.out`) for debugging compilation issues.

### 4.2 Compilation Workflow
For each resolved target `.tex` file:
1. Determine release output name according to the naming convention.
2. Ensure destination directory `resumes/compiled/<Year>/` exists.
3. Run `pdflatex -interaction=nonstopmode -halt-on-error -output-directory=<outdir> <source.tex>`.
4. Parse generated `.log` file:
   - Extract page count from `Output written on ... (N page(s), ... bytes)`.
   - If $N > 1$ and target is not an exempt multi-page variant (e.g. `main_personal_website.tex`), output warning: `[WARNING] Single-page constraint violated (N pages)`.
5. If compilation succeeds:
   - If output name differs from source base name (e.g. `main_netflix_agent_platform.pdf` vs `resume_wylde_netflix_agent_platform.pdf`), rename/move the PDF to canonical release name.
   - Unless `-KeepAux` is specified, remove auxiliary files (`*.aux`, `*.log`, `*.out`, `*.fls`, `*.fdb_latexmk`).
6. If compilation fails:
   - Extract lines starting with `!` from the `.log` and print error snippet with line number.
   - Record failure in summary table.

### 4.3 Execution Summary
At the end of execution, print a formatted console summary table:
```
Target                                 Output File                                  Pages   Status
------                                 -----------                                  -----   ------
templates/main.tex                     resumes/compiled/2026/resume_wylde.pdf       1       OK
tailored/main_netflix_agent_platform   resume_wylde_netflix_agent_platform.pdf      1       OK
tailored/main_maven_backend            resume_wylde_maven_backend.pdf               1       OK
...
```

---

## 5. Documentation & Verification Plan

### 5.1 Documentation Updates
- Update `resumes/README.md`:
  - Document `scripts/build-resumes.ps1` parameter usage and examples.
  - Document the unified `resume_wylde_${org}_${position}.pdf` convention.

### 5.2 Verification Steps
1. Verify `pdflatex` availability / detection in PowerShell.
2. Test clean target: `./scripts/build-resumes.ps1 -Clean`.
3. Test single target compilation: `./scripts/build-resumes.ps1 -Target main` and verify `resumes/compiled/2026/resume_wylde.pdf` is updated and auxiliary files are removed.
4. Test tailored target compilation: `./scripts/build-resumes.ps1 -Target netflix` and verify `resume_wylde_netflix_agent_platform.pdf`.
5. Test full batch compilation: `./scripts/build-resumes.ps1 -Target all`.
6. Verify 1-page fit check correctly logs 1 page for all resumes.
