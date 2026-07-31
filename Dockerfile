# Bench — только стандартная библиотека Python, никаких зависимостей.
FROM python:3.12-slim

WORKDIR /app
COPY . /app

# В контейнере слушаем все интерфейсы (наружу пробрасываем только на loopback
# хоста — см. docker-compose.yml, `-p 127.0.0.1:...`). Браузер не открываем.
ENV TESTER_PORT=8791 \
    TESTER_PROXY_PORT=8792 \
    TESTER_BIND=0.0.0.0 \
    TESTER_PROXY_BIND=0.0.0.0 \
    TESTER_OPEN=0 \
    TESTER_ALLOWED_ORIGINS=http://localhost:8791,http://127.0.0.1:8791

EXPOSE 8791 8792

# планы храним в volume /app/projects (см. compose), чтобы переживали контейнер
CMD ["python", "serve.py"]
