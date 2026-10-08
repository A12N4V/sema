# One container: the built React app is served by the FastAPI process.
# Used by the Hugging Face Space (docker SDK, port 7860); runs anywhere else too.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
# libgl/xvfb: PyVista renders the 3D scalp field and inflated brain offscreen.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglx-mesa0 libosmesa6 xvfb libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH \
    SEMA_STATIC_DIR=/home/user/app/static \
    SEMA_CORS_ORIGINS=* \
    UV_PROJECT_ENVIRONMENT=/home/user/venv \
    MNE_DATA=/home/user/mne_data
WORKDIR /home/user/app
COPY --chown=user backend/pyproject.toml backend/uv.lock backend/.python-version ./backend/
RUN cd backend && uv sync --frozen --no-install-project --no-dev
COPY --chown=user backend/ ./backend/
RUN cd backend && uv sync --frozen --no-dev
COPY --chown=user --from=web /web/dist ./static
EXPOSE 7860
# Single worker on purpose: sessions live in-process (see Procfile).
CMD ["sh", "-c", "cd backend && exec xvfb-run -a /home/user/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 7860 --workers 1"]
