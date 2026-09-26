FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src/ ./src/

RUN pip install . \
    && useradd --system --no-create-home control4

USER control4

EXPOSE 8000

# Inside the container we must listen on all interfaces; the server refuses
# to start that way unless CONTROL4_MCP_TOKEN is set (via .env).
ENV CONTROL4_MCP_TRANSPORT=sse \
    CONTROL4_MCP_HOST=0.0.0.0

ENTRYPOINT ["control4-mcp"]
