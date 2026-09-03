# Single worker only. Sessions (Raw / Epochs / ICA + the provenance ledger)
# live in an in-process dict — see backend/app/services/session_manager.py.
# A second worker would serve requests from a process that doesn't hold the
# session and 404. Scale this box vertically (RAM), not with workers.
backend: cd backend && ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8123} --workers 1
web: cd frontend && npm run dev
