FROM python:3.13-alpine3.20

RUN apk add --no-cache bash ca-certificates curl git
RUN pip install --no-cache-dir httpx pyparsing

WORKDIR /workspace

ENTRYPOINT ["bash", "tests/conformance/scripts/run-suite-runner.sh"]
