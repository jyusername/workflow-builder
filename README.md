# Workflow Builder

Workflow Builder is a local visual editor and runner for connected Python script nodes. It includes a React/Vite frontend, a FastAPI backend, a background workflow runner, scheduling, and execution monitoring.

<img width="1434" height="725" alt="image" src="https://github.com/user-attachments/assets/f1c9cdec-6c96-4643-a3d0-c8c5959335ea" />

## Requirements

- Windows 10 or later
- Python 3.11 or later
- Node.js and npm
- Google Chrome is optional; the launcher uses the default browser when Chrome is unavailable

## Setup

From the repository root, create the backend virtual environment and install the dependencies:

```powershell
py -m venv backend\venv
backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Install the frontend dependencies:

```powershell
Set-Location frontend
npm install
Set-Location ..
```

## Run the application

On Windows, launch all three services with:

```powershell
.\start-workflow-builder.bat
```

The launcher starts:

- Backend API: `http://127.0.0.1:8001`
- Frontend: `http://127.0.0.1:5173`
- Background workflow runner

It opens the frontend automatically after the services are ready.

### Run services manually

Open separate PowerShell terminals for each service.

Backend API:

```powershell
Set-Location backend\app
..\venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

Workflow runner:

```powershell
Set-Location backend
.\venv\Scripts\python.exe runner.py
```

Frontend:

```powershell
Set-Location frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

## Workflow data and Git

The live SQLite database is stored at `backend/workflow_builder.db`. It contains workflow projects as well as runtime history, node results, and logs. Because this file changes while the application runs and can become large, it is intentionally excluded from Git.

The repository instead tracks `backend/seed_projects.json`. On first startup, or whenever the live database has no projects, the backend imports the projects from this seed file. This preserves the workflow and its script nodes without committing execution logs.

Project-local inputs for project 27 use this layout:

```text
backend/workspaces/ingestion_runner/
├── inputs/
│   └── matrices/   Tracked routing workbooks
├── secrets/        Local credentials (ignored)
└── .workflow_runs/ Generated run output (ignored)
```

Matrices and credentials use paths relative to the named project workspace, such as `inputs/matrices/BDO_Matrix.xlsx` and `secrets/gcs-service-account.json`. Source data stays outside the workspace and is selected by each user with a local folder path.

The following generated or sensitive data is excluded from Git:

- SQLite database, WAL, and shared-memory files
- Credentials under each project's `secrets/` directory
- Workflow execution output under each project's `.workflow_runs/` directory
- Application log files
- Python caches and the backend virtual environment
- Frontend dependencies and build output

Existing local database data is not deleted by these ignore rules.

## Development checks

Run the frontend linter:

```powershell
Set-Location frontend
npm run lint
```

Create a production frontend build:

```powershell
Set-Location frontend
npm run build
```

Check the backend Python files for syntax errors:

```powershell
backend\venv\Scripts\python.exe -m compileall -q backend\app backend\runner.py backend\runner_helpers.py
```

## Repository layout

```text
backend/                  FastAPI API, runner, and workflow seed
frontend/                 React/Vite user interface
start-workflow-builder.bat  Windows launcher
```
