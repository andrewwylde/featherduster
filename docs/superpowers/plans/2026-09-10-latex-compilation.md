# LaTeX Compilation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust, native PowerShell-based LaTeX compilation pipeline (`scripts/build-resumes.ps1`) to compile master and tailored resumes into standard release PDFs (`resume_wylde_${org}_${position}.pdf`) in `resumes/compiled/<Year>/`, with automated 1-page fit verification and artifact cleanup.

**Architecture:** A standalone PowerShell build script (`scripts/build-resumes.ps1`) that detects the native MiKTeX `pdflatex` toolchain, maps source files (`resumes/templates/*.tex` and `resumes/tailored/tex/*.tex`) to canonical release filenames, compiles with nonstop flags, parses generated compiler logs to verify 1-page constraints, and purges intermediate LaTeX artifacts.

**Tech Stack:** PowerShell 7 / Windows PowerShell, MiKTeX (`pdflatex`), LaTeX.

---

### Task 1: Verify & Configure MiKTeX Toolchain

**Files:**
- Test: manual terminal check
- Workspace: ensure environment has `pdflatex` accessible

- [ ] **Step 1: Verify whether MiKTeX or pdflatex is installed**

Run:
```powershell
Get-Command pdflatex -ErrorAction SilentlyContinue | Select-Object Name, Source
```

- [ ] **Step 2: Install MiKTeX via winget if missing**

If `pdflatex` is not found, run:
```powershell
winget install MiKTeX.MiKTeX --accept-package-agreements --accept-source-agreements
```

- [ ] **Step 3: Verify pdflatex execution and version**

Run:
```powershell
# If needed, refresh path from user or system environment
if (-not (Get-Command pdflatex -ErrorAction SilentlyContinue)) {
    $miktexPath = "$env:LOCALAPPDATA\Programs\MiKTeX\miktex\bin\x64"
    if (Test-Path $miktexPath) { $env:Path = "$miktexPath;$env:Path" }
    $miktexSysPath = "$env:ProgramFiles\MiKTeX\miktex\bin\x64"
    if (Test-Path $miktexSysPath) { $env:Path = "$miktexSysPath;$env:Path" }
}
pdflatex --version
```
Expected output: Contains `MiKTeX-pdfTeX` and version information.

- [ ] **Step 4: Commit verification documentation if any environment scripts added**
```bash
git status
```

---

### Task 2: Build Script Unit & Smoke Test (`tests/test-build-resumes.ps1`)

**Files:**
- Create: `tests/test-build-resumes.ps1`

- [ ] **Step 1: Write test script to validate target resolution, name mapping, and clean behaviors**

```powershell
# tests/test-build-resumes.ps1
param (
    [switch]$VerboseOutput
)

$ErrorActionPreference = "Stop"
$scriptPath = Resolve-Path "$PSScriptRoot/../scripts/build-resumes.ps1"

Write-Host "Running tests for build-resumes.ps1..." -ForegroundColor Cyan

# Test 1: Verify script file exists
if (-not (Test-Path $scriptPath)) {
    Write-Error "FAIL: $scriptPath does not exist."
}

# Test 2: Execute Clean on dummy artifacts
$dummyAux = "$PSScriptRoot/dummy.aux"
$dummyLog = "$PSScriptRoot/dummy.log"
Set-Content -Path $dummyAux -Value "dummy aux"
Set-Content -Path $dummyLog -Value "dummy log"

& $scriptPath -Clean
if ((Test-Path $dummyAux) -or (Test-Path $dummyLog)) {
    Remove-Item -Path $dummyAux, $dummyLog -Force -ErrorAction SilentlyContinue
    Write-Error "FAIL: -Clean failed to remove temporary artifacts."
} else {
    Write-Host "PASS: -Clean removes auxiliary files." -ForegroundColor Green
}

Write-Host "All preliminary tests passed." -ForegroundColor Green
```

- [ ] **Step 2: Run test to verify it fails (since scripts/build-resumes.ps1 does not exist yet)**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File tests/test-build-resumes.ps1
```
Expected output: FAIL: `.../scripts/build-resumes.ps1 does not exist.`

- [ ] **Step 3: Commit the test script**

```bash
git add tests/test-build-resumes.ps1
git commit -m "test: add test suite for build-resumes script"
```

---

### Task 3: Implement `scripts/build-resumes.ps1`

**Files:**
- Create: `scripts/build-resumes.ps1`

- [ ] **Step 1: Implement the full build-resumes script**

Write `scripts/build-resumes.ps1` with parameter handling, MiKTeX path auto-detection, filename mapping, compilation execution, 1-page check, and cleanup:

```powershell
<#
.SYNOPSIS
    Builds and releases LaTeX resumes with automated naming and 1-page validation.
.DESCRIPTION
    Compiles master templates and role-tailored resumes using pdflatex.
    Standardizes output release names to resume_wylde_${org}_${position}.pdf
    and verifies 1-page compliance.
.PARAMETER Target
    Target to compile: 'all', 'templates', 'tailored', a substring filter (e.g. 'netflix'),
    or a path to a specific .tex file. Default is 'all'.
.PARAMETER Year
    Release year folder under resumes/compiled/<Year>/. Default is 2026.
.PARAMETER Clean
    Removes auxiliary files without compiling.
.PARAMETER KeepAux
    Keeps intermediate auxiliary files (.aux, .log, .out) after compiling.
.EXAMPLE
    ./scripts/build-resumes.ps1 -Target main
    ./scripts/build-resumes.ps1 -Target netflix -Year 2026
    ./scripts/build-resumes.ps1 -Target all
    ./scripts/build-resumes.ps1 -Clean
#>
[CmdletBinding()]
param (
    [string]$Target = "all",
    [int]$Year = 2026,
    [switch]$Clean,
    [switch]$KeepAux
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path

function Find-PdfLatex {
    $cmd = Get-Command pdflatex -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $probedPaths = @(
        "$env:LOCALAPPDATA\Programs\MiKTeX\miktex\bin\x64\pdflatex.exe",
        "$env:ProgramFiles\MiKTeX\miktex\bin\x64\pdflatex.exe",
        "C:\Program Files\MiKTeX\miktex\bin\x64\pdflatex.exe"
    )

    foreach ($path in $probedPaths) {
        if (Test-Path $path) {
            $dir = Split-Path $path -Parent
            $env:Path = "$dir;$env:Path"
            return $path
        }
    }

    return $null
}

function Remove-AuxiliaryFiles {
    param ([string]$Dir)
    $extensions = @("*.aux", "*.log", "*.out", "*.fls", "*.fdb_latexmk", "*.synctex.gz")
    foreach ($ext in $extensions) {
        Get-ChildItem -Path $Dir -Filter $ext -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($Clean) {
    Write-Host "Cleaning LaTeX auxiliary files..." -ForegroundColor Cyan
    Remove-AuxiliaryFiles -Dir "$RepoRoot/resumes"
    Remove-AuxiliaryFiles -Dir "$RepoRoot/tests"
    Write-Host "Auxiliary cleanup completed." -ForegroundColor Green
    exit 0
}

$pdflatex = Find-PdfLatex
if (-not $pdflatex) {
    Write-Error @"
MiKTeX (pdflatex) was not found on your system or PATH.
Please install MiKTeX using winget:
  winget install MiKTeX.MiKTeX --accept-package-agreements --accept-source-agreements
After installing, reopen your terminal and re-run this script.
"@
    exit 1
}

# Resolve target files
$sources = @()
$templatesDir = Join-Path $RepoRoot "resumes/templates"
$tailoredDir = Join-Path $RepoRoot "resumes/tailored/tex"

if ($Target -eq "all") {
    $sources += Get-ChildItem -Path $templatesDir -Filter "*.tex" -File | Select-Object -ExpandProperty FullName
    $sources += Get-ChildItem -Path $tailoredDir -Filter "*.tex" -File | Select-Object -ExpandProperty FullName
} elseif ($Target -eq "templates") {
    $sources += Get-ChildItem -Path $templatesDir -Filter "*.tex" -File | Select-Object -ExpandProperty FullName
} elseif ($Target -eq "tailored") {
    $sources += Get-ChildItem -Path $tailoredDir -Filter "*.tex" -File | Select-Object -ExpandProperty FullName
} elseif (Test-Path $Target) {
    $sources += (Resolve-Path $Target).Path
} else {
    # Filter matching substring or alias
    $allFiles = @()
    if (Test-Path $templatesDir) { $allFiles += Get-ChildItem -Path $templatesDir -Filter "*.tex" -File }
    if (Test-Path $tailoredDir) { $allFiles += Get-ChildItem -Path $tailoredDir -Filter "*.tex" -File }

    $matched = $allFiles | Where-Object {
        $_.BaseName -like "*$Target*" -or
        ($Target -in @("base", "main") -and $_.BaseName -eq "main") -or
        ($Target -eq "website" -and $_.BaseName -like "*website*")
    }

    if ($matched.Count -eq 0) {
        Write-Error "No .tex files matched target filter: '$Target'"
        exit 1
    }
    $sources = $matched | Select-Object -ExpandProperty FullName
}

# Destination folder
$outDir = Join-Path $RepoRoot "resumes/compiled/$Year"
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

function Get-ReleaseName {
    param ([string]$SourcePath)
    $base = [System.IO.Path]::GetFileNameWithoutExtension($SourcePath)

    if ($base -eq "main") {
        return "resume_wylde.pdf"
    } elseif ($base.StartsWith("main_")) {
        $suffix = $base.Substring(5)
        return "resume_wylde_${suffix}.pdf"
    } else {
        return "resume_wylde_${base}.pdf"
    }
}

$results = @()
Write-Host "`nCompiling LaTeX Resumes (Output: resumes/compiled/$Year/)..." -ForegroundColor Cyan

foreach ($src in $sources) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($src)
    $srcDir = Split-Path $src -Parent
    $relSrc = [System.IO.Path]::GetRelativePath($RepoRoot, $src)
    $releasePdfName = Get-ReleaseName -SourcePath $src
    $finalPdfPath = Join-Path $outDir $releasePdfName

    Write-Host "  -> Compiling $relSrc..." -NoNewline

    # Run pdflatex in nonstopmode with output to $outDir
    $proc = Start-Process -FilePath $pdflatex `
        -ArgumentList "-interaction=nonstopmode", "-halt-on-error", "-output-directory=$outDir", "`"$src`"" `
        -NoNewWindow -PassThru -Wait

    $generatedPdf = Join-Path $outDir "$baseName.pdf"
    $generatedLog = Join-Path $outDir "$baseName.log"

    $status = "OK"
    $pageCount = 0

    if (Test-Path $generatedLog) {
        $logContent = Get-Content $generatedLog -Raw
        if ($logContent -match 'Output written on .*?\((\d+)\s+pages?') {
            $pageCount = [int]$matches[1]
        }
    }

    if ($proc.ExitCode -ne 0 -or -not (Test-Path $generatedPdf)) {
        $status = "FAILED"
        Write-Host " [FAILED]" -ForegroundColor Red
        if (Test-Path $generatedLog) {
            $errors = Get-Content $generatedLog | Where-Object { $_ -like "! *" }
            foreach ($err in $errors) {
                Write-Host "     $err" -ForegroundColor Red
            }
        }
    } else {
        # Rename to canonical release name if different
        if ($generatedPdf -ne $finalPdfPath) {
            Move-Item -Path $generatedPdf -Destination $finalPdfPath -Force
        }

        # Check 1-page rule (exempt website variant)
        if ($pageCount -gt 1 -and $baseName -notlike "*website*") {
            Write-Host " [WARNING: $pageCount pages]" -ForegroundColor Yellow
            $status = "WARNING ($pageCount pgs)"
        } else {
            Write-Host " [OK] ($pageCount pg)" -ForegroundColor Green
        }
    }

    $results += [PSCustomObject]@{
        Source = $relSrc
        Output = $releasePdfName
        Pages  = if ($pageCount -gt 0) { $pageCount } else { "N/A" }
        Status = $status
    }

    # Clean intermediate files unless -KeepAux
    if (-not $KeepAux) {
        Remove-AuxiliaryFiles -Dir $outDir
    }
}

Write-Host "`nSummary:" -ForegroundColor Cyan
$results | Format-Table -AutoSize

if ($results | Where-Object { $_.Status -eq "FAILED" }) {
    exit 1
}
exit 0
```

- [ ] **Step 2: Run test suite to verify tests pass**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File tests/test-build-resumes.ps1
```
Expected output:
```
Running tests for build-resumes.ps1...
PASS: -Clean removes auxiliary files.
All preliminary tests passed.
```

- [ ] **Step 3: Commit build-resumes script and passing test**

```bash
git add scripts/build-resumes.ps1 tests/test-build-resumes.ps1
git commit -m "feat: implement build-resumes.ps1 with target routing and 1-page validation"
```

---

### Task 4: Test Single & Batch Compilation, Migrate Release Assets

**Files:**
- Modify: `resumes/README.md`
- Compile & Migrate: `resumes/compiled/2026/*.pdf`

- [ ] **Step 1: Test single target compilation (`-Target main`)**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-resumes.ps1 -Target main -Year 2026
```
Expected output:
Compiles `resumes/templates/main.tex` $\rightarrow$ `resume_wylde.pdf`, verifies 1 page, output status OK.

- [ ] **Step 2: Test tailored target compilation (`-Target netflix`)**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-resumes.ps1 -Target netflix -Year 2026
```
Expected output:
Compiles `resumes/tailored/tex/main_netflix_agent_platform.tex` $\rightarrow$ `resume_wylde_netflix_agent_platform.pdf`, verifies 1 page, output status OK.

- [ ] **Step 3: Test batch compilation (`-Target all`) across all resumes**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-resumes.ps1 -Target all -Year 2026
```
Expected output:
Compiles:
- `templates/main.tex` $\rightarrow$ `resume_wylde.pdf`
- `templates/main_personal_website.tex` $\rightarrow$ `resume_wylde_personal_website.pdf`
- `tailored/main_netflix_agent_platform.tex` $\rightarrow$ `resume_wylde_netflix_agent_platform.pdf`
- `tailored/main_maven_backend.tex` $\rightarrow$ `resume_wylde_maven_backend.pdf`
- `tailored/main_tailscale_frontend.tex` $\rightarrow$ `resume_wylde_tailscale_frontend.pdf`
- `tailored/main_tailscale_strategic.tex` $\rightarrow$ `resume_wylde_tailscale_strategic.pdf`
All reported OK.

- [ ] **Step 4: Remove legacy-named PDFs from `resumes/compiled/2026/`**

Remove:
- `resumes/compiled/2026/resume_wylde-netflix.pdf` (replaced by `resume_wylde_netflix_agent_platform.pdf`)
- `resumes/compiled/2026/resume_wylde_frontend.pdf` (replaced by `resume_wylde_tailscale_frontend.pdf`)
- `resumes/compiled/2026/resume_wylde_strategic.pdf` (replaced by `resume_wylde_tailscale_strategic.pdf`)

- [ ] **Step 5: Update `resumes/README.md` documentation**

Update section 3 of `resumes/README.md` to document:
- The standard release naming convention: `resume_wylde_${org}_${position}.pdf`.
- Using `scripts/build-resumes.ps1` for compilation (`-Target all`, `-Target <filter>`, `-Clean`, `-Year`).

- [ ] **Step 6: Verify workspace is clean with git status**

Run:
```powershell
git status
```
Confirm no dangling `.aux`, `.log`, or temporary build files exist.

- [ ] **Step 7: Commit updated resumes, documentation, and releases**

```bash
git add resumes/
git commit -m "feat(resumes): compile all resume releases and document automated build pipeline"
```
